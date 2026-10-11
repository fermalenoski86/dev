import { ActiveVersionService, CANCEL_ROLES, CONFIRM_ROLES, READ_ROLES, REQUEST_ROLES } from '@trust/platform-campaigns';
import type { Database } from '@trust/platform-db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { type ActorProvider, requireActor } from './actor';
import {
  ActiveVersionChangeListQuerySchema,
  ActiveVersionChangeParamsSchema,
  ActiveVersionChangeResponseSchema,
  ActiveVersionConfirmBodySchema,
  ActiveVersionRequestBodySchema,
  CampaignParamsSchema,
  ErrorResponseSchema,
  IdempotencyHeadersSchema,
  pageOf,
} from './contracts';
import { ApiError } from './errors';

/**
 * F3(a) — versión vigente administrativa con cuatro ojos (brief aprobado en #50).
 *
 *   POST /api/v1/campaigns/:id/active-version-changes        pedir    OPERATOR/ADMIN       201
 *   POST /api/v1/active-version-changes/:id/confirm          confirmar INTERNAL_APPROVER/ADMIN 200
 *   POST /api/v1/active-version-changes/:id/cancel           cancelar  quien pidió o ADMIN  200
 *   GET  /api/v1/campaigns/:id/active-version-changes        historial (cursor)
 *
 * Las tres mutaciones exigen CSRF + Idempotency-Key. El status que se responde
 * es el que devolvió `withIdempotency`: en un replay, el MISMO status y body
 * de la respuesta original (201→201, 200→200, 409→409) con
 * `idempotent-replayed: true`. Nada de esto despliega contenido.
 */
const idempotencyKey = (headers: unknown): string => {
  const h = IdempotencyHeadersSchema.safeParse(headers);
  if (!h.success) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Falta una Idempotency-Key válida (8–200 caracteres ASCII).');
  return h.data['idempotency-key'];
};

const exigirJson = (ct: unknown) => {
  if (String(ct ?? '').split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El cuerpo tiene que ser application/json.');
  }
};

/** Cancelar no lleva cuerpo; si viene, tiene que ser `{}`. */
const CancelBodySchema = z.object({}).strict();

export function registerActiveVersionRoutes(app: FastifyInstance, deps: { db: Kysely<Database>; actors: ActorProvider; ttlMinutes: number }): void {
  const service = new ActiveVersionService({ db: deps.db, ttlMinutes: deps.ttlMinutes });

  const responder = (req: FastifyRequest, reply: FastifyReply, event: string, r: { status: number; body: unknown; replayed: boolean }, ids: Record<string, string>) => {
    req.log.info({ event, requestId: req.id, ...ids, status: r.status, replayed: r.replayed }, 'versión vigente');
    reply.header('idempotent-replayed', String(r.replayed));
    const body = r.status >= 400 ? ErrorResponseSchema.parse(r.body) : ActiveVersionChangeResponseSchema.parse(r.body);
    return reply.status(r.status).send(body);
  };

  app.post('/api/v1/campaigns/:id/active-version-changes', async (req, reply) => {
    const actor = await requireActor(deps.actors, req, REQUEST_ROLES);
    const { id } = CampaignParamsSchema.parse(req.params);
    const key = idempotencyKey(req.headers);
    exigirJson(req.headers['content-type']);
    const body = ActiveVersionRequestBodySchema.parse(req.body);
    const r = await service.request({ actor, campaignId: id, ...body, idempotencyKey: key, requestId: req.id });
    return responder(req, reply, 'active_version.request', r, { campaignId: id });
  });

  app.post('/api/v1/active-version-changes/:id/confirm', async (req, reply) => {
    const actor = await requireActor(deps.actors, req, CONFIRM_ROLES);
    const { id } = ActiveVersionChangeParamsSchema.parse(req.params);
    const key = idempotencyKey(req.headers);
    exigirJson(req.headers['content-type']);
    const body = ActiveVersionConfirmBodySchema.parse(req.body);
    const r = await service.confirm({ actor, changeId: id, versionHash: body.versionHash, idempotencyKey: key, requestId: req.id });
    return responder(req, reply, 'active_version.confirm', r, { changeId: id });
  });

  app.post('/api/v1/active-version-changes/:id/cancel', async (req, reply) => {
    const actor = await requireActor(deps.actors, req, CANCEL_ROLES);
    const { id } = ActiveVersionChangeParamsSchema.parse(req.params);
    const key = idempotencyKey(req.headers);
    if (req.body !== undefined && req.body !== null) {
      exigirJson(req.headers['content-type']);
      CancelBodySchema.parse(req.body);
    }
    const r = await service.cancel({ actor, changeId: id, idempotencyKey: key, requestId: req.id });
    return responder(req, reply, 'active_version.cancel', r, { changeId: id });
  });

  app.get('/api/v1/campaigns/:id/active-version-changes', async (req) => {
    const actor = await requireActor(deps.actors, req, READ_ROLES);
    const { id } = CampaignParamsSchema.parse(req.params);
    const q = ActiveVersionChangeListQuerySchema.parse(req.query);
    return pageOf(ActiveVersionChangeResponseSchema).parse(await service.list(actor, id, q));
  });
}
