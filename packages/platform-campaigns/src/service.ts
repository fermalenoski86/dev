import { appendAuditEvent } from '@trust/platform-audit';
import { type Principal, type Role, hasAnyRole } from '@trust/platform-auth';
import { buildingSurfaceIds, canonicalize, sha256Hex } from '@trust/platform-contracts';
import type { Database } from '@trust/platform-db';
import { PRESET_EMPTY, type TakeoverDraft, safeParseTakeoverDraft } from '@trust/show-authoring';
import { type Kysely, sql } from 'kysely';
import { screensOutsideContract } from './surfaces';

/**
 * CampaignService — M3A.1 Fase D1 (master §5–9, §27, §30; brief D aprobado).
 *
 *   · Advertisers y Contracts: solo ADMIN escribe; los roles internos leen.
 *   · Campaigns: OPERATOR o ADMIN crean; se crean con su Draft inicial en la
 *     misma transacción (`current_draft_id`), y `GET` expone a la vez el draft
 *     de trabajo y la última versión aprobada (§7, §32).
 *   · Draft: `PUT` con `expectedRevision` (§8). Si no coincide → 409
 *     `DRAFT_CONFLICT` con { serverRevision, clientRevision, serverUpdatedAt }
 *     (§9) y NO se escribe nada. Nunca last-write-wins ni merge automático. La
 *     escritura es un UPDATE condicionado a la revisión esperada (atómico) y el
 *     trigger de 0001 exige que avance exactamente 1.
 *   · §6: el draft no puede usar pantallas fuera de `allowed_surfaces` del
 *     contrato (422 `SURFACE_NOT_CONTRACTED`) — en la creación, en el PUT y en
 *     el submit (platform-approval). Reducir las superficies de un contrato no
 *     reescribe nada: la regla vale para las escrituras y submits siguientes.
 *
 * EXTERNAL_APPROVER no usa estas rutas (portal externo fuera de alcance).
 */
export type CampaignErrorCode =
  | 'FORBIDDEN'
  | 'ADVERTISER_NOT_FOUND'
  | 'ADVERTISER_EXISTS'
  | 'CONTRACT_NOT_FOUND'
  | 'CONTRACT_INVALID'
  | 'CAMPAIGN_NOT_FOUND'
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_INVALID'
  | 'DRAFT_CONFLICT'
  | 'SURFACE_NOT_CONTRACTED'
  | 'INVALID_STATE_TRANSITION';

export class CampaignError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: CampaignErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const READ_ROLES: readonly Role[] = ['OPERATOR', 'INTERNAL_APPROVER', 'ADMIN'];
export const ADMIN_ROLES: readonly Role[] = ['ADMIN'];
export const EDIT_ROLES: readonly Role[] = ['OPERATOR', 'ADMIN'];

const exigir = (actor: Principal, roles: readonly Role[]) => {
  if (!hasAnyRole(actor, roles)) throw new CampaignError(403, 'FORBIDDEN', 'El usuario no tiene un rol que permita esta operación.');
};
const iso = (d: Date | string) => new Date(d).toISOString();

/** Huella del draft para el audit: nunca el JSON, solo su sha256 canónico. */
export const draftHash = (draft: unknown): string => sha256Hex(canonicalize(draft));

/* ── vistas ─────────────────────────────────────────────────────────── */

export interface AdvertiserView { id: string; legalName: string; taxId: string; commercialName: string | null; contacts: unknown[]; status: 'ACTIVE' | 'INACTIVE'; createdAt: string; updatedAt: string }
export interface ContractView {
  id: string; advertiserId: string; name: string; startsAt: string; endsAt: string; status: 'DRAFT' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
  allowedSurfaces: string[]; fourEyesRequired: boolean; externalApprovalEnabled: boolean; metadata: Record<string, unknown>; createdAt: string; updatedAt: string;
}
export interface CampaignView {
  id: string; contractId: string; name: string; lifecycleStatus: 'ACTIVE' | 'ARCHIVED';
  currentDraft: { id: string; revision: number; updatedAt: string } | null;
  latestApprovedVersion: { id: string; versionNumber: number; versionHash: string } | null;
  createdAt: string; updatedAt: string;
}
export interface DraftView { campaignId: string; draftId: string; revision: number; updatedAt: string; takeoverDraft: TakeoverDraft }

export interface ContractInput {
  advertiserId: string; name: string; startsAt: string; endsAt: string; status?: ContractView['status'];
  allowedSurfaces: string[]; externalApprovalEnabled?: boolean; metadata?: Record<string, unknown>;
}
export type ContractPatch = Partial<Omit<ContractInput, 'advertiserId'>>;

export interface ListOptions { limit: number; cursor?: string }

export class CampaignService {
  constructor(private readonly db: Kysely<Database>) {}

  /* ── advertisers (§5) ────────────────────────────────────────────── */

  async createAdvertiser(actor: Principal, input: { legalName: string; taxId: string; commercialName?: string | null; contacts?: unknown[] }): Promise<AdvertiserView> {
    exigir(actor, ADMIN_ROLES);
    return this.db.transaction().execute(async (trx) => {
      const dup = await trx.selectFrom('advertisers').select('id').where('tax_id', '=', input.taxId).executeTakeFirst();
      if (dup) throw new CampaignError(409, 'ADVERTISER_EXISTS', 'Ya existe un anunciante con ese CUIT/tax id.', { advertiserId: dup.id });
      const a = await trx
        .insertInto('advertisers')
        .values({ legal_name: input.legalName, tax_id: input.taxId, commercial_name: input.commercialName ?? null, contacts: JSON.stringify(input.contacts ?? []) })
        .returningAll()
        .executeTakeFirstOrThrow();
      // sin datos comerciales en el audit: el id alcanza para rastrear
      await appendAuditEvent(trx, { actorUserId: actor.userId, action: 'ADVERTISER_CREATED', entityType: 'advertiser', entityId: a.id, metadata: {} });
      return toAdvertiser(a);
    });
  }

  async listAdvertisers(actor: Principal, o: ListOptions): Promise<{ items: AdvertiserView[]; nextCursor: string | null }> {
    exigir(actor, READ_ROLES);
    let q = this.db.selectFrom('advertisers').selectAll();
    if (o.cursor) q = q.where(sql<boolean>`(created_at, id) < (SELECT x.created_at, x.id FROM advertisers x WHERE x.id = ${o.cursor}::uuid)`);
    const filas = await q.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(o.limit + 1).execute();
    return pagina(filas, o.limit, toAdvertiser);
  }

  /* ── contracts (§6) ──────────────────────────────────────────────── */

  async createContract(actor: Principal, input: ContractInput): Promise<ContractView> {
    exigir(actor, ADMIN_ROLES);
    const surfaces = validarSuperficies(input.allowedSurfaces);
    validarFechas(input.startsAt, input.endsAt);
    return this.db.transaction().execute(async (trx) => {
      const adv = await trx.selectFrom('advertisers').select('id').where('id', '=', input.advertiserId).executeTakeFirst();
      if (!adv) throw new CampaignError(404, 'ADVERTISER_NOT_FOUND', 'El anunciante no existe.');
      const c = await trx
        .insertInto('contracts')
        .values({
          advertiser_id: input.advertiserId, name: input.name, starts_at: input.startsAt, ends_at: input.endsAt, status: input.status ?? 'DRAFT',
          allowed_surfaces: surfaces, external_approval_enabled: input.externalApprovalEnabled ?? false, metadata: JSON.stringify(input.metadata ?? {}),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await appendAuditEvent(trx, {
        actorUserId: actor.userId, action: 'CONTRACT_CREATED', entityType: 'contract', entityId: c.id,
        metadata: { advertiserId: c.advertiser_id, allowedSurfaces: surfaces, status: c.status, externalApprovalEnabled: c.external_approval_enabled },
      });
      return toContract(c);
    });
  }

  /** Cambia nombre, fechas, estado, superficies o aprobación externa. Nunca el anunciante ni cuatro ojos (tiene su ruta). */
  async updateContract(actor: Principal, contractId: string, patch: ContractPatch): Promise<ContractView> {
    exigir(actor, ADMIN_ROLES);
    return this.db.transaction().execute(async (trx) => {
      const prev = await trx.selectFrom('contracts').selectAll().where('id', '=', contractId).forUpdate().executeTakeFirst();
      if (!prev) throw new CampaignError(404, 'CONTRACT_NOT_FOUND', 'El contrato no existe.');
      const set: Record<string, unknown> = {};
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.startsAt !== undefined) set.starts_at = patch.startsAt;
      if (patch.endsAt !== undefined) set.ends_at = patch.endsAt;
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.allowedSurfaces !== undefined) set.allowed_surfaces = validarSuperficies(patch.allowedSurfaces);
      if (patch.externalApprovalEnabled !== undefined) set.external_approval_enabled = patch.externalApprovalEnabled;
      if (patch.metadata !== undefined) set.metadata = JSON.stringify(patch.metadata);
      validarFechas(patch.startsAt ?? iso(prev.starts_at), patch.endsAt ?? iso(prev.ends_at));
      if (Object.keys(set).length === 0) return toContract(prev);
      const c = await trx.updateTable('contracts').set(set).where('id', '=', contractId).returningAll().executeTakeFirstOrThrow();
      await appendAuditEvent(trx, {
        actorUserId: actor.userId, action: 'CONTRACT_UPDATED', entityType: 'contract', entityId: c.id,
        metadata: { fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined).sort(), allowedSurfaces: c.allowed_surfaces, status: c.status },
      });
      return toContract(c);
    });
  }

  async getContract(actor: Principal, contractId: string): Promise<ContractView> {
    exigir(actor, READ_ROLES);
    const c = await this.db.selectFrom('contracts').selectAll().where('id', '=', contractId).executeTakeFirst();
    if (!c) throw new CampaignError(404, 'CONTRACT_NOT_FOUND', 'El contrato no existe.');
    return toContract(c);
  }

  async listContracts(actor: Principal, o: ListOptions & { advertiserId?: string }): Promise<{ items: ContractView[]; nextCursor: string | null }> {
    exigir(actor, READ_ROLES);
    let q = this.db.selectFrom('contracts').selectAll();
    if (o.advertiserId) q = q.where('advertiser_id', '=', o.advertiserId);
    if (o.cursor) q = q.where(sql<boolean>`(created_at, id) < (SELECT x.created_at, x.id FROM contracts x WHERE x.id = ${o.cursor}::uuid)`);
    const filas = await q.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(o.limit + 1).execute();
    return pagina(filas, o.limit, toContract);
  }

  /* ── campaigns (§7) ──────────────────────────────────────────────── */

  async createCampaign(actor: Principal, input: { contractId: string; name: string; takeoverDraft?: unknown }): Promise<CampaignView> {
    exigir(actor, EDIT_ROLES);
    const draft = input.takeoverDraft === undefined ? { ...PRESET_EMPTY(), name: input.name, campaignName: input.name } : parseDraft(input.takeoverDraft);
    return this.db.transaction().execute(async (trx) => {
      const ct = await trx.selectFrom('contracts').select(['id', 'allowed_surfaces', 'status']).where('id', '=', input.contractId).forShare().executeTakeFirst();
      if (!ct) throw new CampaignError(404, 'CONTRACT_NOT_FOUND', 'El contrato no existe.');
      exigirSuperficies(draft, ct.allowed_surfaces);
      const cp = await trx.insertInto('campaigns').values({ contract_id: ct.id, name: input.name }).returning('id').executeTakeFirstOrThrow();
      const d = await trx.insertInto('campaign_drafts').values({ campaign_id: cp.id, takeover_draft: JSON.stringify(draft), created_by: actor.userId }).returning('id').executeTakeFirstOrThrow();
      await trx.updateTable('campaigns').set({ current_draft_id: d.id }).where('id', '=', cp.id).execute();
      await appendAuditEvent(trx, {
        actorUserId: actor.userId, action: 'CAMPAIGN_CREATED', entityType: 'campaign', entityId: cp.id, afterHash: draftHash(draft),
        metadata: { contractId: ct.id, draftId: d.id, revision: 1 },
      });
      return this.vistaCampania(trx, cp.id);
    });
  }

  async getCampaign(actor: Principal, campaignId: string): Promise<CampaignView> {
    exigir(actor, READ_ROLES);
    return this.vistaCampania(this.db, campaignId);
  }

  async listCampaigns(actor: Principal, o: ListOptions & { contractId?: string }): Promise<{ items: CampaignView[]; nextCursor: string | null }> {
    exigir(actor, READ_ROLES);
    let q = this.db.selectFrom('campaigns').select('id');
    if (o.contractId) q = q.where('contract_id', '=', o.contractId);
    if (o.cursor) q = q.where(sql<boolean>`(created_at, id) < (SELECT x.created_at, x.id FROM campaigns x WHERE x.id = ${o.cursor}::uuid)`);
    const filas = await q.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(o.limit + 1).execute();
    const items = await Promise.all(filas.slice(0, o.limit).map((f) => this.vistaCampania(this.db, f.id)));
    return { items, nextCursor: filas.length > o.limit ? (filas[o.limit - 1]?.id ?? null) : null };
  }

  /* ── draft (§8, §9) ──────────────────────────────────────────────── */

  async getDraft(actor: Principal, campaignId: string): Promise<DraftView> {
    exigir(actor, READ_ROLES);
    const r = await this.db
      .selectFrom('campaigns as c')
      .leftJoin('campaign_drafts as d', 'd.id', 'c.current_draft_id')
      .select(['c.id as campaign_id', 'd.id as draft_id', 'd.revision', 'd.updated_at', 'd.takeover_draft'])
      .where('c.id', '=', campaignId)
      .executeTakeFirst();
    if (!r) throw new CampaignError(404, 'CAMPAIGN_NOT_FOUND', 'La campaña no existe.');
    if (!r.draft_id || r.revision === null || !r.updated_at) throw new CampaignError(404, 'DRAFT_NOT_FOUND', 'La campaña no tiene draft.');
    return { campaignId: r.campaign_id, draftId: r.draft_id, revision: r.revision, updatedAt: iso(r.updated_at), takeoverDraft: r.takeover_draft as TakeoverDraft };
  }

  async putDraft(actor: Principal, campaignId: string, input: { takeoverDraft: unknown; expectedRevision: number }): Promise<DraftView> {
    exigir(actor, EDIT_ROLES);
    const draft = parseDraft(input.takeoverDraft);
    return this.db.transaction().execute(async (trx) => {
      const cp = await trx
        .selectFrom('campaigns as c')
        .innerJoin('contracts as ct', 'ct.id', 'c.contract_id')
        .select(['c.id', 'c.current_draft_id', 'c.lifecycle_status', 'ct.allowed_surfaces'])
        .where('c.id', '=', campaignId)
        .executeTakeFirst();
      if (!cp) throw new CampaignError(404, 'CAMPAIGN_NOT_FOUND', 'La campaña no existe.');
      if (!cp.current_draft_id) throw new CampaignError(404, 'DRAFT_NOT_FOUND', 'La campaña no tiene draft.');
      if (cp.lifecycle_status !== 'ACTIVE') {
        throw new CampaignError(409, 'INVALID_STATE_TRANSITION', 'La campaña está archivada: su draft no se edita.', { lifecycleStatus: cp.lifecycle_status });
      }
      exigirSuperficies(draft, cp.allowed_surfaces);
      const previo = await trx.selectFrom('campaign_drafts').select(['takeover_draft']).where('id', '=', cp.current_draft_id).executeTakeFirstOrThrow();
      // UPDATE condicionado a la revisión esperada: atómico, sin last-write-wins.
      const escrito = await trx
        .updateTable('campaign_drafts')
        .set({ takeover_draft: JSON.stringify(draft), revision: sql<number>`revision + 1` })
        .where('id', '=', cp.current_draft_id)
        .where('revision', '=', input.expectedRevision)
        .returning(['id', 'revision', 'updated_at'])
        .executeTakeFirst();
      if (!escrito) {
        const actual = await trx.selectFrom('campaign_drafts').select(['revision', 'updated_at']).where('id', '=', cp.current_draft_id).executeTakeFirstOrThrow();
        throw new CampaignError(409, 'DRAFT_CONFLICT', 'El draft cambió en el servidor: no se sobrescribe.', {
          serverRevision: actual.revision, clientRevision: input.expectedRevision, serverUpdatedAt: iso(actual.updated_at),
        });
      }
      await appendAuditEvent(trx, {
        actorUserId: actor.userId, action: 'DRAFT_UPDATED', entityType: 'campaign_draft', entityId: escrito.id,
        beforeHash: draftHash(previo.takeover_draft), afterHash: draftHash(draft),
        metadata: { campaignId, revision: escrito.revision, previousRevision: input.expectedRevision },
      });
      return { campaignId, draftId: escrito.id, revision: escrito.revision, updatedAt: iso(escrito.updated_at), takeoverDraft: draft };
    });
  }

  /* ── internos ────────────────────────────────────────────────────── */

  private async vistaCampania(db: Kysely<Database>, campaignId: string): Promise<CampaignView> {
    const r = await db
      .selectFrom('campaigns as c')
      .leftJoin('campaign_drafts as d', 'd.id', 'c.current_draft_id')
      .leftJoin('show_versions as v', 'v.id', 'c.latest_approved_version_id')
      .select([
        'c.id', 'c.contract_id', 'c.name', 'c.lifecycle_status', 'c.created_at', 'c.updated_at',
        'd.id as draft_id', 'd.revision as draft_revision', 'd.updated_at as draft_updated_at',
        'v.id as version_id', 'v.version_number', 'v.version_hash',
      ])
      .where('c.id', '=', campaignId)
      .executeTakeFirst();
    if (!r) throw new CampaignError(404, 'CAMPAIGN_NOT_FOUND', 'La campaña no existe.');
    return {
      id: r.id, contractId: r.contract_id, name: r.name, lifecycleStatus: r.lifecycle_status,
      currentDraft: r.draft_id && r.draft_revision !== null && r.draft_updated_at ? { id: r.draft_id, revision: r.draft_revision, updatedAt: iso(r.draft_updated_at) } : null,
      latestApprovedVersion: r.version_id && r.version_number !== null && r.version_hash ? { id: r.version_id, versionNumber: r.version_number, versionHash: r.version_hash } : null,
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    };
  }
}

function parseDraft(raw: unknown): TakeoverDraft {
  const p = safeParseTakeoverDraft(raw);
  if (!p.success) {
    throw new CampaignError(422, 'DRAFT_INVALID', 'El draft no es un TakeoverDraft válido.', {
      issues: p.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return p.data;
}

/** §6. Exportado para que el submit (platform-approval) aplique la misma regla. */
export function exigirSuperficies(draft: TakeoverDraft, allowedSurfaces: readonly string[]): void {
  const fuera = screensOutsideContract(draft, allowedSurfaces);
  if (fuera.length > 0) {
    throw new CampaignError(422, 'SURFACE_NOT_CONTRACTED', 'El draft usa pantallas que el contrato no incluye.', { screens: fuera, allowedSurfaces: [...allowedSurfaces] });
  }
}

function validarSuperficies(s: readonly string[]): string[] {
  const validas = new Set<string>(buildingSurfaceIds());
  const unicas = [...new Set(s)].sort();
  const malas = unicas.filter((x) => !validas.has(x));
  if (unicas.length === 0 || malas.length > 0) {
    throw new CampaignError(422, 'CONTRACT_INVALID', 'allowedSurfaces tiene que listar pantallas del edificio.', { invalid: malas, accepted: [...validas] });
  }
  return unicas;
}

function validarFechas(startsAt: string, endsAt: string): void {
  if (!(new Date(endsAt).getTime() > new Date(startsAt).getTime())) {
    throw new CampaignError(422, 'CONTRACT_INVALID', 'endsAt tiene que ser posterior a startsAt.');
  }
}

function pagina<R extends { id: string }, V>(filas: R[], limit: number, map: (r: R) => V): { items: V[]; nextCursor: string | null } {
  const items = filas.slice(0, limit);
  return { items: items.map(map), nextCursor: filas.length > limit ? (items.at(-1)?.id ?? null) : null };
}

type Row<T extends keyof Database> = import('kysely').Selectable<Database[T]>;

function toAdvertiser(a: Row<'advertisers'>): AdvertiserView {
  return {
    id: a.id, legalName: a.legal_name, taxId: a.tax_id, commercialName: a.commercial_name, contacts: (a.contacts as unknown[]) ?? [],
    status: a.status, createdAt: iso(a.created_at), updatedAt: iso(a.updated_at),
  };
}

function toContract(c: Row<'contracts'>): ContractView {
  return {
    id: c.id, advertiserId: c.advertiser_id, name: c.name, startsAt: iso(c.starts_at), endsAt: iso(c.ends_at), status: c.status,
    allowedSurfaces: [...c.allowed_surfaces], fourEyesRequired: c.four_eyes_required, externalApprovalEnabled: c.external_approval_enabled,
    metadata: (c.metadata as Record<string, unknown>) ?? {}, createdAt: iso(c.created_at), updatedAt: iso(c.updated_at),
  };
}
