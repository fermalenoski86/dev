import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { displayFilename, limitBody, normalizeOriginalFilename } from '@trust/platform-assets';
import { appendAuditEvent } from '@trust/platform-audit';
import { type Principal, type Role, canAccessContract } from '@trust/platform-auth';
import { type Database, type EvidenceType, requestFingerprint, withIdempotency } from '@trust/platform-db';
import { type ObjectStorage, StorageIntegrityError, StorageLimitError, type TempObjectInfo } from '@trust/platform-storage';
import { type Kysely, sql } from 'kysely';
import { ContentSniffer, EXTENSION_BY_MIME, MIME_BY_KIND, TYPE_BY_KIND, classifyContent } from './detect';
import { ApprovalError, fromDatabaseError } from './errors';

/**
 * ApprovalService — M3A.1 Fase C2 (§17–20, §27, §28) con las decisiones 2 y 4
 * del brief C.
 *
 * Autorización (server-side, por rol Y scope de contrato; el cliente nunca
 * manda el contrato):
 *   · leer una ShowVersion y bajar su evidencia: OPERATOR, INTERNAL_APPROVER,
 *     ADMIN (todos los contratos) o EXTERNAL_APPROVER habilitado de ESE contrato.
 *     Fuera de scope = 404 (no se revela que existe).
 *   · subir evidencia, aprobar y rechazar: INTERNAL_APPROVER o EXTERNAL_APPROVER
 *     habilitado de ESE contrato. Visible pero sin ese rol = 403.
 *
 * Decisiones (approve/reject): una sola transacción con la campaña bloqueada
 * (serializa decisiones y evidencia de la misma campaña): versión exacta por
 * id + hash, estado SUBMITTED, cuatro ojos, evidencia de ESA versión, Approval,
 * `latest_approved_version_id` y audit. Idempotency-Key obligatoria: un retry
 * devuelve la respuesta guardada y nunca crea una segunda Approval. La base
 * repite los chequeos críticos (triggers 0001/0003, UNIQUE por versión).
 */
export const READ_ROLES: readonly Role[] = ['OPERATOR', 'INTERNAL_APPROVER', 'ADMIN', 'EXTERNAL_APPROVER'];
export const DECIDE_ROLES: readonly Role[] = ['INTERNAL_APPROVER', 'EXTERNAL_APPROVER'];

export const EVIDENCE_OPERATION = 'version.evidence';
export const APPROVE_OPERATION = 'version.approve';
export const REJECT_OPERATION = 'version.reject';

/** MAX_EVIDENCE_BYTES (§19): default 25 MiB. */
export const DEFAULT_MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

export function maxEvidenceBytesFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const v = env.MAX_EVIDENCE_BYTES;
  if (v === undefined || v === '') return DEFAULT_MAX_EVIDENCE_BYTES;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`MAX_EVIDENCE_BYTES tiene que ser un entero >= 1 (vino "${v}")`);
  return n;
}

export type VersionStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface EvidenceView {
  id: string;
  showVersionId: string;
  type: EvidenceType;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface ApprovalView {
  id: string;
  decision: 'APPROVED' | 'REJECTED';
  actorUserId: string;
  evidenceId: string | null;
  reason: string | null;
  versionHash: string;
  createdAt: string;
}

export interface ShowVersionView {
  id: string;
  campaignId: string;
  contractId: string;
  versionNumber: number;
  versionHash: string;
  hashAlgorithm: string;
  canonicalizationVersion: string;
  hashEnvelopeVersion: number;
  showPackageSchemaVersion: number;
  compilerVersion: string;
  sourceDraftId: string;
  sourceDraftRevision: number;
  submittedBy: string;
  submittedAt: string;
  /** Derivado de su única Approval: sin Approval = SUBMITTED. */
  status: VersionStatus;
  fourEyesRequired: boolean;
  approval: ApprovalView | null;
  evidence: EvidenceView[];
  assets: Array<{ logicalRef: string; assetId: string; sha256: string }>;
}

export interface ApprovalDeps {
  db: Kysely<Database>;
  storage: ObjectStorage;
  maxEvidenceBytes: number;
}

/** Nombre de descarga generado por el servidor: `evidence-<id>.<ext>` con la extensión del MIME validado. */
export function downloadFilename(e: Pick<EvidenceView, 'id' | 'mimeType'>): string {
  const ext = EXTENSION_BY_MIME[e.mimeType];
  if (!ext) throw new Error(`MIME de evidencia fuera de la allowlist: ${e.mimeType}`);
  return `evidence-${e.id}.${ext}`;
}

export interface EvidenceUploadInput {
  actor: Principal;
  versionId: string;
  type: EvidenceType;
  originalFilename: string;
  body: Readable;
  idempotencyKey: string;
  /** Igual que en Assets: valida lo que viene después del archivo antes de persistir nada. */
  afterBody?: () => Promise<void>;
}

export interface DecisionBase {
  actor: Principal;
  versionId: string;
  /** El hash que el aprobador vio: la decisión es sobre ESA versión exacta. */
  versionHash: string;
  idempotencyKey: string;
}

type Recibido = { kind: 'ok'; temp: TempObjectInfo; head: Buffer; isText: boolean } | { kind: 'too_large' };

const iso = (d: Date | string) => new Date(d).toISOString();

export class ApprovalService {
  constructor(private readonly deps: ApprovalDeps) {
    if (!Number.isSafeInteger(deps.maxEvidenceBytes) || deps.maxEvidenceBytes < 1) throw new Error('maxEvidenceBytes tiene que ser un entero >= 1');
  }

  /* ── lectura ────────────────────────────────────────────────────── */

  async getVersion(actor: Principal, versionId: string): Promise<ShowVersionView> {
    const v = await this.cargar(this.deps.db, versionId);
    this.exigirVisible(actor, v);
    return this.vista(this.deps.db, versionId);
  }

  async openEvidence(actor: Principal, versionId: string, evidenceId: string): Promise<{ evidence: EvidenceView; storageKey: string; stream: Readable }> {
    const v = await this.cargar(this.deps.db, versionId);
    this.exigirVisible(actor, v);
    const row = await this.evidencias(this.deps.db, versionId).where('e.id', '=', evidenceId).executeTakeFirst();
    if (!row) throw new ApprovalError(404, 'EVIDENCE_NOT_FOUND', 'La evidencia no existe para esta versión.');
    return { evidence: toEvidenceView(row), storageKey: row.storage_key, stream: await this.deps.storage.stream(row.storage_key) };
  }

  /* ── evidencia (§19, decisión 2) ────────────────────────────────── */

  async uploadEvidence(input: EvidenceUploadInput): Promise<{ evidence: EvidenceView; replayed: boolean }> {
    const { db, storage } = this.deps;
    // Antes de recibir un byte: la versión existe, es visible y el actor decide sobre ella.
    this.exigirDecisor(input.actor, await this.cargar(db, input.versionId));
    const originalFilename = normalizeOriginalFilename(input.originalFilename);
    const tempId = randomUUID(); // nunca deriva del nombre
    try {
      const r = await this.recibir(tempId, input.body);
      if (input.afterBody) await input.afterBody();
      if (r.kind === 'too_large') {
        throw new ApprovalError(413, 'EVIDENCE_TOO_LARGE', 'La evidencia supera el tamaño máximo permitido.', { limitBytes: this.deps.maxEvidenceBytes });
      }
      if (r.temp.sizeBytes === 0) throw new ApprovalError(422, 'EVIDENCE_EMPTY', 'El archivo de evidencia está vacío.');
      const kind = classifyContent({ head: r.head, isText: r.isText });
      if (!kind) {
        throw new ApprovalError(415, 'EVIDENCE_UNSUPPORTED_CONTENT', 'El contenido no es un tipo de evidencia admitido (PDF, email RFC 5322 o texto).', {
          accepted: ['application/pdf', 'message/rfc822', 'text/plain'],
        });
      }
      const detectedType = TYPE_BY_KIND[kind];
      const mimeType = MIME_BY_KIND[kind];
      if (detectedType !== input.type) {
        throw new ApprovalError(422, 'EVIDENCE_TYPE_MISMATCH', 'El contenido del archivo no corresponde al tipo de evidencia declarado.', {
          declared: input.type, detected: detectedType, mimeType,
        });
      }
      const { temp } = r;
      const fingerprint = requestFingerprint(EVIDENCE_OPERATION, {
        versionId: input.versionId, type: input.type, originalFilename, sha256: temp.sha256, sizeBytes: temp.sizeBytes,
      });
      const res = await this.mapearDb(() =>
        withIdempotency(db, { key: input.idempotencyKey, actorId: input.actor.userId, operation: EVIDENCE_OPERATION, fingerprint }, async (trx) => {
          const v = await this.bloquearYCargar(trx, input.versionId);
          this.exigirDecisor(input.actor, v);
          if (v.decision) throw estadoInvalido(v.decision);
          let commit;
          try {
            commit = await storage.commitContentAddressed(tempId, { sha256: temp.sha256 });
          } catch (e) {
            if (e instanceof StorageIntegrityError) throw new ApprovalError(503, 'EVIDENCE_STORAGE_ERROR', 'No se pudo verificar el archivo almacenado.');
            throw e;
          }
          if (commit.sizeBytes !== temp.sizeBytes) throw new ApprovalError(503, 'EVIDENCE_STORAGE_ERROR', 'No se pudo verificar el archivo almacenado.');
          await trx
            .insertInto('stored_objects')
            .values({ sha256: temp.sha256, storage_key: commit.key, mime_type: mimeType, size_bytes: temp.sizeBytes })
            .onConflict((oc) => oc.column('sha256').doNothing())
            .execute();
          const so = await trx.selectFrom('stored_objects').select(['id', 'mime_type', 'size_bytes']).where('sha256', '=', temp.sha256).executeTakeFirstOrThrow();
          // Los mismos bytes siempre dan el mismo MIME; si no coincide, el objeto previo no es de esta allowlist.
          if (so.mime_type !== mimeType || Number(so.size_bytes) !== temp.sizeBytes) {
            throw new ApprovalError(422, 'EVIDENCE_TYPE_MISMATCH', 'Ese contenido ya está registrado con otro tipo.', { declared: input.type });
          }
          const ev = await trx
            .insertInto('approval_evidence')
            .values({ show_version_id: input.versionId, type: input.type, original_filename: originalFilename, stored_object_id: so.id, uploaded_by: input.actor.userId })
            .returning('id')
            .executeTakeFirstOrThrow();
          await appendAuditEvent(trx, {
            actorUserId: input.actor.userId, action: 'EVIDENCE_UPLOADED', entityType: 'approval_evidence', entityId: ev.id, afterHash: temp.sha256,
            metadata: { showVersionId: input.versionId, type: input.type, mimeType, sizeBytes: temp.sizeBytes, filename: displayFilename(originalFilename), deduplicated: !commit.created },
          });
          const row = await this.evidencias(trx, input.versionId).where('e.id', '=', ev.id).executeTakeFirstOrThrow();
          return { status: 201, body: toEvidenceView(row) };
        }),
      );
      return { evidence: res.body, replayed: res.replayed };
    } finally {
      await storage.deleteTemporary(tempId).catch(() => {});
    }
  }

  private async recibir(tempId: string, body: Readable): Promise<Recibido> {
    const limit = this.deps.maxEvidenceBytes;
    const limitado = limitBody(body, limit);
    const sniffer = new ContentSniffer();
    async function* observar() {
      for await (const c of limitado.stream) {
        sniffer.push(c as Buffer);
        yield c;
      }
    }
    try {
      const temp = await this.deps.storage.putTemporary(tempId, Readable.from(observar(), { objectMode: false }), { maxBytes: limit });
      return { kind: 'ok', temp, ...sniffer.finish() };
    } catch (e) {
      if (!(e instanceof StorageLimitError)) throw e;
      body.destroy();
      return { kind: 'too_large' };
    }
  }

  /* ── aprobar / rechazar (§17, §18, §20) ─────────────────────────── */

  async approve(input: DecisionBase & { evidenceId: string }): Promise<{ version: ShowVersionView; replayed: boolean }> {
    return this.decidir('APPROVED', input, { evidenceId: input.evidenceId, reason: null });
  }

  async reject(input: DecisionBase & { reason: string }): Promise<{ version: ShowVersionView; replayed: boolean }> {
    const reason = input.reason.trim();
    if (reason.length === 0) throw new ApprovalError(422, 'REASON_REQUIRED', 'El rechazo exige un motivo.');
    return this.decidir('REJECTED', input, { evidenceId: null, reason });
  }

  private async decidir(
    decision: 'APPROVED' | 'REJECTED',
    input: DecisionBase,
    extra: { evidenceId: string | null; reason: string | null },
  ): Promise<{ version: ShowVersionView; replayed: boolean }> {
    const { db } = this.deps;
    const operation = decision === 'APPROVED' ? APPROVE_OPERATION : REJECT_OPERATION;
    const fingerprint = requestFingerprint(operation, { versionId: input.versionId, versionHash: input.versionHash, ...extra });
    const r = await this.mapearDb(() =>
      withIdempotency(db, { key: input.idempotencyKey, actorId: input.actor.userId, operation, fingerprint }, async (trx) => {
        const v = await this.bloquearYCargar(trx, input.versionId);
        this.exigirDecisor(input.actor, v);
        if (v.version_hash !== input.versionHash) {
          throw new ApprovalError(409, 'VERSION_HASH_MISMATCH', 'El hash no es el de la versión: la decisión se toma sobre la versión exacta.', { versionHash: v.version_hash });
        }
        if (v.decision) throw estadoInvalido(v.decision);
        if (decision === 'APPROVED') {
          // §18: quien envió no aprueba, aunque tenga los dos roles (la base lo repite).
          if (v.four_eyes_required && v.submitted_by === input.actor.userId) {
            throw new ApprovalError(403, 'FOUR_EYES_VIOLATION', 'Quien envió la versión no puede aprobarla.');
          }
          if (!extra.evidenceId) throw new ApprovalError(422, 'EVIDENCE_REQUIRED', 'Aprobar exige evidencia.');
          const ev = await trx.selectFrom('approval_evidence').select('id').where('id', '=', extra.evidenceId).where('show_version_id', '=', input.versionId).executeTakeFirst();
          if (!ev) throw new ApprovalError(422, 'EVIDENCE_NOT_FOUND', 'La evidencia no existe para esta versión.');
        }
        const ap = await trx
          .insertInto('approvals')
          .values({ show_version_id: input.versionId, decision, actor_user_id: input.actor.userId, evidence_id: extra.evidenceId, reason: extra.reason, version_hash: v.version_hash })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (decision === 'APPROVED') {
          // La "última aprobada" avanza solo hacia una versión más nueva.
          await trx
            .updateTable('campaigns')
            .set({ latest_approved_version_id: input.versionId })
            .where('id', '=', v.campaign_id)
            .where((eb) =>
              eb.or([
                eb('latest_approved_version_id', 'is', null),
                eb(sql<number>`(SELECT sv.version_number FROM show_versions sv WHERE sv.id = campaigns.latest_approved_version_id)`, '<', v.version_number),
              ]),
            )
            .execute();
        }
        await appendAuditEvent(trx, {
          actorUserId: input.actor.userId,
          action: decision === 'APPROVED' ? 'VERSION_APPROVED' : 'VERSION_REJECTED',
          entityType: 'show_version',
          entityId: input.versionId,
          afterHash: v.version_hash,
          metadata: {
            approvalId: ap.id, campaignId: v.campaign_id, contractId: v.contract_id, versionNumber: v.version_number,
            ...(decision === 'APPROVED' ? { evidenceId: extra.evidenceId, fourEyesRequired: v.four_eyes_required } : { reasonLength: extra.reason?.length ?? 0 }),
          },
        });
        return { status: 201, body: await this.vista(trx, input.versionId) };
      }),
    );
    return { version: r.body, replayed: r.replayed };
  }

  /* ── cuatro ojos por contrato (§18) ─────────────────────────────── */

  async setFourEyesRequired(input: { actor: Principal; contractId: string; required: boolean }): Promise<{ contractId: string; fourEyesRequired: boolean; changed: boolean }> {
    if (!input.actor.roles.has('ADMIN')) throw new ApprovalError(403, 'FORBIDDEN', 'Cambiar la política de cuatro ojos requiere ADMIN.');
    return this.deps.db.transaction().execute(async (trx) => {
      const c = await trx.selectFrom('contracts').select(['id', 'four_eyes_required']).where('id', '=', input.contractId).forUpdate().executeTakeFirst();
      if (!c) throw new ApprovalError(404, 'CONTRACT_NOT_FOUND', 'El contrato no existe.');
      if (c.four_eyes_required === input.required) return { contractId: c.id, fourEyesRequired: c.four_eyes_required, changed: false };
      await trx.updateTable('contracts').set({ four_eyes_required: input.required }).where('id', '=', c.id).execute();
      await appendAuditEvent(trx, {
        actorUserId: input.actor.userId,
        // §18/§27: desactivarlo deja un evento EXPLÍCITO; reactivarlo es una actualización del contrato
        action: input.required ? 'CONTRACT_UPDATED' : 'FOUR_EYES_DISABLED',
        entityType: 'contract',
        entityId: c.id,
        metadata: { fourEyesRequired: input.required, previous: c.four_eyes_required },
      });
      return { contractId: c.id, fourEyesRequired: input.required, changed: true };
    });
  }

  /* ── internos ───────────────────────────────────────────────────── */

  private exigirVisible(actor: Principal, v: VersionRow | undefined): asserts v is VersionRow {
    // Inexistente y fuera de scope responden igual: no se revela la existencia.
    if (!v || !canAccessContract(actor, v.contract_id, READ_ROLES)) {
      throw new ApprovalError(404, 'SHOW_VERSION_NOT_FOUND', 'La versión no existe.');
    }
  }

  private exigirDecisor(actor: Principal, v: VersionRow | undefined): asserts v is VersionRow {
    this.exigirVisible(actor, v);
    if (!canAccessContract(actor, v.contract_id, DECIDE_ROLES)) {
      throw new ApprovalError(403, 'FORBIDDEN', 'El usuario no puede decidir sobre esta versión.');
    }
  }

  private async bloquearYCargar(trx: Kysely<Database>, versionId: string): Promise<VersionRow | undefined> {
    const base = await trx.selectFrom('show_versions').select('campaign_id').where('id', '=', versionId).executeTakeFirst();
    if (!base) return undefined;
    // La campaña (no la versión: trust_app no tiene UPDATE sobre show_versions) serializa decisiones y evidencia.
    await trx.selectFrom('campaigns').select('id').where('id', '=', base.campaign_id).forUpdate().execute();
    return this.cargar(trx, versionId);
  }

  private cargar(db: Kysely<Database>, versionId: string): Promise<VersionRow | undefined> {
    return db
      .selectFrom('show_versions as v')
      .innerJoin('campaigns as cp', 'cp.id', 'v.campaign_id')
      .innerJoin('contracts as c', 'c.id', 'cp.contract_id')
      .leftJoin('approvals as ap', 'ap.show_version_id', 'v.id')
      .select([
        'v.id', 'v.campaign_id', 'c.id as contract_id', 'v.version_number', 'v.version_hash', 'v.submitted_by', 'c.four_eyes_required',
        'ap.decision as decision',
      ])
      .where('v.id', '=', versionId)
      .executeTakeFirst();
  }

  private evidencias(db: Kysely<Database>, versionId: string) {
    return db
      .selectFrom('approval_evidence as e')
      .innerJoin('stored_objects as o', 'o.id', 'e.stored_object_id')
      .select(['e.id', 'e.show_version_id', 'e.type', 'e.original_filename', 'e.uploaded_by', 'e.uploaded_at', 'o.mime_type', 'o.size_bytes', 'o.sha256', 'o.storage_key'])
      .where('e.show_version_id', '=', versionId);
  }

  private async vista(db: Kysely<Database>, versionId: string): Promise<ShowVersionView> {
    const v = await db
      .selectFrom('show_versions as v')
      .innerJoin('campaigns as cp', 'cp.id', 'v.campaign_id')
      .innerJoin('contracts as c', 'c.id', 'cp.contract_id')
      .selectAll('v')
      .select(['c.id as contract_id', 'c.four_eyes_required'])
      .where('v.id', '=', versionId)
      .executeTakeFirstOrThrow();
    const ap = await db.selectFrom('approvals').selectAll().where('show_version_id', '=', versionId).executeTakeFirst();
    const evs = await this.evidencias(db, versionId).orderBy('e.uploaded_at', 'asc').orderBy('e.id', 'asc').execute();
    const assets = await db.selectFrom('show_version_assets').select(['logical_ref', 'asset_id', 'sha256']).where('show_version_id', '=', versionId).orderBy('logical_ref').execute();
    return {
      id: v.id,
      campaignId: v.campaign_id,
      contractId: v.contract_id,
      versionNumber: v.version_number,
      versionHash: v.version_hash,
      hashAlgorithm: v.hash_algorithm,
      canonicalizationVersion: v.canonicalization_version,
      hashEnvelopeVersion: v.hash_envelope_version,
      showPackageSchemaVersion: v.show_package_schema_version,
      compilerVersion: v.compiler_version,
      sourceDraftId: v.source_draft_id,
      sourceDraftRevision: v.source_draft_revision,
      submittedBy: v.submitted_by,
      submittedAt: iso(v.submitted_at),
      status: ap ? ap.decision : 'SUBMITTED',
      fourEyesRequired: v.four_eyes_required,
      approval: ap
        ? { id: ap.id, decision: ap.decision, actorUserId: ap.actor_user_id, evidenceId: ap.evidence_id, reason: ap.reason, versionHash: ap.version_hash, createdAt: iso(ap.created_at) }
        : null,
      evidence: evs.map(toEvidenceView),
      assets: assets.map((a) => ({ logicalRef: a.logical_ref, assetId: a.asset_id, sha256: a.sha256 })),
    };
  }

  private async mapearDb<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApprovalError) throw e;
      throw fromDatabaseError(e) ?? e;
    }
  }
}

interface VersionRow {
  id: string;
  campaign_id: string;
  contract_id: string;
  version_number: number;
  version_hash: string;
  submitted_by: string;
  four_eyes_required: boolean;
  decision: 'APPROVED' | 'REJECTED' | null;
}

const estadoInvalido = (actual: 'APPROVED' | 'REJECTED') =>
  new ApprovalError(409, 'INVALID_STATE_TRANSITION', `La versión ya está ${actual}: solo se decide sobre una versión SUBMITTED.`, { status: actual });

interface EvidenceRow {
  id: string;
  show_version_id: string;
  type: EvidenceType;
  original_filename: string;
  uploaded_by: string;
  uploaded_at: Date;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
}

function toEvidenceView(r: EvidenceRow): EvidenceView {
  return {
    id: r.id,
    showVersionId: r.show_version_id,
    type: r.type,
    originalFilename: r.original_filename,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    sha256: r.sha256,
    uploadedBy: r.uploaded_by,
    uploadedAt: iso(r.uploaded_at),
  };
}
