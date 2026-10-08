import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { DEFAULT_MAX_EVIDENCE_BYTES } from '@trust/platform-approval';
import { AssetUploadService, type AssetView, displayFilename, toView } from '@trust/platform-assets';
import { deriveSurfaceFormats } from '@trust/platform-contracts';
import type { Database } from '@trust/platform-db';
import { type SurfaceFormats, remediationFor } from '@trust/platform-media';
import type { MediaRuntime } from '@trust/platform-media';
import type { ObjectStorage } from '@trust/platform-storage';
import { EL_TRUST } from '@trust/show-engine';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Kysely, sql } from 'kysely';
import type { z } from 'zod';
import { type ActorProvider, CSRF_HEADER, DEV_ACTOR_HEADER, requireActor } from './actor';
import { registerApprovalRoutes } from './approval-routes';
import { registerCampaignRoutes } from './campaign-routes';
import { type AuthConfig, registerAuthRoutes } from './auth-routes';
import {
  AssetListQuerySchema,
  AssetListResponseSchema,
  AssetParamsSchema,
  type AssetResponse,
  AssetResponseSchema,
  AssetStatusResponseSchema,
  ErrorResponseSchema,
  UploadFieldsSchema,
  UploadHeadersSchema,
} from './contracts';
import { ApiError, toErrorResponse } from './errors';

/**
 * platform-api — M3A.1 Fase B4 (§18–24, §26).
 *
 * Estrategia de upload (UNA, §18): `POST /api/v1/assets` multipart en una sola
 * solicitud — campos primero (`surfaceType`, opcional `requiredDurationMs`),
 * después `file`. Idempotency-Key obligatoria. El archivo fluye por stream al
 * temporal; nunca se arma en memoria. Ver docs/platform/API.md.
 *
 * No hay PATCH ni DELETE de Assets (§26).
 */
export interface AppDeps {
  db: Kysely<Database>;
  storage: ObjectStorage;
  media: MediaRuntime;
  actors: ActorProvider;
  /** Rutas /api/v1/auth/*. Sin esto (tests con provider DEV) no se registran. */
  auth?: AuthConfig;
  maxUploadBytes: number;
  /** MAX_EVIDENCE_BYTES (C2). Default 25 MiB. */
  maxEvidenceBytes?: number;
  /**
   * Saltos de proxy confiables para `req.ip` (Fastify `trustProxy`). 0 = la IP
   * del socket. Detrás de un reverse proxy hay que declararlo, o el rate limit
   * por dirección vería a todos con la IP del proxy.
   */
  trustProxyHops?: number;
  formats?: SurfaceFormats;
  /** Resultado cacheado de "¿están ffprobe/ffmpeg?": /ready no lanza procesos por probe (§24). */
  mediaBinariesOk: () => boolean;
  /** false = sin logs (tests que no los miran). Siempre JSON y siempre con redacción. */
  log?: false | { level?: string; stream?: NodeJS.WritableStream };
}

/** §22: los Assets los suben y leen OPERATOR o ADMIN. */
const ASSET_ROLES = ['OPERATOR', 'ADMIN'] as const;

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

/** HTTP coherente con el resultado del upload (§22). */
export function statusForAsset(a: AssetView): number {
  if (a.status === 'READY') return 201;
  if (a.status !== 'REJECTED' || !a.rejection) return 500;
  if (a.rejection.code === 'ASSET_TOO_LARGE') return 413;
  if (a.rejection.code === 'ASSET_BAD_CONTAINER') return 415;
  if (a.rejection.code === 'ASSET_STORAGE_ERROR' || a.rejection.code === 'ASSET_INSPECTION_TIMEOUT') return 503;
  return 422;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const formats = deps.formats ?? deriveSurfaceFormats(EL_TRUST);
  const service = new AssetUploadService({ db: deps.db, storage: deps.storage, media: deps.media, config: { maxUploadBytes: deps.maxUploadBytes, formats } });

  const app = Fastify({
    logger:
      deps.log === false
        ? false
        : {
            level: deps.log?.level ?? process.env.LOG_LEVEL ?? 'info',
            ...(deps.log?.stream ? { stream: deps.log.stream } : {}),
            redact: { paths: ['req.headers.authorization', 'req.headers.cookie', `req.headers["${DEV_ACTOR_HEADER}"]`, `req.headers["${CSRF_HEADER}"]`, 'res.headers["set-cookie"]', 'req.headers["idempotency-key"]'], censor: '[redactado]' },
          },
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && REQUEST_ID_RE.test(h) ? h : randomUUID();
    },
    trustProxy: deps.trustProxyHops && deps.trustProxyHops > 0 ? deps.trustProxyHops : false,
    bodyLimit: 64 * 1024, // JSON chico; el archivo va por multipart con su propio límite
    disableRequestLogging: false,
  });

  await app.register(cookie); // solo parseo; sin secreto: la cookie es un token opaco validado contra la base

  await app.register(multipart, {
    limits: {
      // +1: el corte y la huella de TOO_LARGE los hace limitBody en el byte límite+1;
      // busboy no tiene que cortar antes (sería nondeterminístico).
      fileSize: deps.maxUploadBytes + 1,
      files: 2, // el segundo se ve para rechazarlo con 400, no con un error genérico del parser
      fields: 4,
      fieldSize: 1024,
      parts: 6,
      headerPairs: 50,
    },
    throwFileSizeLimit: false,
  });

  const conRemediacion = (a: AssetView): AssetResponse =>
    AssetResponseSchema.parse({
      ...a,
      rejection: a.rejection ? { ...a.rejection, remediation: remediationFor(a.rejection, a.surfaceType, formats) } : null,
    });

  const enviar = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> => schema.parse(value);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  app.setErrorHandler((err, req, reply) => {
    const { status, body } = toErrorResponse(err, String(req.id));
    if (status >= 500) req.log.error({ err, requestId: req.id }, 'error interno');
    else req.log.info({ code: body.code, requestId: req.id }, 'solicitud rechazada');
    void reply.status(status).send(ErrorResponseSchema.parse(body));
  });

  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send(ErrorResponseSchema.parse({ code: 'NOT_FOUND', message: 'Ruta inexistente.', requestId: String(req.id) }));
  });

  /* ── health (§24) ─────────────────────────────────────────────────── */
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_req, reply) => {
    const check = async (fn: () => Promise<unknown>) => fn().then(() => 'ok' as const, () => 'fail' as const);
    const checks = {
      database: await check(() => sql`SELECT 1`.execute(deps.db)),
      storage: await check(() => deps.storage.ping()),
      media: deps.mediaBinariesOk() ? ('ok' as const) : ('fail' as const),
    };
    const ok = Object.values(checks).every((v) => v === 'ok');
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ready' : 'not_ready', checks });
  });

  if (deps.auth) registerAuthRoutes(app, { db: deps.db, actors: deps.actors, auth: deps.auth });
  registerApprovalRoutes(app, { db: deps.db, storage: deps.storage, actors: deps.actors, maxEvidenceBytes: deps.maxEvidenceBytes ?? DEFAULT_MAX_EVIDENCE_BYTES });
  registerCampaignRoutes(app, { db: deps.db, actors: deps.actors });

  /* ── assets (§18) ─────────────────────────────────────────────────── */
  app.post('/api/v1/assets', async (req, reply) => {
    const actor = await requireActor(deps.actors, req, ASSET_ROLES);
    const hdr = UploadHeadersSchema.safeParse(req.headers);
    if (!hdr.success) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Falta una Idempotency-Key válida (8–200 caracteres ASCII).');
    if (!req.isMultipart()) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El cuerpo tiene que ser multipart/form-data.');

    const inicio = process.hrtime.bigint();
    const campos: Record<string, string> = {};
    // Iterador explícito: después del archivo hay que seguir leyendo para
    // validar que no venga nada más (auditoría B4 #1), sin bufferear el archivo.
    const partes = req.parts()[Symbol.asyncIterator]();
    const nadaDespuesDelArchivo = async () => {
      for (let sig = await partes.next(); !sig.done; sig = await partes.next()) {
        const extra = sig.value;
        if (extra.type === 'file') extra.file.resume();
        throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo tiene que ser la última parte; no se aceptan campos ni archivos después.', {
          unexpectedPart: displayFilename(extra.fieldname),
        });
      }
    };
    for (let paso = await partes.next(); !paso.done; paso = await partes.next()) {
      const part = paso.value;
      if (part.type === 'field') {
        if (part.fieldname in campos) throw new ApiError(400, 'VALIDATION_ERROR', `Campo repetido: ${displayFilename(part.fieldname)}.`);
        campos[part.fieldname] = String(part.value);
        continue;
      }
      if (part.fieldname !== 'file') {
        part.file.resume();
        throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo tiene que venir en el campo "file".');
      }
      const f = UploadFieldsSchema.safeParse(campos);
      if (!f.success) {
        part.file.resume();
        throw new ApiError(400, 'VALIDATION_ERROR', 'Campos inválidos: surfaceType (antes del archivo) y requiredDurationMs opcional.', {
          issues: f.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      if (!Object.prototype.hasOwnProperty.call(formats, f.data.surfaceType)) {
        part.file.resume();
        throw new ApiError(400, 'INVALID_SURFACE_TYPE', 'surfaceType no existe en las capacidades del edificio.', { accepted: Object.keys(formats) });
      }
      const r = await service.upload({
        actorId: actor.userId,
        surfaceType: f.data.surfaceType,
        originalFilename: part.filename ?? '',
        body: part.file,
        idempotencyKey: hdr.data['idempotency-key'],
        requiredDurationMs: f.data.requiredDurationMs,
        afterBody: nadaDespuesDelArchivo,
      });
      const asset = conRemediacion(r.asset);
      const status = statusForAsset(r.asset);
      req.log.info(
        {
          event: 'asset.upload', requestId: req.id, assetId: asset.id, actorSource: actor.source, bytes: asset.sizeBytes,
          durationMs: Number((process.hrtime.bigint() - inicio) / 1_000_000n), result: asset.status,
          rejection: asset.rejection?.code ?? null, replayed: r.replayed, filename: displayFilename(asset.originalFilename),
        },
        'upload',
      );
      reply.header('idempotent-replayed', String(r.replayed));
      if (status === 201) return reply.status(r.replayed ? 200 : 201).send(enviar(AssetResponseSchema, asset));
      const rej = asset.rejection;
      if (!rej) throw new Error('asset no READY sin rechazo'); // no debería pasar: la base exige código en REJECTED
      return reply
        .status(status)
        .send(enviar(ErrorResponseSchema, { code: rej.code, message: rej.message, details: { asset }, requestId: String(req.id) }));
    }
    throw new ApiError(400, 'VALIDATION_ERROR', 'Falta el archivo (campo "file").');
  });

  const buscar = async (id: string, actorId: string) => {
    // Con rol de Assets, cada actor ve solo los que creó (sin cambio respecto de B4; compartir entre operadores es decisión aparte). Lo ajeno es 404, no 403: no se revela existencia.
    const a = await deps.db.selectFrom('assets').selectAll().where('id', '=', id).where('created_by', '=', actorId).executeTakeFirst();
    if (!a) throw new ApiError(404, 'ASSET_NOT_FOUND', 'El asset no existe.');
    return conRemediacion(toView(a));
  };

  app.get('/api/v1/assets/:id', async (req) => {
    const actor = await requireActor(deps.actors, req, ASSET_ROLES);
    const { id } = AssetParamsSchema.parse(req.params);
    return enviar(AssetResponseSchema, await buscar(id, actor.userId));
  });

  app.get('/api/v1/assets/:id/status', async (req) => {
    const actor = await requireActor(deps.actors, req, ASSET_ROLES);
    const { id } = AssetParamsSchema.parse(req.params);
    const a = await buscar(id, actor.userId);
    return enviar(AssetStatusResponseSchema, { id: a.id, status: a.status, rejection: a.rejection });
  });

  app.get('/api/v1/assets', async (req) => {
    const actor = await requireActor(deps.actors, req, ASSET_ROLES);
    const q = AssetListQuerySchema.parse(req.query);
    let qb = deps.db.selectFrom('assets').selectAll().where('created_by', '=', actor.userId);
    if (q.status) qb = qb.where('status', '=', q.status);
    if (q.cursor) {
      // keyset sobre (created_at, id) tomado de la fila del cursor: sin perder microsegundos en JS
      const c = q.cursor;
      qb = qb.where(sql<boolean>`(created_at, id) < (SELECT a2.created_at, a2.id FROM assets a2 WHERE a2.id = ${c}::uuid AND a2.created_by = ${actor.userId}::uuid)`);
    }
    const filas = await qb.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(q.limit + 1).execute();
    const pagina = filas.slice(0, q.limit);
    const ultima = pagina.at(-1);
    const nextCursor = filas.length > q.limit && ultima ? ultima.id : null;
    return enviar(AssetListResponseSchema, { items: pagina.map((a) => conRemediacion(toView(a))), nextCursor });
  });

  return app;
}
