'use client';

import { create } from 'zustand';
import {
  safeParseShowPackage,
  type CameraId,
  type LightingZoneId,
  type Rgbw,
  type ShowPackage,
  type ShowRuntimeState,
} from '@trust/shared-types';
import type { CameraMode } from '@trust/trust-3d';
import {
  ShowEngine,
  EL_TRUST,
  DEMO_SCENES,
  resolveStateAt,
  eventsInWindow,
  preflightShow,
  formatIssue,
  type PreflightIssue,
} from '@trust/show-engine';

/**
 * El store NO decide qué hace un show. Solo:
 *   1. le pasa comandos al ShowEngine,
 *   2. copia el estado resuelto a React para que la UI pinte.
 *
 * Toda la lógica de timeline vive en @trust/show-engine. Si en algún momento
 * aparece un `if` sobre tipos de evento acá dentro, está mal puesto.
 */

const context = { building: EL_TRUST, scenes: DEMO_SCENES };

interface ShowStore {
  engine: ShowEngine | null;
  show: ShowPackage | null;
  state: ShowRuntimeState | null;
  status: 'stopped' | 'playing' | 'paused' | 'ended';
  timeMs: number;
  durationMs: number;
  safeMode: boolean;
  /** Overrides manuales del operador, por encima del show. Se limpian al cargar otro. */
  manualZones: Partial<Record<LightingZoneId, { intensity?: number; color?: Rgbw }>>;
  error: string | null;
  warnings: PreflightIssue[];

  /**
   * REVIEW-001 / P1. La camara se resuelve con DOS valores explicitos en vez de
   * adivinar con una ventana de +-120ms alrededor del tiempo actual.
   *
   * `timelineCamera` la mueve el show; `manualCamera` la mueve el operador y
   * gana hasta que el show emite el proximo camera.switch. Los eventos se
   * detectan en la ventana (lastTimeMs, timeMs], asi que un frame que salte
   * 400ms por lag o por una pestania en segundo plano no se come el corte.
   */
  timelineCamera: CameraId;
  manualCamera: CameraId | null;
  lastTimeMs: number;

  /** REVIEW-002 / P1-4. `deterministic` = corte exacto; el modo para aprobar. */
  cameraMode: CameraMode;
  setCameraMode: (mode: CameraMode) => void;

  /** REVIEW-002 / P1-6. Clips que no cargaron. Visibles, no silenciosos. */
  mediaErrors: Record<string, string>;
  reportMediaError: (source: string, message: string) => void;
  /** REVIEW-003 / P1-6. Reintentar sin refrescar la pagina. */
  retryMedia: () => void;
  /** Se incrementa en cada retry: fuerza remonte del arbol de media. */
  mediaEpoch: number;

  loadShow: (raw: unknown) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (ms: number) => void;
  nudge: (ms: number) => void;
  setCamera: (id: CameraId) => void;
  setZone: (id: LightingZoneId, patch: { intensity?: number; color?: Rgbw }) => void;
  applyScene: (sceneId: string) => void;
  toggleSafeMode: () => void;
  tick: () => void;
}

export const useShowStore = create<ShowStore>((set, get) => ({
  engine: null,
  show: null,
  state: null,
  status: 'stopped',
  timeMs: 0,
  durationMs: 1,
  safeMode: false,
  manualZones: {},
  error: null,
  warnings: [],
  timelineCamera: 'hero_obelisco',
  manualCamera: null,
  lastTimeMs: 0,
  cameraMode: 'interactive',
  mediaErrors: {},
  mediaEpoch: 0,

  setCameraMode: (mode) => set({ cameraMode: mode }),

  /*
   * Limpia los errores y fuerza un remonte del arbol de media. El manager
   * libera las entradas falladas en syncActiveSources, asi que el proximo
   * acquire() vuelve a pedir el clip. Sin esto la unica salida era F5, que en
   * una sala de control no es una opcion.
   */
  retryMedia: () => {
    set({ mediaErrors: {}, mediaEpoch: get().mediaEpoch + 1 });
    get().tick();
  },

  reportMediaError: (source, message) => {
    set((prev) => ({ mediaErrors: { ...prev.mediaErrors, [source]: message } }));
    /*
     * Un clip que no carga es un edificio mostrando algo que no es lo pautado.
     * En PREVIS alcanza con avisar; en EDGE este mismo camino dispara SAFE MODE.
     */
    const engine = get().engine;
    if (engine && !engine.isSafeMode()) engine.pause();
    get().tick();
  },

  loadShow: (raw) => {
    // Único punto de entrada de datos externos. Todo JSON pasa por Zod.
    const parsed = safeParseShowPackage(raw);
    if (!parsed.success) {
      set({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ') });
      return;
    }
    const show = parsed.data;

    // Preflight: Zod valida forma, esto valida contexto. Un show con una escena
    // inexistente no se carga, ni siquiera en PREVIS.
    const pre = preflightShow(show, context);
    if (!pre.ok) {
      set({ error: pre.errors.map(formatIssue).join(' · '), warnings: pre.warnings });
      return;
    }

    const existing = get().engine;
    const engine = existing ?? new ShowEngine({ show, context });
    if (existing) existing.loadShow(show);

    set({
      engine,
      show,
      error: null,
      warnings: pre.warnings,
      manualZones: {},
      safeMode: false,
      durationMs: show.durationMs,
      timeMs: 0,
      status: 'stopped',
      lastTimeMs: 0,
      manualCamera: null,
      mediaErrors: {},
      timelineCamera: show.initialState.camera ?? 'hero_obelisco',
      state: resolveStateAt(show, context, 0),
    });
  },

  play: () => {
    get().engine?.play();
    get().tick();
  },
  pause: () => {
    get().engine?.pause();
    get().tick();
  },
  stop: () => {
    get().engine?.stop();
    get().tick();
  },
  seek: (ms) => {
    get().engine?.seek(ms);
    get().tick();
  },
  nudge: (ms) => {
    get().engine?.nudge(ms);
    get().tick();
  },

  setCamera: (id) => {
    const state = get().state;
    set({ manualCamera: id, state: state ? { ...state, camera: id } : state });
  },

  setZone: (id, patch) => {
    set((prev) => ({
      manualZones: { ...prev.manualZones, [id]: { ...prev.manualZones[id], ...patch } },
    }));
    get().tick();
  },

  applyScene: (sceneId) => {
    const scene = DEMO_SCENES.get(sceneId);
    if (!scene) return;
    const manualZones: ShowStore['manualZones'] = {};
    for (const [zoneId, patch] of Object.entries(scene.zones)) {
      if (patch) manualZones[zoneId as LightingZoneId] = { intensity: patch.intensity, color: patch.color };
    }
    set({ manualZones });
    get().tick();
  },

  toggleSafeMode: () => {
    const engine = get().engine;
    if (!engine) return;
    if (engine.isSafeMode()) engine.exitSafeMode();
    else engine.enterSafeMode();
    set({ safeMode: engine.isSafeMode(), manualZones: {} });
    get().tick();
  },

  /** Llamado por el render loop. Copia el estado del motor a React. */
  tick: () => {
    const engine = get().engine;
    if (!engine) return;

    const base = engine.getState();
    const manual = get().manualZones;
    const show = get().show;
    const timeMs = engine.getTimeMs();
    const lastTimeMs = get().lastTimeMs;

    // Cortes de camara del show: se buscan en la ventana recorrida desde el
    // ultimo tick, no alrededor del instante actual. Si el frame salto 800ms,
    // el corte igual se aplica.
    let timelineCamera = get().timelineCamera;
    let manualCamera = get().manualCamera;
    if (show && timeMs !== lastTimeMs) {
      const ventana =
        timeMs > lastTimeMs
          ? eventsInWindow(show, lastTimeMs, timeMs)
          : // En un seek hacia atras el estado resuelto ya trae la camara correcta.
            [];
      const corte = [...ventana].reverse().find((e) => e.type === 'camera.switch');
      if (corte && corte.type === 'camera.switch') {
        timelineCamera = corte.value;
        manualCamera = null; // el show retoma el control
      } else if (timeMs < lastTimeMs) {
        timelineCamera = base.camera;
        manualCamera = null;
      }
    }

    // Los overrides del operador se aplican encima del estado del show,
    // salvo en SAFE MODE, donde nada pisa el estado seguro.
    if (!engine.isSafeMode()) {
      for (const [zoneId, patch] of Object.entries(manual)) {
        const zone = base.zones[zoneId as LightingZoneId];
        if (!zone || !patch) continue;
        if (patch.intensity !== undefined) zone.intensity = patch.intensity;
        if (patch.color !== undefined) zone.color = patch.color;
      }
    }

    base.camera = manualCamera ?? timelineCamera;

    set({
      state: base,
      timeMs,
      lastTimeMs: timeMs,
      timelineCamera,
      manualCamera,
      status: engine.getStatus(),
      durationMs: engine.getDurationMs(),
      safeMode: engine.isSafeMode(),
    });
  },
}));
