'use client';

import { create } from 'zustand';
import { DEMO_SCENES, EL_TRUST, ShowEngine } from '@trust/show-engine';
import type { ShowPackage, ShowRuntimeState } from '@trust/shared-types';
import type { AssetRegistry } from '@trust/show-authoring';
import {
  MemoryDraftStorage,
  PreviewSession,
  adoptDraft,
  canPreview,
  loadDraft,
  requiresDiscardConfirmation,
  saveDraft,
  showPackageRevision,
  type DraftStorage,
  type PreviewSnapshot,
} from '@trust/show-authoring';
import {
  PRESET_TAKEOVER_15S,
  addMoment,
  compileTakeoverDraft,
  createRepoRegistry,
  duplicateMoment,
  momentAt,
  momentSpans,
  removeMoment,
  reorderMoments,
  safeParseTakeoverDraft,
  totalDurationMs,
  updateMoment,
  validateDraft,
  type BuilderValidation,
  type TakeoverDraft,
  type TakeoverMoment,
} from '@trust/show-authoring';
import { type CampaignSession, type CampaignView, connectBuilderBackend } from '@trust/builder-repository';

/**
 * Estado del TAKEOVER BUILDER.
 *
 * Reglas que no se negocian:
 *
 *  1. **No hay un segundo motor.** PLAY compila el draft y carga el
 *     `ShowPackage` en un `ShowEngine` real. Lo que se ve en el preview sale
 *     de `engine.getState()`. El timeline del builder dibuja el playhead; no
 *     resuelve runtime.
 *
 *  2. **Esto es autoría.** No controla hardware, no publica, no toca EDGE.
 *     Exportar un ShowPackage no lo pone al aire.
 */

const SCENES = DEMO_SCENES;
const engineContext = { building: EL_TRUST, scenes: SCENES };

/** localStorage cuando existe; memoria cuando el navegador lo bloquea. */
const memoria = new MemoryDraftStorage();
const storage = (): DraftStorage => {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : memoria;
  } catch {
    return memoria;
  }
};
const sceneIds = new Set(SCENES.keys());
/** D3: la última sesión de campaña abierta (solo ella actualiza el indicador). */
let sesionActual: CampaignSession | null = null;

export interface BuilderState {
  draft: TakeoverDraft;
  assets: AssetRegistry;
  selectedMomentId: string | null;
  validation: BuilderValidation | null;

  // Preview
  session: PreviewSession;
  /** Revision del compilado que el motor tiene cargado. */
  engineRevision: string;
  compiledRevision: string;
  /** false cuando el motor quedo viejo respecto del draft. */
  engineCurrent: boolean;
  previewState: ShowRuntimeState | null;
  transport: 'stopped' | 'playing' | 'paused' | 'ended';
  timeMs: number;
  compiled: ShowPackage | null;

  // Edición
  dirty: boolean;
  lastSavedAt: number | null;
  presentMode: boolean;
  showCompiled: boolean;

  /*
   * D3 (#15, opción 1) — campaña del backend. `null` = Builder de M2C tal cual:
   * solo localStorage, sin indicador. Con sesión, el autosave pasa por el
   * `CampaignRepository` de D2 (expectedRevision, offline, conflicto §9).
   */
  campaign: CampaignView | null;
  campaignSession: CampaignSession | null;

  setDraft: (draft: TakeoverDraft, options?: { markDirty?: boolean }) => void;
  loadPreset: (build: () => TakeoverDraft) => void;
  selectMoment: (id: string | null) => void;
  patchMoment: (id: string, patch: Partial<TakeoverMoment>) => void;
  patchSurfaces: (patch: Partial<TakeoverDraft['surfaces']>) => void;
  patchMeta: (patch: Partial<Pick<TakeoverDraft, 'name' | 'clientName' | 'campaignName' | 'closingSceneId' | 'notes'>>) => void;
  addMomentAt: () => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  move: (from: number, to: number) => void;

  revalidate: () => void;
  canPreview: () => boolean;
  needsDiscardConfirmation: () => boolean;
  /** Ejecuta un comando de preview a traves de la sesion. Uso interno. */
  runPreview: (
    op: (session: PreviewSession, validation: BuilderValidation | null) => PreviewSnapshot,
  ) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  restart: () => void;
  scrub: (ms: number) => void;
  tick: () => void;

  save: () => void;
  loadFromStorage: () => boolean;
  importDraft: (raw: unknown) => { ok: boolean; message?: string };
  setPresentMode: (on: boolean) => void;
  setShowCompiled: (on: boolean) => void;

  /** Abre la campaña con una sesión ya armada (inyectable: tests y composición). */
  openCampaign: (session: CampaignSession, campaignId: string) => Promise<boolean>;
  /** Composición del navegador: sesión de C1 + API (fetch inyectado acá, no en un componente). */
  connectCampaign: (campaignId: string) => Promise<boolean>;
  /** Reintenta lo pendiente (al volver la conexión). */
  syncCampaign: () => void;
  /** Las tres salidas de §9. Ninguna se toma sola. */
  resolveConflict: (salida: 'server' | 'local' | 'duplicate') => Promise<void>;
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  draft: PRESET_TAKEOVER_15S(),
  assets: createRepoRegistry(),
  selectedMomentId: 'normal',
  validation: null,

  session: new PreviewSession({
    // El motor real: el MISMO ShowEngine que usan PREVIS y CONTROL.
    createEngine: (show) => new ShowEngine({ show, context: engineContext }),
  }),
  engineRevision: 'none',
  compiledRevision: 'none',
  engineCurrent: true,
  previewState: null,
  transport: 'stopped',
  timeMs: 0,
  compiled: null,

  dirty: false,
  lastSavedAt: null,
  presentMode: false,
  showCompiled: false,

  campaign: null,
  campaignSession: null,

  setDraft: (draft, options) => {
    set({ draft: { ...draft, updatedAt: Date.now() }, dirty: options?.markDirty ?? true });
    get().revalidate();
  },

  /**
   * M2C.1.1 / punto 3: un preset NO queda como si estuviera guardado.
   * `adoptDraft` marca sucio y el autosave escribe. Ver persistence.ts.
   */
  loadPreset: (build) => {
    const adopted = adoptDraft(build(), 'preset');
    get().session.release();
    set({
      draft: adopted.draft,
      selectedMomentId: adopted.draft.moments[0]?.id ?? null,
      dirty: adopted.dirty,
      previewState: null,
      transport: 'stopped',
      timeMs: 0,
      engineRevision: 'none',
    });
    get().revalidate();
    if (adopted.autosave) get().save();
  },

  /** True si cambiar de draft pisaria trabajo sin guardar. */
  needsDiscardConfirmation: () => requiresDiscardConfirmation({ dirty: get().dirty }),

  selectMoment: (id) => set({ selectedMomentId: id }),

  patchMoment: (id, patch) => get().setDraft(updateMoment(get().draft, id, patch)),

  patchSurfaces: (patch) =>
    get().setDraft({ ...get().draft, surfaces: { ...get().draft.surfaces, ...patch } }),

  patchMeta: (patch) => get().setDraft({ ...get().draft, ...patch }),

  addMomentAt: () => {
    const draft = addMoment(get().draft);
    const nuevo = draft.moments[draft.moments.length - 1];
    set({ selectedMomentId: nuevo?.id ?? null });
    get().setDraft(draft);
  },

  duplicate: (id) => {
    const draft = duplicateMoment(get().draft, id);
    const index = draft.moments.findIndex((m) => m.id === id);
    set({ selectedMomentId: draft.moments[index + 1]?.id ?? id });
    get().setDraft(draft);
  },

  remove: (id) => {
    const draft = removeMoment(get().draft, id);
    if (get().selectedMomentId === id) set({ selectedMomentId: draft.moments[0]?.id ?? null });
    get().setDraft(draft);
  },

  move: (from, to) => get().setDraft(reorderMoments(get().draft, from, to)),

  /**
   * Compila y valida. Es el único camino: el panel de preflight muestra el
   * resultado de `preflightShow()` sobre el paquete real, no una segunda copia
   * de las reglas.
   */
  revalidate: () => {
    const { draft, assets } = get();
    const validation = validateDraft(draft, {
      building: EL_TRUST,
      assets,
      sceneIds,
      preflight: engineContext,
    });
    const compiledRevision = showPackageRevision(validation.compile.showPackage);

    // M2C.1.2 / punto 5: si el draft dejo de ser previsualizable, el motor se
    // suelta ACA, no en el proximo comando. Un preview que sigue sonando
    // sobre un draft bloqueado muestra algo que ya no existe.
    const snap = get().session.enforce(validation);

    set({
      validation,
      compiled: validation.compile.showPackage,
      compiledRevision,
      previewState: snap.state,
      transport: snap.transport,
      timeMs: snap.timeMs,
      engineRevision: snap.engineRevision,
      // Si el compilado cambio, el motor cargado quedo viejo. PLAY, RESTART y
      // SCRUB lo recargan solos; esto es solo para que la UI pueda avisarlo.
      engineCurrent: get().session.getEngineRevision() === compiledRevision,
    });
  },

  /**
   * M2C.1.1 / puntos 1 y 2.
   *
   * Todo comando pasa por `PreviewSession`, que hace dos cosas en orden:
   * chequea `canPreview(validation)` y se asegura de que el motor tenga
   * cargado el compilado de AHORA. No hay camino que saltee ninguna de las
   * dos, asi que ni un draft BLOCKED ni un compilado viejo pueden reproducirse.
   */
  play: () => get().runPreview((s, v) => s.play(v)),
  pause: () => get().runPreview((s, v) => s.pause(v)),
  stop: () => get().runPreview((s, v) => s.stop(v)),
  restart: () => get().runPreview((s, v) => s.restart(v)),
  scrub: (ms) => get().runPreview((s, v) => s.scrub(v, ms)),

  canPreview: () => canPreview(get().validation),

  runPreview: (op) => {
    // Se revalida primero: el comando opera sobre el estado actual del draft,
    // no sobre la validacion que quedo de la edicion anterior.
    get().revalidate();
    const { session, validation } = get();
    const snap = op(session, validation);
    set({
      previewState: snap.state,
      transport: snap.transport,
      timeMs: snap.timeMs,
      engineRevision: snap.engineRevision,
      compiledRevision: snap.compiledRevision,
      engineCurrent: snap.current,
    });
  },

  tick: () => {
    const { session, validation } = get();
    if (!session.getEngine()) return;
    const snap = session.snapshot(validation);
    set({
      previewState: snap.state,
      transport: snap.transport,
      timeMs: snap.timeMs,
      engineCurrent: snap.current,
    });
  },

  save: () => {
    const sesion = get().campaignSession;
    if (!sesion) {
      // M2C, sin cambios: solo localStorage.
      const draft = { ...get().draft, updatedAt: Date.now() };
      if (saveDraft(storage(), draft)) {
        set({ draft, dirty: false, lastSavedAt: Date.now() });
      }
      return;
    }
    // D3: el repositorio guarda local siempre y sube con expectedRevision.
    // Limpio solo si quedó persistido Y nadie editó mientras tanto. Un conflicto
    // o un error dejan el draft sucio: reemplazarlo pide confirmación.
    const enviado = get().draft;
    void sesion
      .save({ ...enviado, updatedAt: Date.now() })
      .then((r) => {
        if (r && (r.kind === 'saved' || r.kind === 'pending') && get().draft === enviado) {
          set({ dirty: false, lastSavedAt: Date.now() });
        }
      })
      .catch(() => undefined); // el error queda en `campaign` y el indicador lo muestra
  },

  loadFromStorage: () => {
    const guardado = loadDraft(storage());
    if (!guardado) return false;
    const adopted = adoptDraft(guardado, 'storage');
    get().session.release();
    set({
      draft: adopted.draft,
      selectedMomentId: adopted.draft.moments[0]?.id ?? null,
      dirty: adopted.dirty,
      engineRevision: 'none',
    });
    get().revalidate();
    return true;
  },

  importDraft: (raw) => {
    const parsed = safeParseTakeoverDraft(raw);
    if (!parsed.success) {
      return {
        ok: false,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
      };
    }
    const adopted = adoptDraft(parsed.data, 'import');
    get().session.release();
    set({
      draft: adopted.draft,
      selectedMomentId: adopted.draft.moments[0]?.id ?? null,
      dirty: adopted.dirty,
      previewState: null,
      transport: 'stopped',
      timeMs: 0,
      engineRevision: 'none',
    });
    get().revalidate();
    if (adopted.autosave) get().save();
    return { ok: true };
  },

  /** PRESENT no entra con el draft bloqueado: no hay nada seguro que mostrar. */
  setPresentMode: (on) => {
    if (on && !canPreview(get().validation)) return;
    set({ presentMode: on });
  },
  setShowCompiled: (on) => set({ showCompiled: on }),

  openCampaign: async (session, campaignId) => {
    sesionActual = session; // una sesión vieja que siga emitiendo no pisa el indicador
    set({ campaignSession: null, campaign: null });
    session.subscribe((v) => {
      if (sesionActual === session) set({ campaign: v });
    });
    try {
      const abierta = await session.open(campaignId);
      adoptarDelRepositorio(abierta.draft);
      set({ campaignSession: session, campaign: session.view() });
      return true;
    } catch {
      // Sin campaña abierta no hay autosave remoto: el indicador muestra el
      // error y lo que se edite queda solo en este navegador (M2C).
      set({ campaignSession: null, campaign: session.view() });
      return false;
    }
  },

  connectCampaign: async (campaignId) => {
    try {
      const session = await connectBuilderBackend({
        baseUrl: process.env.NEXT_PUBLIC_TRUST_API_URL ?? '',
        fetch: (input, init) => window.fetch(input, init),
        storage: storage(),
      });
      return await get().openCampaign(session, campaignId);
    } catch (e) {
      const error = e instanceof Error && 'code' in e ? { code: String((e as { code: unknown }).code), message: e.message } : { code: 'OFFLINE', message: 'Sin conexión con el backend.' };
      set({
        campaignSession: null,
        campaign: { campaignId, phase: 'error', connectivity: error.code === 'OFFLINE' ? 'offline' : 'online', revision: null, updatedAt: null, approvedVersion: null, conflict: null, error, localCopy: null },
      });
      return false;
    }
  },

  syncCampaign: () => {
    const sesion = get().campaignSession;
    if (!sesion) return;
    const enviado = get().draft;
    void sesion
      .sync()
      .then((r) => {
        if (r?.kind === 'saved' && get().draft === enviado && get().dirty === false) set({ lastSavedAt: Date.now() });
      })
      .catch(() => undefined);
  },

  resolveConflict: async (salida) => {
    const sesion = get().campaignSession;
    if (!sesion) return;
    try {
      if (salida === 'local') {
        const enviado = get().draft;
        const r = await sesion.keepLocal();
        if (r?.kind === 'saved' && get().draft === enviado) set({ dirty: false, lastSavedAt: Date.now() });
        return;
      }
      const draft = salida === 'server' ? await sesion.recoverServer() : await sesion.duplicateAsNew();
      adoptarDelRepositorio(draft);
    } catch {
      // el error (o el conflicto que sigue abierto) queda en `campaign`
    }
  },
}));

/** Adopta un draft que ya está persistido por el repositorio: queda limpio. */
function adoptarDelRepositorio(draft: TakeoverDraft) {
  const { getState, setState } = useBuilderStore;
  const adopted = adoptDraft(draft, 'storage');
  getState().session.release();
  setState({
    draft: adopted.draft,
    selectedMomentId: adopted.draft.moments[0]?.id ?? null,
    dirty: adopted.dirty,
    previewState: null,
    transport: 'stopped',
    timeMs: 0,
    engineRevision: 'none',
  });
  getState().revalidate();
}

/* ── Selectores ──────────────────────────────────────────────── */

export const useSpans = () => momentSpans(useBuilderStore((s) => s.draft));
export const useTotalMs = () => totalDurationMs(useBuilderStore((s) => s.draft));
export const useCurrentMoment = () => {
  const draft = useBuilderStore((s) => s.draft);
  const timeMs = useBuilderStore((s) => s.timeMs);
  return momentAt(draft, timeMs);
};
export const SCENE_IDS = [...SCENES.keys()];
export const BUILDING = EL_TRUST;
export { compileTakeoverDraft, engineContext };
