import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LoginRateLimiter, type Role, createUser } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedContract } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_ACTOR_HEADER, DevelopmentActorProvider, SESSION_COOKIE_DEV } from './actor';
import { buildApp } from './app';
import { deliveryText } from './delivery';
import { ROUTES, generateOpenApi, openApiText, zodToJsonSchema } from './openapi';
import { z } from 'zod';

/**
 * E1 · BL-11 / §43 — el contrato publicado es el que corre:
 *   · la tabla OpenAPI tiene EXACTAMENTE las rutas que Fastify registró;
 *   · `docs/platform/openapi.json` y `DELIVERY.md` son idénticos a lo generado
 *     (diff vacío; si no, `pnpm docs:contract`);
 *   · roles, CSRF e Idempotency-Key declarados se prueban contra la app real.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ROLES: Role[] = ['OPERATOR', 'INTERNAL_APPROVER', 'ADMIN', 'EXTERNAL_APPROVER'];
const UUID = '00000000-0000-4000-8000-000000000000';

let t: TestDatabase;
let root: string;
let app: FastifyInstance;
const registradas: string[] = [];
const usuario: Partial<Record<Role, string>> = {};

beforeAll(async () => {
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-e1-contract-'));
  const storage = await LocalDiskStorage.open(path.join(root, 'store'));
  const c = await seedContract(t.app);
  await t.app.updateTable('contracts').set({ external_approval_enabled: true }).where('id', '=', c.id).execute();
  for (const role of ROLES) {
    const u = await createUser(t.app, {
      name: role, email: `${role.toLowerCase()}@contrato.test`, password: 'contrato password 123!', organization: 'Affinitas',
      roles: [role === 'EXTERNAL_APPROVER' ? { role, contractId: c.id } : { role }],
    });
    usuario[role] = u.id;
  }
  app = await buildApp({
    db: t.app, storage, media: { ...mediaRuntimeFromEnv({}), scratchDir: path.join(root, 'scratch') }, maxUploadBytes: 1024 * 1024, mediaBinariesOk: () => true,
    actors: new DevelopmentActorProvider(t.app, { externalApprovalEnabled: true }),
    auth: { limiter: new LoginRateLimiter(), sessionTtlMs: 60_000, cookieName: SESSION_COOKIE_DEV, secureCookie: false },
    log: false,
    onRoute: (r) => { if (r.method !== 'HEAD') registradas.push(`${r.method} ${r.url}`); },
  });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const url = (p: string) => p.replace(/:[A-Za-z]+/g, UUID);
const codigo = (body: string): string | undefined => {
  try { return (JSON.parse(body) as { code?: string }).code; } catch { return undefined; }
};

describe('E1 · BL-11: contrato OpenAPI = rutas reales', () => {
  it('la tabla tiene exactamente las rutas registradas por Fastify (sin faltantes ni sobrantes)', () => {
    const tabla = ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(new Set(tabla).size).toBe(tabla.length);
    expect(tabla).toEqual([...registradas].sort());
    expect(tabla.length).toBeGreaterThanOrEqual(27);
  });

  it('docs/platform/openapi.json y DELIVERY.md versionados = generados (diff vacío)', () => {
    expect(readFileSync(path.join(ROOT, 'docs/platform/openapi.json'), 'utf8'), 'regenerar con `pnpm docs:contract`').toBe(openApiText());
    expect(readFileSync(path.join(ROOT, 'docs/platform/DELIVERY.md'), 'utf8'), 'regenerar con `pnpm docs:contract`').toBe(deliveryText(ROOT));
  });

  it('el documento es OpenAPI 3.1 coherente: cada $ref resuelve, multipart, errores y headers declarados', () => {
    const doc = generateOpenApi() as { openapi: string; paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, unknown> } };
    expect(doc.openapi).toBe('3.1.0');
    const refs = JSON.stringify(doc).match(/#\/components\/schemas\/[A-Za-z]+/g) ?? [];
    for (const r of refs) expect(doc.components.schemas[r.split('/').at(-1) as string], r).toBeDefined();
    const upload = doc.paths['/api/v1/assets']?.post as { requestBody: { content: Record<string, { schema: { required: string[] } }> }; parameters: Array<{ name: string; in: string }>; responses: Record<string, unknown> };
    expect(upload.requestBody.content['multipart/form-data']?.schema.required).toEqual(['surfaceType', 'file']);
    expect(upload.parameters.filter((p) => p.in === 'header').map((p) => p.name).sort()).toEqual(['Idempotency-Key', 'X-CSRF-Token']);
    for (const c of ['201', '200', '400', '401', '403', '409', '413', '415', '422', '429', '503']) expect(upload.responses[c], c).toBeDefined();
    for (const [p, ops] of Object.entries(doc.paths)) for (const [m, op] of Object.entries(ops)) {
      const o = op as { responses: Record<string, unknown> };
      expect(Object.keys(o.responses).length, `${m} ${p}`).toBeGreaterThan(0);
    }
  });

  it('el conversor falla ante una construcción Zod que no conoce (no degrada en silencio)', () => {
    expect(() => zodToJsonSchema(z.date())).toThrow(/no soportado/);
    expect(() => zodToJsonSchema(z.string().ip())).toThrow(/no soportado/);
    expect(zodToJsonSchema(z.object({ a: z.string().uuid(), b: z.number().int().min(1).optional() }).strict())).toEqual({
      type: 'object', properties: { a: { type: 'string', format: 'uuid' }, b: { type: 'integer', minimum: 1 } }, required: ['a'], additionalProperties: false,
    });
  });

  it('CSRF declarado = toda mutación con sesión (requireActor lo exige a todo método no seguro)', () => {
    for (const r of ROUTES) expect(r.csrf, `${r.method} ${r.path}`).toBe(r.method !== 'GET' && r.roles !== null);
  });

  it('matriz rol × ruta: FORBIDDEN exactamente para los roles que la tabla no declara', async () => {
    let probadas = 0;
    for (const r of ROUTES.filter((x) => x.roles !== null && x.roles.length > 0)) {
      for (const role of ROLES) {
        const res = await app.inject({
          method: r.method, url: url(r.path),
          headers: { [DEV_ACTOR_HEADER]: usuario[role] as string, 'idempotency-key': 'contrato-e1-0001', 'content-type': 'application/json' },
          ...(r.method === 'GET' ? {} : { payload: '{}' }),
        });
        const prohibido = res.statusCode === 403 && codigo(res.body) === 'FORBIDDEN';
        expect(prohibido, `${role} → ${r.method} ${r.path}: ${res.statusCode} ${res.body.slice(0, 120)}`).toBe(!(r.roles as string[]).includes(role));
        probadas += 1;
      }
    }
    expect(probadas).toBe(ROUTES.filter((x) => x.roles !== null && x.roles.length > 0).length * ROLES.length);
  });

  it('sin actor: 401 en toda ruta con sesión; las públicas no piden sesión', async () => {
    for (const r of ROUTES) {
      const res = await app.inject({ method: r.method, url: url(r.path), ...(r.method === 'GET' ? {} : { headers: { 'content-type': 'application/json' }, payload: '{}' }) });
      if (r.roles === null) expect(res.statusCode, `${r.method} ${r.path}`).not.toBe(401);
      else expect([res.statusCode, codigo(res.body)], `${r.method} ${r.path}`).toEqual([401, 'UNAUTHENTICATED']);
    }
  });

  it('Idempotency-Key: las rutas que la declaran la exigen; las demás no', async () => {
    for (const r of ROUTES.filter((x) => x.roles !== null && x.roles.length > 0 && x.method !== 'GET')) {
      const role = (r.roles as Role[])[0] as Role;
      const res = await app.inject({ method: r.method, url: url(r.path), headers: { [DEV_ACTOR_HEADER]: usuario[role] as string, 'content-type': 'application/json' }, payload: '{}' });
      expect(codigo(res.body) === 'IDEMPOTENCY_KEY_REQUIRED', `${r.method} ${r.path}: ${res.statusCode} ${res.body.slice(0, 120)}`).toBe(r.idempotency);
    }
  });
});
