import { ApprovalService, DECIDE_ROLES, READ_ROLES, SUBMIT_ROLES, downloadFilename, submitCampaign } from '@trust/platform-approval';
import { displayFilename } from '@trust/platform-assets';
import type { Database } from '@trust/platform-db';
import type { ObjectStorage } from '@trust/platform-storage';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { type ActorProvider, requireActor } from './actor';
import {
  ApproveBodySchema,
  CampaignParamsSchema,
  ContractParamsSchema,
  EvidenceFieldsSchema,
  EvidenceParamsSchema,
  EvidenceResponseSchema,
  FourEyesBodySchema,
  FourEyesResponseSchema,
  IdempotencyHeadersSchema,
  RejectBodySchema,
  ShowVersionResponseSchema,
  SubmitBodySchema,
  VersionParamsSchema,
} from './contracts';
import { ApiError } from './errors';

/**
 * Rutas de aprobación — M3A.1 Fase C2 (§17–20, §28, §30). Ver docs/platform/APPROVAL.md.
 *
 *   GET  /api/v1/show-versions/:id                        lectura con estado derivado
 *   POST /api/v1/show-versions/:id/evidence               multipart: `type`, después `file`
 *   GET  /api/v1/show-versions/:id/evidence/:evidenceId   siempre como descarga
 *   POST /api/v1/show-versions/:id/approve                { evidenceId, versionHash }
 *   POST /api/v1/show-versions/:id/reject                 { reason, versionHash }
 *   PUT  /api/v1/contracts/:id/four-eyes                  { fourEyesRequired } — solo ADMIN
 *   POST /api/v1/campaigns/:id/submit                     { draftRevision } — C3
 *
 * El rol se chequea en la ruta (403 antes de leer el cuerpo) y el scope de
 * contrato en el servicio. Las mutaciones exigen CSRF (requireActor) y las de
 * §28 Idempotency-Key.
 */
export interface ApprovalRoutesDeps {
  db: Kysely<Database>;
  storage: ObjectStorage;
  actors: ActorProvider;
  maxEvidenceBytes: number;
}

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

export function registerApprovalRoutes(app: FastifyInstance, deps: ApprovalRoutesDeps): void {
  const service = new ApprovalService({ db: deps.db, storage: deps.storage, maxEvidenceBytes: deps.maxEvidenceBytes });

  app.get('/api/v1/show-versions/:id', async (req) => {
    const actor = await requireActor(deps.actors, req, READ_ROLES);
    const { id } = VersionParamsSchema.parse(req.params);
    return ShowVersionResponseSchema.parse(await service.getVersion(actor, id));
  });

  app.post('/api/v1/show-versions/:id/evidence', async (req, reply) => {
    const actor = await requireActor(deps.actors, req, DECIDE_ROLES);
    const { id } = VersionParamsSchema.parse(req.params);
    const key = idempotencyKey(req.headers);
    if (!req.isMultipart()) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El cuerpo tiene que ser multipart/form-data.');

    const campos: Record<string, string> = {};
    // Límite propio de la ruta (+1: el corte y el 413 los decide limitBody, nunca un truncado silencioso del parser).
    const partes = req.parts({ limits: { fileSize: deps.maxEvidenceBytes + 1, files: 2, fields: 2, fieldSize: 64, parts: 4, headerPairs: 50 } })[Symbol.asyncIterator]();
    const nadaDespues = async () => {
      for (let sig = await partes.next(); !sig.done; sig = await partes.next()) {
        const extra = sig.value;
        if (extra.type === 'file') extra.file.resume();
        throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo tiene que ser la última parte; no se aceptan campos ni archivos después.', { unexpectedPart: displayFilename(extra.fieldname) });
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
      const f = EvidenceFieldsSchema.safeParse(campos);
      if (!f.success) {
        part.file.resume();
        throw new ApiError(400, 'VALIDATION_ERROR', 'Campo inválido: type (EMAIL, PDF o MESSAGE; OTHER no está habilitado) antes del archivo.', {
          issues: f.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      // El MIME que declara la parte (part.mimetype) se ignora a propósito: decide el contenido.
      const r = await service.uploadEvidence({
        actor, versionId: id, type: f.data.type, originalFilename: part.filename ?? '', body: part.file, idempotencyKey: key, afterBody: nadaDespues,
      });
      req.log.info({ event: 'evidence.upload', requestId: req.id, showVersionId: id, evidenceId: r.evidence.id, type: r.evidence.type, bytes: r.evidence.sizeBytes, replayed: r.replayed }, 'evidencia');
      reply.header('idempotent-replayed', String(r.replayed));
      return reply.status(r.replayed ? 200 : 201).send(EvidenceResponseSchema.parse(r.evidence));
    }
    throw new ApiError(400, 'VALIDATION_ERROR', 'Falta el archivo (campo "file").');
  });

  app.get('/api/v1/show-versions/:id/evidence/:evidenceId', async (req, reply) => {
    const actor = await requireActor(deps.actors, req, READ_ROLES);
    const { id, evidenceId } = EvidenceParamsSchema.parse(req.params);
    const { evidence, stream } = await service.openEvidence(actor, id, evidenceId);
    // Siempre descarga: nunca se renderiza en el origen de la API. El nombre lo genera el servidor
    // con la extensión del MIME validado; el original queda solo como metadata (auditoría C2 #1).
    return reply
      .header('content-type', evidence.mimeType === 'text/plain' ? 'text/plain; charset=utf-8' : evidence.mimeType)
      .header('content-length', String(evidence.sizeBytes))
      .header('content-disposition', `attachment; filename="${downloadFilename(evidence)}"`)
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('x-evidence-sha256', evidence.sha256)
      .send(stream);
  });

  app.post('/api/v1/show-versions/:id/approve', async (req, reply) => {
    const actor = await requireActor(deps.actors, req, DECIDE_ROLES);
    const { id } = VersionParamsSchema.parse(req.params);
    const key = idempotencyKey(req.headers);
    exigirJson(req.headers['content-type']);
    const body = ApproveBodySchema.parse(req.body);
    const r = await service.approve({ actor, versionId: id, evidenceId: body.evidenceId, versionHash: body.versionHash, idempotencyKey: key });
    req.log.info({ event: 'version.approve', requestId: req.id, showVersionId: id, replayed: r.replayed }, 'decisión');
    reply.header('idempotent-replayed', String(r.replayed));
    return reply.status(r.replayed ? 200 : 201).send(ShowVersionResponseSchema.parse(r.version));
  });

  app.post('/api/v1/show-versions/:id/reject', async (req, reply) => {
    const actor = await requireActor(deps.actors, req, DECIDE_ROLES);
    const { id } = VersionParamsSchema.parse(req.params);
    const key = idempotencyKey(req.headers);
    exigirJson(req.headers['content-type']);
    const body = RejectBodySchema.parse(req.body);
    const r = await service.reject({ actor, versionId: id, reason: body.reason, versionHash: body.versionHash, idempotencyKey: key });
    req.log.info({ event: 'version.reject', requestId: req.id, showVersionId: id, replayed: r.replayed }, 'decisión');
    reply.header('idempotent-replayed', String(r.replayed));
    return reply.status(r.replayed ? 200 : 201).send(ShowVersionResponseSchema.parse(r.version));
  });

  app.post('/api/v1/campaigns/:id/submit', async (req, reply) => {
    const actor = await requireActor(deps.actors, req, SUBMIT_ROLES);
    const { id } = CampaignParamsSchema.parse(req.params);
    const key = idempotencyKey(req.headers);
    exigirJson(req.headers['content-type']);
    const body = SubmitBodySchema.parse(req.body);
    const r = await submitCampaign({ db: deps.db, approvals: service }, { actor, campaignId: id, draftRevision: body.draftRevision, idempotencyKey: key });
    req.log.info({ event: 'campaign.submit', requestId: req.id, campaignId: id, showVersionId: r.version.id, versionNumber: r.version.versionNumber, replayed: r.replayed }, 'submit');
    reply.header('idempotent-replayed', String(r.replayed));
    return reply.status(r.replayed ? 200 : 201).send(ShowVersionResponseSchema.parse(r.version));
  });

  app.put('/api/v1/contracts/:id/four-eyes', async (req) => {
    const actor = await requireActor(deps.actors, req, ['ADMIN']);
    const { id } = ContractParamsSchema.parse(req.params);
    exigirJson(req.headers['content-type']);
    const body = FourEyesBodySchema.parse(req.body);
    const r = await service.setFourEyesRequired({ actor, contractId: id, required: body.fourEyesRequired });
    req.log.info({ event: 'contract.four_eyes', requestId: req.id, contractId: id, fourEyesRequired: r.fourEyesRequired, changed: r.changed }, 'cuatro ojos');
    return FourEyesResponseSchema.parse(r);
  });
}
