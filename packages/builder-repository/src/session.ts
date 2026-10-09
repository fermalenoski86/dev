import type { DraftStorage, TakeoverDraft } from '@trust/show-authoring';
import { z } from 'zod';
import { ApiCampaignRepository } from './api';
import { SyncingCampaignRepository } from './syncing';
import {
  type ApprovedVersionRef,
  type Connectivity,
  type DraftConflict,
  OfflineError,
  type OpenedCampaign,
  RepositoryError,
  type SaveResult,
} from './types';

/**
 * D3 — la sesión de campaña del Builder (master §31, §32; decisión de Fer en #15).
 *
 * Es la ÚNICA pieza que el store del Builder conoce además de la interfaz del
 * repositorio. Vive acá (y no en `apps/control`) para que la lógica se pruebe
 * sin React y la adaptación del Builder quede en lo mínimo (§42):
 *
 *   · serializa los guardados: un autosave nunca corre en paralelo con otro, y
 *     si llegan dos mientras uno está en vuelo, se sube SOLO el último (el del
 *     medio ya quedó viejo);
 *   · el `expectedRevision` sale siempre del repositorio (`status().revision`),
 *     nunca del componente: el Builder no puede inventar una revisión;
 *   · traduce cada resultado a una vista (`CampaignView`) que el indicador
 *     muestra: APPROVED VERSION vN / WORKING DRAFT rev R / estado (§32);
 *   · expone las tres salidas de §9 sin decidir nada por su cuenta.
 *
 * No hay merge automático ni last-write-wins: eso lo garantiza el repositorio
 * de D2 y esta capa no lo saltea.
 */

/** Estado del guardado que ve el usuario. */
export type SyncPhase =
  /** Abierta y sin guardados todavía. */
  | 'idle'
  | 'opening'
  | 'saving'
  /** Confirmado por el servidor. */
  | 'saved'
  /** Guardado local, sin conexión: se sube al volver. */
  | 'pending'
  /** El servidor cambió: no se lo pisó; decide el usuario (§9). */
  | 'conflict'
  /** Error que hay que mostrar (403, 422, storage lleno…). */
  | 'error';

export interface CampaignView {
  campaignId: string;
  phase: SyncPhase;
  connectivity: Connectivity;
  /** WORKING DRAFT: revisión del servidor sobre la que se edita. */
  revision: number | null;
  updatedAt: string | null;
  /** APPROVED VERSION vN (§32). Solo lectura: el Builder nunca la modifica. */
  approvedVersion: ApprovedVersionRef | null;
  conflict: DraftConflict | null;
  error: { code: string; message: string } | null;
  /** Copia local que dejó "duplicar como nuevo" (§9), para exportarla. */
  localCopy: TakeoverDraft | null;
}

/** Lo que la sesión necesita del repositorio: la interfaz de D2 + las salidas de §9. */
export interface ResolvableRepository {
  open(campaignId: string): Promise<OpenedCampaign>;
  save(draft: TakeoverDraft, expectedRevision: number): Promise<SaveResult>;
  sync(): Promise<SaveResult | null>;
  recoverServer(): Promise<OpenedCampaign>;
  keepLocal(): Promise<SaveResult>;
  duplicateAsNew(): Promise<{ draft: TakeoverDraft; server: OpenedCampaign }>;
  status(): { connectivity: Connectivity; revision: number | null; pending: boolean; conflict: DraftConflict | null };
}

export class CampaignSession {
  private v: CampaignView | null = null;
  private inFlight: Promise<void> | null = null;
  private next: TakeoverDraft | null = null;
  private listeners = new Set<(v: CampaignView | null) => void>();

  constructor(private readonly repo: ResolvableRepository) {}

  view(): CampaignView | null {
    return this.v;
  }

  subscribe(fn: (v: CampaignView | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Abre la campaña del backend (§31 "abrir Campaign → GET backend"). */
  async open(campaignId: string): Promise<OpenedCampaign> {
    this.emit({ ...vacia(campaignId), phase: 'opening' });
    try {
      const o = await this.repo.open(campaignId);
      const st = this.repo.status();
      this.emit({
        ...vacia(campaignId),
        phase: st.conflict ? 'conflict' : st.pending ? 'pending' : 'idle',
        connectivity: st.connectivity,
        revision: st.revision ?? o.revision,
        updatedAt: o.updatedAt,
        approvedVersion: o.approvedVersion,
        conflict: st.conflict,
      });
      return o;
    } catch (e) {
      this.emit({ ...vacia(campaignId), phase: 'error', connectivity: e instanceof OfflineError ? 'offline' : 'online', error: comoError(e) });
      throw e;
    }
  }

  /**
   * Autosave (§31 "PUT draft con expectedRevision"). Si hay un guardado en
   * vuelo, este queda como "siguiente" y reemplaza a cualquier otro que
   * estuviera esperando. Resuelve con el resultado del guardado que incluyó
   * este draft (o uno posterior).
   */
  async save(draft: TakeoverDraft): Promise<SaveResult | null> {
    if (!this.v) throw new RepositoryError(0, 'NOT_OPEN', 'Abrí una campaña antes de guardar.');
    this.next = draft;
    return this.exclusivo(async () => {
      const aSubir = this.next;
      if (aSubir === null) return this.ultimo; // otro llamador ya subió este draft o uno más nuevo
      this.next = null;
      return this.correr(() => {
        const rev = this.repo.status().revision;
        if (rev === null) throw new RepositoryError(0, 'NOT_OPEN', 'El repositorio no tiene revisión base.');
        return this.repo.save(aSubir, rev);
      });
    });
  }

  /** Reintenta lo pendiente (p. ej. al volver la conexión). */
  async sync(): Promise<SaveResult | null> {
    if (!this.v) return null;
    return this.exclusivo(() => this.correr(() => this.repo.sync()));
  }

  /** §9 "recuperar server": devuelve el draft del servidor para que el Builder lo adopte. */
  async recoverServer(): Promise<TakeoverDraft> {
    const o = await this.exclusivo(() => this.resolver(() => this.repo.recoverServer()));
    return o.draft;
  }

  /** §9 "mantener local": decisión explícita; si el servidor volvió a cambiar, es otro conflicto. */
  async keepLocal(): Promise<SaveResult | null> {
    return this.exclusivo(() => this.correr(() => this.repo.keepLocal()));
  }

  /** §9 "duplicar como nuevo": el Builder vuelve al draft del servidor y la copia queda para exportar. */
  async duplicateAsNew(): Promise<TakeoverDraft> {
    let copia: TakeoverDraft | null = null;
    const o = await this.exclusivo(() =>
      this.resolver(async () => {
        const r = await this.repo.duplicateAsNew();
        copia = r.draft;
        return r.server;
      }),
    );
    this.patch({ localCopy: copia });
    return o.draft;
  }

  /* ── internos ─────────────────────────────────────────────────────── */

  private ultimo: SaveResult | null = null;

  private async correr(op: () => Promise<SaveResult | null>): Promise<SaveResult | null> {
    this.patch({ phase: 'saving', error: null });
    try {
      const r = await op();
      this.ultimo = r;
      const st = this.repo.status();
      if (r === null) {
        this.patch({ phase: st.pending ? 'pending' : 'saved', connectivity: st.connectivity });
      } else if (r.kind === 'saved') {
        this.patch({ phase: 'saved', connectivity: st.connectivity, revision: r.revision, updatedAt: r.updatedAt, conflict: null });
      } else if (r.kind === 'pending') {
        this.patch({ phase: 'pending', connectivity: st.connectivity, revision: r.revision });
      } else {
        this.patch({ phase: 'conflict', connectivity: st.connectivity, conflict: r.conflict });
      }
      return r;
    } catch (e) {
      const st = this.repo.status();
      // un conflicto abierto sigue abierto aunque esta operación haya fallado
      this.patch({ phase: st.conflict ? 'conflict' : 'error', connectivity: e instanceof OfflineError ? 'offline' : st.connectivity, error: comoError(e) });
      throw e;
    }
  }

  /** Una operación con el repositorio por vez: nunca dos PUT en paralelo. */
  private async exclusivo<T>(fn: () => Promise<T>): Promise<T> {
    while (this.inFlight) await this.inFlight;
    let liberar!: () => void;
    this.inFlight = new Promise<void>((r) => (liberar = r));
    try {
      return await fn();
    } finally {
      this.inFlight = null;
      liberar();
    }
  }

  private async resolver(op: () => Promise<OpenedCampaign>): Promise<OpenedCampaign> {
    this.patch({ phase: 'saving', error: null });
    try {
      const o = await op();
      const st = this.repo.status();
      this.patch({ phase: 'saved', connectivity: st.connectivity, revision: st.revision ?? o.revision, updatedAt: o.updatedAt, conflict: null, approvedVersion: o.approvedVersion });
      return o;
    } catch (e) {
      const st = this.repo.status();
      this.patch({ phase: st.conflict ? 'conflict' : 'error', connectivity: e instanceof OfflineError ? 'offline' : st.connectivity, error: comoError(e) });
      throw e;
    }
  }

  private patch(p: Partial<CampaignView>) {
    if (this.v) this.emit({ ...this.v, ...p });
  }

  private emit(v: CampaignView) {
    this.v = v;
    for (const fn of this.listeners) fn(v);
  }
}

function vacia(campaignId: string): CampaignView {
  return { campaignId, phase: 'idle', connectivity: 'online', revision: null, updatedAt: null, approvedVersion: null, conflict: null, error: null, localCopy: null };
}

function comoError(e: unknown): { code: string; message: string } {
  if (e instanceof RepositoryError) return { code: e.code, message: e.message };
  if (e instanceof OfflineError) return { code: 'OFFLINE', message: e.message };
  return { code: 'UNEXPECTED', message: 'Error inesperado al hablar con el backend.' };
}

/* ── composición (navegador) ──────────────────────────────────────────── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * `?campaign=<uuid>` en la URL del Builder. Cualquier otra cosa → null, y el
 * Builder sigue exactamente como en M2C (solo localStorage).
 */
export function campaignIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('campaign');
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

const MeBody = z.object({ csrfToken: z.string().min(1).nullable() }).passthrough();

/**
 * Arma la sesión de campaña del navegador: lee el CSRF de la sesión de C1 en
 * `GET /api/v1/auth/me` (la cookie la manda el navegador) y compone
 * `SyncingCampaignRepository` sobre `ApiCampaignRepository` y el storage local.
 * `fetch` es inyectado (§31): ningún componente lo llama.
 */
export async function connectBuilderBackend(opts: { baseUrl: string; fetch: typeof fetch; storage: DraftStorage }): Promise<CampaignSession> {
  let res: Response;
  try {
    res = await opts.fetch(`${opts.baseUrl.replace(/\/$/, '')}/api/v1/auth/me`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'include' });
  } catch {
    throw new OfflineError();
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new OfflineError(`El backend no respondió (${res.status}).`);
  if (res.status === 401) throw new RepositoryError(401, 'UNAUTHENTICATED', 'Iniciá sesión en la plataforma para abrir la campaña.');
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const me = MeBody.safeParse(body);
  if (!res.ok || !me.success) throw new RepositoryError(res.status, 'INVALID_RESPONSE', 'No se pudo leer la sesión de la plataforma.');
  const csrf = me.data.csrfToken;
  const api = new ApiCampaignRepository({ baseUrl: opts.baseUrl, fetch: opts.fetch, csrfToken: () => csrf });
  return new CampaignSession(new SyncingCampaignRepository({ storage: opts.storage, api }));
}
