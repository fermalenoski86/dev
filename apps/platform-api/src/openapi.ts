import { DECIDE_ROLES, READ_ROLES as APPROVAL_READ, SUBMIT_ROLES } from '@trust/platform-approval';
import { EDIT_ROLES, READ_ROLES as CAMPAIGN_READ } from '@trust/platform-campaigns';
import { z } from 'zod';
import * as C from './contracts';

/**
 * Contrato OpenAPI 3.1 de platform-api — Fase E1 · BL-11 (aceptada con spike).
 *
 * Resultado del spike (docs/platform/OPENAPI.md): no se adopta
 * `zod-to-openapi` (línea 7.x para Zod 3 sin soporte activo, y sería una
 * dependencia nueva bajo la política de supply chain). En su lugar:
 *
 *   · los schemas JSON salen de LOS MISMOS schemas Zod que validan cada
 *     entrada y cada respuesta (`zodToJsonSchema`, conversor propio para el
 *     subconjunto que usa la API; cualquier construcción nueva no soportada
 *     hace fallar la generación, no la degrada en silencio);
 *   · la tabla `ROUTES` declara lo que el código no expone por sí solo
 *     (roles, CSRF, Idempotency-Key, multipart, códigos);
 *   · un test exige que la tabla tenga exactamente las rutas que Fastify
 *     registró y que `docs/platform/openapi.json` sea idéntico a lo generado
 *     (diff vacío).
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Schema = { [k: string]: Json };

/* ── Zod → JSON Schema (subconjunto usado por la API) ─────────────────── */

export function zodToJsonSchema(s: z.ZodTypeAny): Schema {
  const def = s._def as { typeName: string; [k: string]: unknown };
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (s as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Schema = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = zodToJsonSchema(v as z.ZodTypeAny);
        if (!(v as z.ZodTypeAny).isOptional()) required.push(k);
      }
      const out: Schema = { type: 'object', properties };
      if (required.length) out.required = required;
      if (def.unknownKeys === 'strict') out.additionalProperties = false;
      return out;
    }
    case 'ZodString': {
      const out: Schema = { type: 'string' };
      for (const c of (def.checks as Array<{ kind: string; value?: number; regex?: RegExp }>) ?? []) {
        if (c.kind === 'uuid') out.format = 'uuid';
        else if (c.kind === 'email') out.format = 'email';
        else if (c.kind === 'datetime') out.format = 'date-time';
        else if (c.kind === 'min' && c.value !== undefined) out.minLength = c.value;
        else if (c.kind === 'max' && c.value !== undefined) out.maxLength = c.value;
        else if (c.kind === 'length' && c.value !== undefined) { out.minLength = c.value; out.maxLength = c.value; }
        else if (c.kind === 'regex' && c.regex) out.pattern = c.regex.source;
        else if (c.kind === 'trim' || c.kind === 'toLowerCase' || c.kind === 'toUpperCase') continue;
        else throw new Error(`zodToJsonSchema: check de string no soportado: ${c.kind}`);
      }
      return out;
    }
    case 'ZodNumber': {
      const out: Schema = { type: 'number' };
      for (const c of (def.checks as Array<{ kind: string; value?: number; inclusive?: boolean }>) ?? []) {
        if (c.kind === 'int') out.type = 'integer';
        else if (c.kind === 'min' && c.value !== undefined) out[c.inclusive ? 'minimum' : 'exclusiveMinimum'] = c.value;
        else if (c.kind === 'max' && c.value !== undefined) out[c.inclusive ? 'maximum' : 'exclusiveMaximum'] = c.value;
        else if (c.kind === 'finite') continue;
        else throw new Error(`zodToJsonSchema: check de number no soportado: ${c.kind}`);
      }
      return out;
    }
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodNull':
      return { type: 'null' };
    case 'ZodEnum':
      return { type: 'string', enum: [...(def.values as string[])] };
    case 'ZodLiteral':
      return { const: def.value as Json };
    case 'ZodArray': {
      const out: Schema = { type: 'array', items: zodToJsonSchema(def.type as z.ZodTypeAny) };
      const min = def.minLength as { value: number } | null;
      const max = def.maxLength as { value: number } | null;
      if (min) out.minItems = min.value;
      if (max) out.maxItems = max.value;
      return out;
    }
    case 'ZodRecord':
      return { type: 'object', additionalProperties: zodToJsonSchema(def.valueType as z.ZodTypeAny) };
    case 'ZodUnknown':
    case 'ZodAny':
      return {};
    case 'ZodUnion':
      return { anyOf: (def.options as z.ZodTypeAny[]).map(zodToJsonSchema) };
    case 'ZodOptional':
      return zodToJsonSchema(def.innerType as z.ZodTypeAny);
    case 'ZodDefault': {
      const inner = zodToJsonSchema(def.innerType as z.ZodTypeAny);
      return { ...inner, default: (def.defaultValue as () => Json)() };
    }
    case 'ZodNullable': {
      const inner = zodToJsonSchema(def.innerType as z.ZodTypeAny);
      return { anyOf: [inner, { type: 'null' }] };
    }
    case 'ZodEffects':
      // refine/preprocess/transform: el contrato publicado es el del schema de entrada
      return zodToJsonSchema(def.schema as z.ZodTypeAny);
    case 'ZodPipeline':
      return zodToJsonSchema(def.in as z.ZodTypeAny);
    case 'ZodBranded':
      return zodToJsonSchema(def.type as z.ZodTypeAny);
    default:
      throw new Error(`zodToJsonSchema: tipo Zod no soportado: ${def.typeName}`);
  }
}

/* ── Tabla de rutas ───────────────────────────────────────────────────── */

const HealthSchema = z.object({ status: z.literal('ok') });
const ReadySchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({ database: z.enum(['ok', 'fail']), storage: z.enum(['ok', 'fail']), media: z.enum(['ok', 'fail']) }),
});
const AssetUploadFieldsDoc = z.object({ surfaceType: z.string(), requiredDurationMs: z.string().optional() });

/** Componentes publicados: nombre → schema Zod real. */
export const COMPONENTS: Record<string, z.ZodTypeAny> = {
  Error: C.ErrorResponseSchema,
  Health: HealthSchema,
  Ready: ReadySchema,
  LoginBody: C.LoginBodySchema,
  Me: C.MeResponseSchema,
  Asset: C.AssetResponseSchema,
  AssetStatus: C.AssetStatusResponseSchema,
  AssetList: C.AssetListResponseSchema,
  AssetListQuery: C.AssetListQuerySchema,
  ShowVersion: C.ShowVersionResponseSchema,
  VersionListQuery: C.VersionListQuerySchema,
  VersionSummaryPage: C.pageOf(C.VersionSummaryResponseSchema),
  Evidence: C.EvidenceResponseSchema,
  ApproveBody: C.ApproveBodySchema,
  RejectBody: C.RejectBodySchema,
  SubmitBody: C.SubmitBodySchema,
  FourEyesBody: C.FourEyesBodySchema,
  FourEyes: C.FourEyesResponseSchema,
  ListQuery: C.ListQuerySchema,
  AdvertiserBody: C.AdvertiserBodySchema,
  Advertiser: C.AdvertiserResponseSchema,
  AdvertiserPage: C.pageOf(C.AdvertiserResponseSchema),
  ContractBody: C.ContractBodySchema,
  ContractPatch: C.ContractPatchSchema,
  Contract: C.ContractResponseSchema,
  ContractPage: C.pageOf(C.ContractResponseSchema),
  CampaignBody: C.CampaignBodySchema,
  Campaign: C.CampaignResponseSchema,
  CampaignPage: C.pageOf(C.CampaignResponseSchema),
  DraftPutBody: C.DraftPutBodySchema,
  Draft: C.DraftResponseSchema,
};

type Body = { json: keyof typeof COMPONENTS } | { multipart: z.ZodTypeAny; file: string };
type Resp = keyof typeof COMPONENTS | 'binary' | 'empty';
export interface RouteDoc {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  summary: string;
  /** null = pública. Roles exigidos (cualquiera de ellos). */
  roles: string[] | null;
  csrf: boolean;
  idempotency: boolean;
  query?: keyof typeof COMPONENTS;
  body?: Body;
  responses: Record<string, Resp>;
  /** Códigos de error documentados (todos con el contrato `Error`). */
  errors: number[];
}

// Roles: LAS MISMAS constantes que pasan los handlers a requireActor (el test
// de contrato además prueba la matriz rol × ruta contra la app real).
const INTERNOS = [...CAMPAIGN_READ];
const OP_ADMIN = [...EDIT_ROLES];
const ASSETS = ['OPERATOR', 'ADMIN']; // ASSET_ROLES de app.ts (§22)
const LECTURA_VERSION = [...APPROVAL_READ];
const DECISORES = [...DECIDE_ROLES];
const SUBMIT = [...SUBMIT_ROLES];

export const ROUTES: RouteDoc[] = [
  { method: 'GET', path: '/health', summary: 'El proceso vive', roles: null, csrf: false, idempotency: false, responses: { 200: 'Health' }, errors: [] },
  { method: 'GET', path: '/ready', summary: 'PostgreSQL, storage y binarios de medios disponibles', roles: null, csrf: false, idempotency: false, responses: { 200: 'Ready', 503: 'Ready' }, errors: [] },
  { method: 'POST', path: '/api/v1/auth/login', summary: 'Login: crea la sesión (cookie) y devuelve el token CSRF', roles: null, csrf: false, idempotency: false, body: { json: 'LoginBody' }, responses: { 200: 'Me' }, errors: [400, 401, 415, 429] },
  { method: 'POST', path: '/api/v1/auth/logout', summary: 'Revoca la sesión actual', roles: [], csrf: true, idempotency: false, responses: { 204: 'empty' }, errors: [401, 403] },
  { method: 'GET', path: '/api/v1/auth/me', summary: 'Usuario, roles y CSRF de la sesión', roles: [], csrf: false, idempotency: false, responses: { 200: 'Me' }, errors: [401] },
  {
    method: 'POST', path: '/api/v1/assets', summary: 'Upload de un Asset (multipart: campos primero, `file` último); límite por actor (BL-10)', roles: ASSETS, csrf: true, idempotency: true,
    body: { multipart: AssetUploadFieldsDoc, file: 'file' }, responses: { 201: 'Asset', 200: 'Asset' }, errors: [400, 401, 403, 409, 413, 415, 422, 429, 503],
  },
  { method: 'GET', path: '/api/v1/assets', summary: 'Assets del actor (cursor)', roles: ASSETS, csrf: false, idempotency: false, query: 'AssetListQuery', responses: { 200: 'AssetList' }, errors: [400, 401, 403] },
  { method: 'GET', path: '/api/v1/assets/:id', summary: 'Un Asset del actor', roles: ASSETS, csrf: false, idempotency: false, responses: { 200: 'Asset' }, errors: [400, 401, 403, 404] },
  { method: 'GET', path: '/api/v1/assets/:id/status', summary: 'Estado de un Asset', roles: ASSETS, csrf: false, idempotency: false, responses: { 200: 'AssetStatus' }, errors: [400, 401, 403, 404] },
  { method: 'GET', path: '/api/v1/show-versions/:id', summary: 'ShowVersion inmutable con hash, evidencia y decisión', roles: LECTURA_VERSION, csrf: false, idempotency: false, responses: { 200: 'ShowVersion' }, errors: [400, 401, 404] },
  {
    method: 'POST', path: '/api/v1/show-versions/:id/evidence', summary: 'Evidencia de aprobación (multipart: `type`, después `file`)', roles: DECISORES, csrf: true, idempotency: true,
    body: { multipart: C.EvidenceFieldsSchema, file: 'file' }, responses: { 201: 'Evidence', 200: 'Evidence' }, errors: [400, 401, 403, 404, 409, 413, 415, 422],
  },
  { method: 'GET', path: '/api/v1/show-versions/:id/evidence/:evidenceId', summary: 'Descarga de la evidencia (attachment)', roles: LECTURA_VERSION, csrf: false, idempotency: false, responses: { 200: 'binary' }, errors: [400, 401, 404] },
  { method: 'POST', path: '/api/v1/show-versions/:id/approve', summary: 'Aprueba el hash exacto con evidencia (cuatro ojos)', roles: DECISORES, csrf: true, idempotency: true, body: { json: 'ApproveBody' }, responses: { 201: 'ShowVersion', 200: 'ShowVersion' }, errors: [400, 401, 403, 404, 409, 422] },
  { method: 'POST', path: '/api/v1/show-versions/:id/reject', summary: 'Rechaza el hash exacto con motivo', roles: DECISORES, csrf: true, idempotency: true, body: { json: 'RejectBody' }, responses: { 201: 'ShowVersion', 200: 'ShowVersion' }, errors: [400, 401, 403, 404, 409] },
  { method: 'GET', path: '/api/v1/campaigns/:id/versions', summary: 'Historial de versiones de la campaña: resúmenes, más nueva primero (cursor); fuera de scope = 404 (BL-31)', roles: LECTURA_VERSION, csrf: false, idempotency: false, query: 'VersionListQuery', responses: { 200: 'VersionSummaryPage' }, errors: [400, 401, 403, 404] },
  { method: 'POST', path: '/api/v1/campaigns/:id/submit', summary: 'Compila y corre preflight server-side; crea la ShowVersion', roles: SUBMIT, csrf: true, idempotency: true, body: { json: 'SubmitBody' }, responses: { 201: 'ShowVersion', 200: 'ShowVersion' }, errors: [400, 401, 403, 404, 409, 422] },
  { method: 'PUT', path: '/api/v1/contracts/:id/four-eyes', summary: 'Política de cuatro ojos del contrato', roles: ['ADMIN'], csrf: true, idempotency: false, body: { json: 'FourEyesBody' }, responses: { 200: 'FourEyes' }, errors: [400, 401, 403, 404] },
  { method: 'POST', path: '/api/v1/advertisers', summary: 'Alta de anunciante', roles: ['ADMIN'], csrf: true, idempotency: false, body: { json: 'AdvertiserBody' }, responses: { 201: 'Advertiser' }, errors: [400, 401, 403, 409] },
  { method: 'GET', path: '/api/v1/advertisers', summary: 'Anunciantes (cursor)', roles: INTERNOS, csrf: false, idempotency: false, query: 'ListQuery', responses: { 200: 'AdvertiserPage' }, errors: [400, 401, 403] },
  { method: 'POST', path: '/api/v1/contracts', summary: 'Alta de contrato con superficies permitidas', roles: ['ADMIN'], csrf: true, idempotency: false, body: { json: 'ContractBody' }, responses: { 201: 'Contract' }, errors: [400, 401, 403, 404, 422] },
  { method: 'GET', path: '/api/v1/contracts', summary: 'Contratos (cursor)', roles: INTERNOS, csrf: false, idempotency: false, query: 'ListQuery', responses: { 200: 'ContractPage' }, errors: [400, 401, 403] },
  { method: 'GET', path: '/api/v1/contracts/:id', summary: 'Un contrato', roles: INTERNOS, csrf: false, idempotency: false, responses: { 200: 'Contract' }, errors: [400, 401, 403, 404] },
  { method: 'PATCH', path: '/api/v1/contracts/:id', summary: 'Edita un contrato (no el anunciante)', roles: ['ADMIN'], csrf: true, idempotency: false, body: { json: 'ContractPatch' }, responses: { 200: 'Contract' }, errors: [400, 401, 403, 404, 422] },
  { method: 'POST', path: '/api/v1/campaigns', summary: 'Alta de campaña con su draft inicial', roles: OP_ADMIN, csrf: true, idempotency: false, body: { json: 'CampaignBody' }, responses: { 201: 'Campaign' }, errors: [400, 401, 403, 404, 413, 422] },
  { method: 'GET', path: '/api/v1/campaigns', summary: 'Campañas (cursor, filtro por contrato)', roles: INTERNOS, csrf: false, idempotency: false, query: 'ListQuery', responses: { 200: 'CampaignPage' }, errors: [400, 401, 403] },
  { method: 'GET', path: '/api/v1/campaigns/:id', summary: 'Campaña: última versión aprobada y draft de trabajo', roles: INTERNOS, csrf: false, idempotency: false, responses: { 200: 'Campaign' }, errors: [400, 401, 403, 404] },
  { method: 'GET', path: '/api/v1/campaigns/:id/draft', summary: 'Draft de trabajo con su revisión', roles: INTERNOS, csrf: false, idempotency: false, responses: { 200: 'Draft' }, errors: [400, 401, 403, 404] },
  { method: 'PUT', path: '/api/v1/campaigns/:id/draft', summary: 'Guarda el draft con expectedRevision (409 DRAFT_CONFLICT, sin last-write-wins)', roles: OP_ADMIN, csrf: true, idempotency: false, body: { json: 'DraftPutBody' }, responses: { 200: 'Draft' }, errors: [400, 401, 403, 404, 409, 413, 422] },
];

/* ── Generación ───────────────────────────────────────────────────────── */

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

function parametros(r: RouteDoc): Json[] {
  const out: Json[] = [];
  for (const m of r.path.matchAll(/:([A-Za-z]+)/g)) {
    out.push({ name: m[1] as string, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } });
  }
  if (r.query) {
    const q = zodToJsonSchema(COMPONENTS[r.query] as z.ZodTypeAny) as { properties?: Record<string, Schema>; required?: string[] };
    for (const [name, schema] of Object.entries(q.properties ?? {})) {
      out.push({ name, in: 'query', required: (q.required ?? []).includes(name), schema });
    }
  }
  if (r.idempotency) out.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 200 } });
  if (r.csrf) out.push({ name: 'X-CSRF-Token', in: 'header', required: true, schema: { type: 'string' } });
  return out;
}

export function generateOpenApi(): Schema {
  const paths: Record<string, Schema> = {};
  for (const r of ROUTES) {
    const p = r.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const responses: Schema = {};
    for (const [code, resp] of Object.entries(r.responses)) {
      if (resp === 'empty') responses[code] = { description: 'Sin cuerpo' };
      else if (resp === 'binary') responses[code] = { description: 'Archivo', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } };
      else responses[code] = { description: resp, content: { 'application/json': { schema: ref(resp) } } };
    }
    for (const code of r.errors) responses[String(code)] = { description: 'Error', content: { 'application/json': { schema: ref('Error') } } };
    const op: Schema = {
      summary: r.summary,
      'x-trust-roles': r.roles === null ? null : r.roles,
      responses,
    };
    const params = parametros(r);
    if (params.length) op.parameters = params;
    if (r.roles !== null) op.security = [{ session: [] }];
    if (r.body && 'json' in r.body) op.requestBody = { required: true, content: { 'application/json': { schema: ref(r.body.json) } } };
    if (r.body && 'multipart' in r.body) {
      const campos = zodToJsonSchema(r.body.multipart) as { properties?: Schema; required?: string[] };
      op.requestBody = {
        required: true,
        content: {
          'multipart/form-data': {
            schema: { type: 'object', properties: { ...(campos.properties ?? {}), [r.body.file]: { type: 'string', format: 'binary' } }, required: [...(campos.required ?? []), r.body.file] },
            encoding: { [r.body.file]: { contentType: 'application/octet-stream' } },
          },
        },
      };
    }
    paths[p] = { ...(paths[p] ?? {}), [r.method.toLowerCase()]: op };
  }
  const schemas: Schema = {};
  for (const [name, s] of Object.entries(COMPONENTS)) schemas[name] = zodToJsonSchema(s);
  return {
    openapi: '3.1.0',
    info: { title: 'TRUST platform-api', version: 'm3a1' },
    paths,
    components: {
      schemas,
      securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: '__Host-trust_session', description: 'Cookie de sesión server-side (C1). En desarrollo por http el nombre es trust_session.' } },
    },
  };
}

/** La forma en que se versiona el archivo: JSON estable, 2 espacios, newline final. */
export const openApiText = (): string => `${JSON.stringify(generateOpenApi(), null, 2)}\n`;
