import { type DraftStorage, type TakeoverDraft, safeParseTakeoverDraft, saveDraft } from '@trust/show-authoring';
import { z } from 'zod';
import type { ApiCampaignRepository } from './api';
import {
  type ApprovedVersionRef,
  type CampaignRepository,
  type Connectivity,
  type DraftConflict,
  OfflineError,
  type OpenedCampaign,
  RepositoryError,
  type RepositoryStatus,
  type SaveResult,
} from './types';

/**
 * Offline / conflicto — master §9 y §31.
 *
 *   · `save` guarda LOCAL SIEMPRE y después intenta el PUT con `expectedRevision`;
 *   · sin conexión el cambio queda `pending` y `sync()` lo reintenta;
 *   · ante 409 NO se pisa el servidor: queda `conflict` y ningún `save` posterior
 *     sube nada hasta que el usuario elija una de las tres salidas de §9:
 *       - `recoverServer()`  — descarta lo local y toma el draft del servidor;
 *       - `keepLocal()`      — decisión explícita: sube lo local sobre la revisión
 *                              del servidor que vio en el conflicto (si el
 *                              servidor volvió a cambiar, es otro conflicto);
 *       - `duplicateAsNew()` — devuelve lo local como draft suelto y vuelve al
 *                              del servidor. Sin escritura remota (decisión 7
 *                              del brief D): crear la campaña nueva es de D3/E.
 *
 * Persistencia local: el draft se sigue escribiendo en `trust.builder.draft.v1`
 * con `saveDraft` (formato sin cambios). Lo que sync necesita —campaña,
 * revisión base y si está pendiente— va en una clave APARTE por campaña,
 * `trust.builder.sync.v1:<campaignId>`, validada con Zod al leer.
 */
export const SYNC_KEY_PREFIX = 'trust.builder.sync.v1:';
export const syncKey = (campaignId: string) => `${SYNC_KEY_PREFIX}${campaignId}`;

const RecordSchema = z.object({
  v: z.literal(1),
  campaignId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  pending: z.boolean(),
  draft: z.unknown(),
});
interface SyncRecord { campaignId: string; baseRevision: number; pending: boolean; draft: TakeoverDraft }

export class SyncingCampaignRepository implements CampaignRepository {
  private campaignId: string | null = null;
  private draft: TakeoverDraft | null = null;
  private revision: number | null = null;
  private pending = false;
  private conflict: DraftConflict | null = null;
  private connectivity: Connectivity = 'online';
  private approved: ApprovedVersionRef | null = null;

  constructor(private readonly deps: { storage: DraftStorage; api: ApiCampaignRepository }) {}

  async open(campaignId: string): Promise<OpenedCampaign> {
    this.campaignId = campaignId;
    this.conflict = null;
    const local = this.leer(campaignId);
    let server: OpenedCampaign;
    try {
      server = await this.deps.api.open(campaignId);
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
      this.connectivity = 'offline';
      if (!local) throw e; // nada que abrir sin backend
      this.draft = local.draft;
      this.revision = local.baseRevision;
      this.pending = local.pending;
      return { campaignId, draft: local.draft, revision: local.baseRevision, updatedAt: null, approvedVersion: this.approved, source: 'local' };
    }
    this.connectivity = 'online';
    this.approved = server.approvedVersion;
    if (local?.pending) {
      // Trabajo local sin subir: se conserva y se intenta sincronizar (puede dar conflicto).
      this.draft = local.draft;
      this.revision = local.baseRevision;
      this.pending = true;
      await this.push();
      return { campaignId, draft: local.draft, revision: this.revision, updatedAt: null, approvedVersion: this.approved, source: 'local' };
    }
    this.adoptarServidor(campaignId, server.draft, server.revision);
    return server;
  }

  async save(draft: TakeoverDraft, expectedRevision: number): Promise<SaveResult> {
    const campaignId = this.abierta();
    // 1) local primero, siempre: aunque el PUT falle, el trabajo no se pierde.
    //    Si el storage no lo acepta, `escribir` lanza ANTES de tocar el estado:
    //    nada queda pendiente y nada se sube (AUDIT D2 P1).
    this.escribir({ campaignId, baseRevision: expectedRevision, pending: true, draft });
    this.draft = draft;
    this.revision = expectedRevision;
    this.pending = true;
    // 2) con un conflicto abierto no se sube nada: lo resuelve el usuario (§9).
    if (this.conflict) return { kind: 'conflict', conflict: this.conflict };
    return this.push();
  }

  /** Reintenta subir lo pendiente (p. ej. al volver la conexión). `null` si no había nada. */
  async sync(): Promise<SaveResult | null> {
    this.abierta();
    if (!this.pending) return null;
    if (this.conflict) return { kind: 'conflict', conflict: this.conflict };
    return this.push();
  }

  /** §9 "recuperar server": descarta lo local y adopta el draft vigente del servidor. */
  async recoverServer(): Promise<OpenedCampaign> {
    const campaignId = this.abierta();
    const s = await this.deps.api.fetchDraft(campaignId);
    this.connectivity = 'online';
    this.conflict = null;
    this.adoptarServidor(campaignId, s.draft, s.revision);
    return { ...s, approvedVersion: this.approved, source: 'server' };
  }

  /** §9 "mantener local": sube lo local sobre la revisión del servidor que mostró el conflicto. */
  async keepLocal(): Promise<SaveResult> {
    const campaignId = this.abierta();
    if (!this.conflict || !this.draft) throw new RepositoryError(0, 'NO_CONFLICT', 'No hay un conflicto para resolver.');
    const base = this.conflict.serverRevision;
    // Sin copia local no se sube: si el storage falla, el conflicto sigue abierto.
    this.escribir({ campaignId, baseRevision: base, pending: true, draft: this.draft });
    this.revision = base;
    this.conflict = null;
    return this.push();
  }

  /**
   * §9 "duplicar como nuevo draft": devuelve una copia de lo local para que el
   * llamador la use como draft nuevo, y la campaña vuelve al draft del servidor.
   * No escribe nada remoto.
   */
  async duplicateAsNew(): Promise<{ draft: TakeoverDraft; server: OpenedCampaign }> {
    this.abierta();
    if (!this.draft) throw new RepositoryError(0, 'NO_DRAFT', 'No hay draft local para duplicar.');
    const copia = structuredClone(this.draft);
    const server = await this.recoverServer();
    return { draft: copia, server };
  }

  status(): RepositoryStatus {
    return { connectivity: this.connectivity, campaignId: this.campaignId, revision: this.revision, pending: this.pending, conflict: this.conflict };
  }

  /* ── internos ─────────────────────────────────────────────────────── */

  private async push(): Promise<SaveResult> {
    const campaignId = this.abierta();
    const { draft, revision: base } = this;
    if (draft === null || base === null) throw new RepositoryError(0, 'NOT_OPEN', 'No hay draft para sincronizar.');
    let r: SaveResult;
    try {
      r = await this.deps.api.put(campaignId, draft, base);
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
      this.connectivity = 'offline';
      return { kind: 'pending', revision: base };
    }
    this.connectivity = 'online';
    if (r.kind === 'conflict') {
      // ¿El "conflicto" es nuestro propio PUT anterior, confirmado pero sin
      // respuesta (red cortada después del commit)? Si el servidor tiene
      // exactamente este draft, ya está guardado: no es un conflicto real.
      const s = await this.deps.api.fetchDraft(campaignId).catch(() => null);
      if (s && s.revision === r.conflict.serverRevision && mismoDraft(s.draft, draft)) {
        this.adoptarServidor(campaignId, s.draft, s.revision);
        return { kind: 'saved', revision: s.revision, updatedAt: s.updatedAt };
      }
      this.conflict = r.conflict;
      return r;
    }
    if (r.kind === 'saved') {
      this.revision = r.revision;
      this.pending = false;
      this.escribir({ campaignId, baseRevision: r.revision, pending: false, draft });
    }
    return r;
  }

  private adoptarServidor(campaignId: string, draft: TakeoverDraft, revision: number) {
    this.draft = draft;
    this.revision = revision;
    this.pending = false;
    this.escribir({ campaignId, baseRevision: revision, pending: false, draft });
  }

  private abierta(): string {
    if (this.campaignId === null) throw new RepositoryError(0, 'NOT_OPEN', 'Abrí una campaña antes de guardar.');
    return this.campaignId;
  }

  /**
   * El draft en la clave de siempre (formato M2C) + la metadata de sync aparte.
   * Lanza `LOCAL_STORAGE_UNAVAILABLE` si cualquiera de las dos escrituras falla.
   * `saveDraft` no lanza: devuelve `false` (cuota, modo privado), y eso también
   * corta acá, antes de escribir la metadata y antes de cualquier PUT
   * (AUDIT D2 P1: "guarda local siempre" no puede subir lo que no guardó).
   */
  private escribir(r: SyncRecord) {
    if (!saveDraft(this.deps.storage, r.draft)) {
      throw new RepositoryError(0, 'LOCAL_STORAGE_UNAVAILABLE', 'El navegador no deja guardar el draft localmente.');
    }
    try {
      this.deps.storage.setItem(syncKey(r.campaignId), JSON.stringify({ v: 1, ...r }));
    } catch {
      throw new RepositoryError(0, 'LOCAL_STORAGE_UNAVAILABLE', 'El navegador no deja guardar el draft localmente.');
    }
  }

  private leer(campaignId: string): SyncRecord | null {
    try {
      const raw = this.deps.storage.getItem(syncKey(campaignId));
      if (!raw) return null;
      const r = RecordSchema.safeParse(JSON.parse(raw));
      if (!r.success || r.data.campaignId !== campaignId) return null;
      const d = safeParseTakeoverDraft(r.data.draft);
      if (!d.success) return null;
      return { campaignId, baseRevision: r.data.baseRevision, pending: r.data.pending, draft: d.data };
    } catch {
      return null;
    }
  }
}

/** Igualdad estructural independiente del orden de claves (JSONB reordena). */
export function mismoDraft(a: unknown, b: unknown): boolean {
  return canon(a) === canon(b);
}
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
