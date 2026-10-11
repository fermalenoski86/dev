import { appendAuditEvent } from '@trust/platform-audit';
import { type Principal, type Role, canAccessContract } from '@trust/platform-auth';
import { type ActiveVersionChangeStatus, type Database, type IdempotentResult, requestFingerprint, withIdempotency } from '@trust/platform-db';
import { type Kysely, sql } from 'kysely';
import { CampaignError, READ_ROLES } from './service';

/**
 * F3(a) — versión vigente administrativa con cuatro ojos
 * (brief `docs/briefs/F3A_REDEPLOY.md`, aprobado en #50; ADR-064).
 *
 *   · `campaigns.active_version_id` es un puntero de control plane: NO hay
 *     Deploy, ni EDGE, ni nada que se empuje. Nace NULL (migración 0004).
 *   · A2.2: aprobar una versión NUNCA la vuelve vigente. Toda selección o
 *     cambio es pedido (OPERATOR/ADMIN) + confirmación (INTERNAL_APPROVER/ADMIN)
 *     por OTRA persona, siempre, sin importar `four_eyes_required`.
 *   · La única escritura del puntero es `trust_confirm_active_version_change`
 *     (SECURITY DEFINER), que repite todas las invariantes con la campaña
 *     bloqueada. La app chequea antes (primera barrera) para dar el error justo.
 *   · Las tres mutaciones usan `withIdempotency`: el replay repite el MISMO
 *     status y el MISMO body (201→201, 200→200, 409→409).
 *   · §3.7: vencimiento y "la vigente cambió" TERMINALIZAN el pedido y responden
 *     409. Eso se DEVUELVE (no se lanza) desde la función de `withIdempotency`:
 *     la transacción hace COMMIT con el estado terminal, su audit y la respuesta
 *     guardada. Los 409 que no cambian nada se lanzan y hacen rollback.
 *   · Vencimiento perezoso (sin job), medido con `now()` de PostgreSQL.
 */
export const REQUEST_ROLES: readonly Role[] = ['OPERATOR', 'ADMIN'];
export const CONFIRM_ROLES: readonly Role[] = ['INTERNAL_APPROVER', 'ADMIN'];
/** Cancelar: quien pidió (OPERATOR/ADMIN) o ADMIN; el "quien pidió" lo chequea el servicio. */
export const CANCEL_ROLES: readonly Role[] = ['OPERATOR', 'ADMIN'];

export const REQUEST_OPERATION = 'active-version-change.request';
export const CONFIRM_OPERATION = 'active-version-change.confirm';
export const CANCEL_OPERATION = 'active-version-change.cancel';

/** ACTIVE_VERSION_CHANGE_TTL_MINUTES: default 24 h (Q5). */
export const DEFAULT_ACTIVE_VERSION_CHANGE_TTL_MINUTES = 24 * 60;
export const ACTIVE_VERSION_CHANGE_TTL_MAX_MINUTES = 7 * 24 * 60;

export function activeVersionChangeTtlFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const v = env.ACTIVE_VERSION_CHANGE_TTL_MINUTES;
  if (v === undefined || v === '') return DEFAULT_ACTIVE_VERSION_CHANGE_TTL_MINUTES;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1 || n > ACTIVE_VERSION_CHANGE_TTL_MAX_MINUTES) {
    throw new Error(`ACTIVE_VERSION_CHANGE_TTL_MINUTES tiene que ser un entero entre 1 y ${ACTIVE_VERSION_CHANGE_TTL_MAX_MINUTES} (vino "${v}")`);
  }
  return n;
}

export const CHANGE_PAGE_MAX = 100;
export const CHANGE_PAGE_DEFAULT = 20;

export interface ActiveVersionChangeView {
  id: string;
  campaignId: string;
  fromVersionId: string | null;
  toVersionId: string;
  toVersionHash: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  status: ActiveVersionChangeStatus;
  decidedBy: string | null;
  decidedAt: string | null;
}

/** Cuerpo de error guardado con la key (§3.7): mismo contrato `{ code, message, details?, requestId }`. */
export interface StoredErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
}

export type ChangeResult = IdempotentResult<ActiveVersionChangeView | StoredErrorBody>;

interface Base {
  actor: Principal;
  idempotencyKey: string;
  /** Va dentro del body de un 409 con efecto: el replay lo repite tal cual (mismo body). */
  requestId: string;
}

const iso = (d: Date | string) => new Date(d).toISOString();

const exigirRol = (actor: Principal, roles: readonly Role[]) => {
  if (!roles.some((r) => actor.roles.has(r))) throw new CampaignError(403, 'FORBIDDEN', 'El usuario no tiene un rol que permita esta operación.');
};

export class ActiveVersionService {
  constructor(private readonly deps: { db: Kysely<Database>; ttlMinutes: number }) {
    if (!Number.isSafeInteger(deps.ttlMinutes) || deps.ttlMinutes < 1 || deps.ttlMinutes > ACTIVE_VERSION_CHANGE_TTL_MAX_MINUTES) {
      throw new Error(`ttlMinutes fuera de rango: ${deps.ttlMinutes}`);
    }
  }

  /* ── pedir ──────────────────────────────────────────────────────── */

  async request(input: Base & { campaignId: string; versionId: string; versionHash: string; reason: string; expectedActiveVersionId: string | null }): Promise<ChangeResult> {
    exigirRol(input.actor, REQUEST_ROLES);
    // 1–2000 lo valida la ruta (Zod) y lo repite el CHECK de la tabla.
    const reason = input.reason.trim();
    const fingerprint = requestFingerprint(REQUEST_OPERATION, {
      campaignId: input.campaignId, versionId: input.versionId, versionHash: input.versionHash, reason, expectedActiveVersionId: input.expectedActiveVersionId,
    });
    return this.mapearDb(() =>
      withIdempotency<ActiveVersionChangeView | StoredErrorBody>(this.deps.db, { key: input.idempotencyKey, actorId: input.actor.userId, operation: REQUEST_OPERATION, fingerprint }, async (trx) => {
        const cp = await trx
          .selectFrom('campaigns')
          .select(['id', 'contract_id', 'lifecycle_status', 'active_version_id'])
          .where('id', '=', input.campaignId)
          .forUpdate()
          .executeTakeFirst();
        if (!cp || !canAccessContract(input.actor, cp.contract_id, REQUEST_ROLES)) throw new CampaignError(404, 'CAMPAIGN_NOT_FOUND', 'La campaña no existe.');
        if (cp.lifecycle_status !== 'ACTIVE') {
          throw new CampaignError(409, 'INVALID_STATE_TRANSITION', 'La campaña está archivada: no se cambia su versión vigente.', { lifecycleStatus: cp.lifecycle_status });
        }
        // Vencimiento perezoso del PENDING anterior (si lo hay y venció), con su audit.
        await this.vencerSiCorresponde(trx, cp.id, input.actor.userId);
        const pend = await trx.selectFrom('active_version_changes').select('id').where('campaign_id', '=', cp.id).where('status', '=', 'PENDING').executeTakeFirst();
        if (pend) throw new CampaignError(409, 'ACTIVE_VERSION_CHANGE_PENDING', 'Ya hay un pedido de cambio pendiente para esta campaña.', { changeId: pend.id });

        const v = await trx
          .selectFrom('show_versions as v')
          .leftJoin('approvals as ap', 'ap.show_version_id', 'v.id')
          .select(['v.id', 'v.version_hash', 'v.version_number', 'ap.decision as decision'])
          .where('v.id', '=', input.versionId)
          .where('v.campaign_id', '=', cp.id)
          .executeTakeFirst();
        // de otra campaña o inexistente: el mismo 404, sin revelar cuál
        if (!v) throw new CampaignError(404, 'SHOW_VERSION_NOT_FOUND', 'La versión no existe en esta campaña.');
        if (v.decision !== 'APPROVED') {
          throw new CampaignError(409, 'INVALID_STATE_TRANSITION', 'Solo una versión APPROVED puede ser la vigente.', { status: v.decision ?? 'SUBMITTED' });
        }
        if (v.version_hash !== input.versionHash) {
          throw new CampaignError(409, 'VERSION_HASH_MISMATCH', 'El hash no es el de la versión: se pide sobre la versión exacta.', { versionHash: v.version_hash });
        }
        // Concurrencia optimista con NULL posible de los dos lados: igualdad estricta, nunca "distinto de".
        if (cp.active_version_id !== input.expectedActiveVersionId) {
          throw new CampaignError(409, 'ACTIVE_VERSION_CONFLICT', 'La versión vigente cambió: volvé a leer la campaña.', { activeVersionId: cp.active_version_id });
        }
        if (cp.active_version_id === v.id) throw new CampaignError(409, 'ACTIVE_VERSION_UNCHANGED', 'Esa versión ya es la vigente.');

        const ttl = this.deps.ttlMinutes;
        const ch = await trx
          .insertInto('active_version_changes')
          .values({
            campaign_id: cp.id,
            from_version_id: cp.active_version_id,
            to_version_id: v.id,
            to_version_hash: v.version_hash,
            reason,
            requested_by: input.actor.userId,
            expires_at: sql<string>`now() + make_interval(mins => ${ttl})` as unknown as string,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await appendAuditEvent(trx, {
          actorUserId: input.actor.userId, action: 'ACTIVE_VERSION_CHANGE_REQUESTED', entityType: 'active_version_change', entityId: ch.id,
          beforeHash: await this.hashDe(trx, cp.active_version_id), afterHash: v.version_hash,
          metadata: { campaignId: cp.id, fromVersionId: cp.active_version_id, toVersionId: v.id, toVersionNumber: v.version_number, reason },
        });
        return { status: 201, body: await this.vista(trx, ch.id) };
      }),
    );
  }

  /* ── confirmar ──────────────────────────────────────────────────── */

  async confirm(input: Base & { changeId: string; versionHash: string }): Promise<ChangeResult> {
    exigirRol(input.actor, CONFIRM_ROLES);
    const fingerprint = requestFingerprint(CONFIRM_OPERATION, { changeId: input.changeId, versionHash: input.versionHash });
    return this.mapearDb(() =>
      withIdempotency<ActiveVersionChangeView | StoredErrorBody>(this.deps.db, { key: input.idempotencyKey, actorId: input.actor.userId, operation: CONFIRM_OPERATION, fingerprint }, async (trx) => {
        const ch = await this.bloquearPedido(trx, input.actor, input.changeId, CONFIRM_ROLES);
        if (ch.status !== 'PENDING') throw estadoInvalido(ch.status);
        // Cuatro ojos SIEMPRE (A2.2): no depende de four_eyes_required. La función y el trigger lo repiten.
        if (ch.requested_by === input.actor.userId) {
          throw new CampaignError(403, 'FOUR_EYES_VIOLATION', 'Quien pidió el cambio no puede confirmarlo.');
        }
        if (ch.to_version_hash !== input.versionHash) {
          throw new CampaignError(409, 'VERSION_HASH_MISMATCH', 'El hash no es el del pedido: se confirma lo que se vio.', { versionHash: ch.to_version_hash });
        }
        if (ch.lifecycle_status !== 'ACTIVE') {
          throw new CampaignError(409, 'INVALID_STATE_TRANSITION', 'La campaña está archivada: no se cambia su versión vigente.', { lifecycleStatus: ch.lifecycle_status });
        }
        const r = await sql<{ outcome: string }>`
          SELECT trust_confirm_active_version_change(${input.changeId}::uuid, ${input.actor.userId}::uuid, ${input.versionHash}) AS outcome`.execute(trx);
        const outcome = r.rows[0]?.outcome;
        if (outcome === 'EXPIRED') {
          await this.auditarVencido(trx, ch.id, ch.campaign_id, input.actor.userId);
          return this.error409(input.requestId, 'ACTIVE_VERSION_CHANGE_EXPIRED', 'El pedido venció: hay que pedirlo de nuevo.', { changeId: ch.id, status: 'EXPIRED' });
        }
        if (outcome === 'CONFLICT') {
          const actual = await trx.selectFrom('campaigns').select('active_version_id').where('id', '=', ch.campaign_id).executeTakeFirstOrThrow();
          await appendAuditEvent(trx, {
            actorUserId: input.actor.userId, action: 'ACTIVE_VERSION_CHANGE_CANCELLED', entityType: 'active_version_change', entityId: ch.id,
            metadata: { campaignId: ch.campaign_id, cause: 'ACTIVE_VERSION_CONFLICT', fromVersionId: ch.from_version_id, activeVersionId: actual.active_version_id, toVersionId: ch.to_version_id },
          });
          return this.error409(input.requestId, 'ACTIVE_VERSION_CONFLICT', 'La versión vigente cambió desde el pedido: el pedido quedó cancelado.', {
            changeId: ch.id, status: 'CANCELLED', activeVersionId: actual.active_version_id,
          });
        }
        if (outcome !== 'CONFIRMED') throw new Error(`trust_confirm_active_version_change devolvió ${String(outcome)}`);
        await appendAuditEvent(trx, {
          actorUserId: input.actor.userId, action: 'ACTIVE_VERSION_CHANGED', entityType: 'campaign', entityId: ch.campaign_id,
          beforeHash: await this.hashDe(trx, ch.from_version_id), afterHash: ch.to_version_hash,
          metadata: { campaignId: ch.campaign_id, fromVersionId: ch.from_version_id, toVersionId: ch.to_version_id, requestId: ch.id, requestedBy: ch.requested_by, reason: ch.reason },
        });
        return { status: 200, body: await this.vista(trx, ch.id) };
      }),
    );
  }

  /* ── cancelar ───────────────────────────────────────────────────── */

  async cancel(input: Base & { changeId: string }): Promise<ChangeResult> {
    exigirRol(input.actor, CANCEL_ROLES);
    const fingerprint = requestFingerprint(CANCEL_OPERATION, { changeId: input.changeId });
    return this.mapearDb(() =>
      withIdempotency<ActiveVersionChangeView | StoredErrorBody>(this.deps.db, { key: input.idempotencyKey, actorId: input.actor.userId, operation: CANCEL_OPERATION, fingerprint }, async (trx) => {
        const ch = await this.bloquearPedido(trx, input.actor, input.changeId, CANCEL_ROLES);
        if (ch.requested_by !== input.actor.userId && !input.actor.roles.has('ADMIN')) {
          throw new CampaignError(403, 'FORBIDDEN', 'Solo quien pidió el cambio o un ADMIN pueden cancelarlo.');
        }
        if (ch.status !== 'PENDING') throw estadoInvalido(ch.status);
        if (ch.vencido) {
          await trx.updateTable('active_version_changes').set({ status: 'EXPIRED' }).where('id', '=', ch.id).execute();
          await this.auditarVencido(trx, ch.id, ch.campaign_id, input.actor.userId);
          return this.error409(input.requestId, 'ACTIVE_VERSION_CHANGE_EXPIRED', 'El pedido ya había vencido.', { changeId: ch.id, status: 'EXPIRED' });
        }
        await trx.updateTable('active_version_changes').set({ status: 'CANCELLED', decided_by: input.actor.userId }).where('id', '=', ch.id).execute();
        await appendAuditEvent(trx, {
          actorUserId: input.actor.userId, action: 'ACTIVE_VERSION_CHANGE_CANCELLED', entityType: 'active_version_change', entityId: ch.id,
          metadata: { campaignId: ch.campaign_id, cause: 'CANCELLED_BY_USER', fromVersionId: ch.from_version_id, toVersionId: ch.to_version_id },
        });
        return { status: 200, body: await this.vista(trx, ch.id) };
      }),
    );
  }

  /* ── lectura ────────────────────────────────────────────────────── */

  /** Historial de pedidos de la campaña, más nuevo primero (keyset como BL-31). */
  async list(actor: Principal, campaignId: string, o: { limit: number; cursor?: string }): Promise<{ items: ActiveVersionChangeView[]; nextCursor: string | null }> {
    if (!Number.isSafeInteger(o.limit) || o.limit < 1 || o.limit > CHANGE_PAGE_MAX) throw new Error(`limit fuera de rango: ${o.limit}`);
    const db = this.deps.db;
    const cp = await db.selectFrom('campaigns').select(['id', 'contract_id']).where('id', '=', campaignId).executeTakeFirst();
    if (!cp || !canAccessContract(actor, cp.contract_id, READ_ROLES)) throw new CampaignError(404, 'CAMPAIGN_NOT_FOUND', 'La campaña no existe.');
    let q = db.selectFrom('active_version_changes').selectAll().where('campaign_id', '=', campaignId);
    if (o.cursor !== undefined) {
      const c = await db.selectFrom('active_version_changes').select(['requested_at', 'id']).where('id', '=', o.cursor).where('campaign_id', '=', campaignId).executeTakeFirst();
      if (!c) throw new CampaignError(400, 'INVALID_CURSOR', 'El cursor no corresponde a este historial.');
      q = q.where(sql<boolean>`(requested_at, id) < (${c.requested_at}::timestamptz, ${c.id}::uuid)`);
    }
    const filas = await q.orderBy('requested_at', 'desc').orderBy('id', 'desc').limit(o.limit + 1).execute();
    const items = filas.slice(0, o.limit).map(toView);
    return { items, nextCursor: filas.length > o.limit ? (items.at(-1)?.id ?? null) : null };
  }

  /* ── internos ───────────────────────────────────────────────────── */

  /** Campaña → pedido, el mismo orden de locks que la función de confirmación. */
  private async bloquearPedido(trx: Kysely<Database>, actor: Principal, changeId: string, roles: readonly Role[]) {
    const base = await trx
      .selectFrom('active_version_changes as ch')
      .innerJoin('campaigns as cp', 'cp.id', 'ch.campaign_id')
      .select(['ch.campaign_id', 'cp.contract_id'])
      .where('ch.id', '=', changeId)
      .executeTakeFirst();
    if (!base || !canAccessContract(actor, base.contract_id, roles)) {
      throw new CampaignError(404, 'ACTIVE_VERSION_CHANGE_NOT_FOUND', 'El pedido de cambio no existe.');
    }
    const cp = await trx.selectFrom('campaigns').select(['lifecycle_status']).where('id', '=', base.campaign_id).forUpdate().executeTakeFirstOrThrow();
    const ch = await trx
      .selectFrom('active_version_changes')
      .selectAll()
      .select(sql<boolean>`expires_at <= now()`.as('vencido'))
      .where('id', '=', changeId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    return { ...ch, lifecycle_status: cp.lifecycle_status };
  }

  private async vencerSiCorresponde(trx: Kysely<Database>, campaignId: string, observedBy: string): Promise<void> {
    const vencidos = await trx
      .updateTable('active_version_changes')
      .set({ status: 'EXPIRED' })
      .where('campaign_id', '=', campaignId)
      .where('status', '=', 'PENDING')
      .where(sql<boolean>`expires_at <= now()`)
      .returning('id')
      .execute();
    for (const v of vencidos) await this.auditarVencido(trx, v.id, campaignId, observedBy);
  }

  /** El vencimiento lo decide el reloj de la base, no una persona: actor null; quién lo observó va en metadata. */
  private async auditarVencido(trx: Kysely<Database>, changeId: string, campaignId: string, observedBy: string) {
    await appendAuditEvent(trx, {
      actorUserId: null, action: 'ACTIVE_VERSION_CHANGE_EXPIRED', entityType: 'active_version_change', entityId: changeId,
      metadata: { campaignId, observedBy },
    });
  }

  private error409(requestId: string, code: string, message: string, details: Record<string, unknown>) {
    return { status: 409, body: { code, message, details, requestId } satisfies StoredErrorBody };
  }

  private async hashDe(db: Kysely<Database>, versionId: string | null): Promise<string | null> {
    if (!versionId) return null;
    const v = await db.selectFrom('show_versions').select('version_hash').where('id', '=', versionId).executeTakeFirstOrThrow();
    return v.version_hash;
  }

  private async vista(db: Kysely<Database>, changeId: string): Promise<ActiveVersionChangeView> {
    return toView(await db.selectFrom('active_version_changes').selectAll().where('id', '=', changeId).executeTakeFirstOrThrow());
  }

  private async mapearDb<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CampaignError) throw e;
      throw fromActiveVersionDbError(e) ?? e;
    }
  }
}

const estadoInvalido = (actual: ActiveVersionChangeStatus) =>
  new CampaignError(409, 'INVALID_STATE_TRANSITION', `El pedido ya está ${actual}: solo se decide sobre un pedido PENDING.`, { status: actual });

/** Traduce la segunda barrera (función, triggers, índice único) al mismo error que da la app. */
export function fromActiveVersionDbError(e: unknown): CampaignError | null {
  const x = e as { code?: string; message?: string; constraint?: string };
  const msg = typeof x?.message === 'string' ? x.message : '';
  if (x?.code === 'P0001') {
    if (msg.startsWith('FOUR_EYES_VIOLATION')) return new CampaignError(403, 'FOUR_EYES_VIOLATION', 'Quien pidió el cambio no puede confirmarlo.');
    if (msg.startsWith('VERSION_HASH_MISMATCH')) return new CampaignError(409, 'VERSION_HASH_MISMATCH', 'El hash no es el de la versión.');
    if (msg.startsWith('ACTIVE_NOT_APPROVED')) return new CampaignError(409, 'INVALID_STATE_TRANSITION', 'Solo una versión APPROVED puede ser la vigente.');
    if (msg.startsWith('INVALID_STATE_TRANSITION')) return new CampaignError(409, 'INVALID_STATE_TRANSITION', 'El pedido ya no está pendiente.');
    if (msg.startsWith('CONFIRMER_NOT_AUTHORIZED') || msg.startsWith('REQUESTER_NOT_AUTHORIZED')) {
      return new CampaignError(403, 'FORBIDDEN', 'El usuario no tiene un rol que permita esta operación.');
    }
    if (msg.startsWith('CHANGE_NOT_FOUND')) return new CampaignError(404, 'ACTIVE_VERSION_CHANGE_NOT_FOUND', 'El pedido de cambio no existe.');
  }
  if (x?.code === '23505' && x.constraint === 'avc_one_pending_per_campaign') {
    return new CampaignError(409, 'ACTIVE_VERSION_CHANGE_PENDING', 'Ya hay un pedido de cambio pendiente para esta campaña.');
  }
  return null;
}

interface ChangeRow {
  id: string; campaign_id: string; from_version_id: string | null; to_version_id: string; to_version_hash: string; reason: string;
  requested_by: string; requested_at: Date; expires_at: Date; status: ActiveVersionChangeStatus; decided_by: string | null; decided_at: Date | null;
}

function toView(r: ChangeRow): ActiveVersionChangeView {
  return {
    id: r.id, campaignId: r.campaign_id, fromVersionId: r.from_version_id, toVersionId: r.to_version_id, toVersionHash: r.to_version_hash, reason: r.reason,
    requestedBy: r.requested_by, requestedAt: iso(r.requested_at), expiresAt: iso(r.expires_at), status: r.status,
    decidedBy: r.decided_by, decidedAt: r.decided_at ? iso(r.decided_at) : null,
  };
}
