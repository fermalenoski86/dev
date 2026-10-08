import { CampaignService, EDIT_ROLES, READ_ROLES } from '@trust/platform-campaigns';
import type { Database } from '@trust/platform-db';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { type ActorProvider, requireActor } from './actor';
import {
  AdvertiserBodySchema,
  AdvertiserResponseSchema,
  CampaignBodySchema,
  CampaignResponseSchema,
  ContractBodySchema,
  ContractPatchSchema,
  ContractResponseSchema,
  DraftPutBodySchema,
  DraftResponseSchema,
  IdParamsSchema,
  ListQuerySchema,
  pageOf,
} from './contracts';
import { ApiError } from './errors';

/**
 * Rutas de Advertiser / Contract / Campaign / Draft — M3A.1 Fase D1 (§5–9, §30).
 * Ver docs/platform/CAMPAIGNS.md.
 *
 *   POST/GET  /api/v1/advertisers            ADMIN escribe · internos leen
 *   POST/GET  /api/v1/contracts              ADMIN escribe · internos leen
 *   GET/PATCH /api/v1/contracts/:id
 *   POST/GET  /api/v1/campaigns              OPERATOR/ADMIN crean · internos leen
 *   GET       /api/v1/campaigns/:id          draft de trabajo + última aprobada
 *   GET/PUT   /api/v1/campaigns/:id/draft    PUT con expectedRevision → 409 DRAFT_CONFLICT
 *
 * Mutaciones con sesión: CSRF (requireActor). El PUT del draft no usa
 * Idempotency-Key: expectedRevision es el contrato autoritativo (decisión 4 del brief D).
 */
const DRAFT_BODY_LIMIT = 1024 * 1024; // un TakeoverDraft real pesa KB; 1 MiB es techo, no objetivo

const exigirJson = (ct: unknown) => {
  if (String(ct ?? '').split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El cuerpo tiene que ser application/json.');
  }
};

export function registerCampaignRoutes(app: FastifyInstance, deps: { db: Kysely<Database>; actors: ActorProvider }): void {
  const s = new CampaignService(deps.db);

  app.post('/api/v1/advertisers', async (req, reply) => {
    const actor = await requireActor(deps.actors, req, ['ADMIN']);
    exigirJson(req.headers['content-type']);
    const a = await s.createAdvertiser(actor, AdvertiserBodySchema.parse(req.body));
    return reply.status(201).send(AdvertiserResponseSchema.parse(a));
  });
  app.get('/api/v1/advertisers', async (req) => {
    const actor = await requireActor(deps.actors, req, READ_ROLES);
    const q = ListQuerySchema.parse(req.query);
    return pageOf(AdvertiserResponseSchema).parse(await s.listAdvertisers(actor, q));
  });

  app.post('/api/v1/contracts', async (req, reply) => {
    const actor = await requireActor(deps.actors, req, ['ADMIN']);
    exigirJson(req.headers['content-type']);
    const c = await s.createContract(actor, ContractBodySchema.parse(req.body));
    return reply.status(201).send(ContractResponseSchema.parse(c));
  });
  app.get('/api/v1/contracts', async (req) => {
    const actor = await requireActor(deps.actors, req, READ_ROLES);
    const q = ListQuerySchema.parse(req.query);
    return pageOf(ContractResponseSchema).parse(await s.listContracts(actor, q));
  });
  app.get('/api/v1/contracts/:id', async (req) => {
    const actor = await requireActor(deps.actors, req, READ_ROLES);
    const { id } = IdParamsSchema.parse(req.params);
    return ContractResponseSchema.parse(await s.getContract(actor, id));
  });
  app.patch('/api/v1/contracts/:id', async (req) => {
    const actor = await requireActor(deps.actors, req, ['ADMIN']);
    const { id } = IdParamsSchema.parse(req.params);
    exigirJson(req.headers['content-type']);
    return ContractResponseSchema.parse(await s.updateContract(actor, id, ContractPatchSchema.parse(req.body)));
  });

  app.post('/api/v1/campaigns', { bodyLimit: DRAFT_BODY_LIMIT }, async (req, reply) => {
    const actor = await requireActor(deps.actors, req, EDIT_ROLES);
    exigirJson(req.headers['content-type']);
    const c = await s.createCampaign(actor, CampaignBodySchema.parse(req.body));
    req.log.info({ event: 'campaign.create', requestId: req.id, campaignId: c.id, contractId: c.contractId }, 'campaña');
    return reply.status(201).send(CampaignResponseSchema.parse(c));
  });
  app.get('/api/v1/campaigns', async (req) => {
    const actor = await requireActor(deps.actors, req, READ_ROLES);
    const q = ListQuerySchema.parse(req.query);
    return pageOf(CampaignResponseSchema).parse(await s.listCampaigns(actor, q));
  });
  app.get('/api/v1/campaigns/:id', async (req) => {
    const actor = await requireActor(deps.actors, req, READ_ROLES);
    const { id } = IdParamsSchema.parse(req.params);
    return CampaignResponseSchema.parse(await s.getCampaign(actor, id));
  });

  app.get('/api/v1/campaigns/:id/draft', async (req) => {
    const actor = await requireActor(deps.actors, req, READ_ROLES);
    const { id } = IdParamsSchema.parse(req.params);
    return DraftResponseSchema.parse(await s.getDraft(actor, id));
  });
  app.put('/api/v1/campaigns/:id/draft', { bodyLimit: DRAFT_BODY_LIMIT }, async (req) => {
    const actor = await requireActor(deps.actors, req, EDIT_ROLES);
    const { id } = IdParamsSchema.parse(req.params);
    exigirJson(req.headers['content-type']);
    const body = DraftPutBodySchema.parse(req.body);
    const d = await s.putDraft(actor, id, { takeoverDraft: body.takeoverDraft, expectedRevision: body.expectedRevision });
    req.log.info({ event: 'draft.update', requestId: req.id, campaignId: id, revision: d.revision }, 'draft');
    return DraftResponseSchema.parse(d);
  });
}
