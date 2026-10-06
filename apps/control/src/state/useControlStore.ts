'use client';

import { create } from 'zustand';
import type { ShowPackage, ShowRuntimeState } from '@trust/shared-types';
import { safeParseShowPackage } from '@trust/shared-types';
import { ShowEngine, EL_TRUST, DEMO_SCENES, preflightShow, formatIssue } from '@trust/show-engine';
import {
  AlarmRegistry,
  DEMO_INSTALLATION,
  DEMO_THRESHOLDS,
  SimulatedTelemetryProvider,
  evaluateAlarms,
  type TelemetryScenario,
  type TelemetrySample,
  type TrackedAlarm,
} from '@trust/telemetry';
import {
  BUILDING_MODES,
  EventLog,
  MockAiAssistant,
  acknowledgeAlarm as ackAlarm,
  acknowledgeAll as ackAll,
  logAlarmTransitions,
  buildAiContext,
  buildSystemSnapshot,
  resolveEffectiveMode,
  resolvePreviewState,
  showDrivesLighting,
  type AiAnswer,
  type BuildingMode,
  type EffectiveMode,
  type EventFilter,
  type PreviewResult,
  type Subsystem,
  type TrustEvent,
} from '@trust/control-core';

/**
 * Estado del centro de control.
 *
 * Reutiliza `ShowEngine` tal cual: PLAY/PAUSE/STOP/SAFE MODE no se
 * reimplementan aca, se delegan. Si CONTROL tuviera su propia nocion de "que
 * significa pausar", tarde o temprano diferiria de la de PREVIS y de la de
 * EDGE, y el panel mostraria un edificio distinto del real.
 */

const context = { building: EL_TRUST, scenes: DEMO_SCENES };
/** Cadencia de muestreo. Un analizador real publica ~1 Hz. */
const TELEMETRY_PERIOD_MS = 1000;

export type FaultMode = 'none' | 'stale' | 'comm_error';

export interface ControlState {
  // ── Show ──────────────────────────────────────────────────────
  engine: ShowEngine | null;
  show: ShowPackage | null;
  /**
   * M2A.2 / punto 1. Verdad inmutable del ShowEngine. Nunca se modifica.
   * Todo lo que muestra la UI sobre iluminacion sale de aca salvo que el
   * operador habilite explicitamente el override Y el show no ilumine.
   */
  engineState: ShowRuntimeState | null;
  /** Lo que se pinta. Identico a engineState en el caso normal. */
  showState: ShowRuntimeState | null;
  preview: PreviewResult | null;
  /** El operador pidio previsualizar el modo. Por defecto NO. */
  overrideEnabled: boolean;
  transport: 'stopped' | 'playing' | 'paused' | 'ended';
  safeMode: boolean;
  showError: string | null;

  // ── Modo del edificio (M2A.1 / punto 3) ───────────────────────
  requestedMode: BuildingMode;
  effectiveMode: EffectiveMode | null;
  setOverrideEnabled: (enabled: boolean) => void;

  // ── Telemetria ────────────────────────────────────────────────
  provider: SimulatedTelemetryProvider;
  sample: TelemetrySample | null;
  registry: AlarmRegistry;
  alarms: TrackedAlarm[];
  scenario: TelemetryScenario;
  faultMode: FaultMode;

  // ── Supervision y eventos ─────────────────────────────────────
  subsystems: Subsystem[];
  log: EventLog;
  events: TrustEvent[];
  eventFilter: EventFilter;
  unacknowledged: number;

  // ── IA ────────────────────────────────────────────────────────
  assistant: MockAiAssistant;
  aiHistory: Array<{ question: string; answer: AiAnswer }>;

  now: number;
  lastTelemetryMs: number;

  loadShow: (raw: unknown) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  toggleSafeMode: () => void;
  setMode: (mode: BuildingMode) => void;
  setScenario: (scenario: TelemetryScenario) => void;
  setFaultMode: (mode: FaultMode) => void;
  setEventFilter: (filter: EventFilter) => void;
  acknowledgeAlarm: (key: string) => void;
  acknowledgeAll: () => void;
  askAi: (question: string) => void;
  tick: (now: number) => void;
}

export const useControlStore = create<ControlState>((set, get) => ({
  engine: null,
  show: null,
  engineState: null,
  showState: null,
  preview: null,
  overrideEnabled: false,
  transport: 'stopped',
  safeMode: false,
  showError: null,

  requestedMode: 'NORMAL',
  effectiveMode: null,

  provider: new SimulatedTelemetryProvider(),
  sample: null,
  registry: new AlarmRegistry(),
  alarms: [],
  scenario: 'NORMAL',
  faultMode: 'none',

  subsystems: [],
  log: new EventLog({ capacity: 500 }),
  events: [],
  eventFilter: 'TODOS',
  unacknowledged: 0,

  assistant: new MockAiAssistant(),
  aiHistory: [],

  now: 0,
  lastTelemetryMs: 0,

  loadShow: (raw) => {
    const parsed = safeParseShowPackage(raw);
    if (!parsed.success) {
      set({ showError: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ') });
      return;
    }
    const show = parsed.data;
    const pre = preflightShow(show, context);
    if (!pre.ok) {
      set({ showError: pre.errors.map(formatIssue).join(' · ') });
      return;
    }

    const existing = get().engine;
    const engine = existing ?? new ShowEngine({ show, context });
    if (existing) existing.loadShow(show);

    get().log.add({
      timestamp: Date.now(),
      source: 'operator',
      category: 'MEDIA',
      severity: 'info',
      message: `Show cargado: ${show.name}`,
      metadata: { showId: show.id, durationMs: show.durationMs },
    });

    set({ engine, show, showError: null, transport: 'stopped' });
    get().tick(Date.now());
  },

  play: () => {
    const { engine, log } = get();
    if (!engine) return;
    engine.play();
    log.add({ timestamp: Date.now(), source: 'operator', category: 'MEDIA', severity: 'info', message: 'PLAY', metadata: {} });
    get().tick(Date.now());
  },

  pause: () => {
    const { engine, log } = get();
    if (!engine) return;
    engine.pause();
    log.add({ timestamp: Date.now(), source: 'operator', category: 'MEDIA', severity: 'info', message: 'PAUSE — pantallas en HOLD', metadata: {} });
    get().tick(Date.now());
  },

  stop: () => {
    const { engine, log } = get();
    if (!engine) return;
    engine.stop();
    log.add({ timestamp: Date.now(), source: 'operator', category: 'MEDIA', severity: 'info', message: 'STOP — pantallas en BLACK', metadata: {} });
    get().tick(Date.now());
  },

  toggleSafeMode: () => {
    const { engine, log } = get();
    if (!engine) return;
    const entrando = !engine.isSafeMode();
    if (entrando) engine.enterSafeMode();
    else engine.exitSafeMode();
    log.add({
      timestamp: Date.now(),
      source: 'operator',
      category: 'SAFETY',
      severity: entrando ? 'critical' : 'info',
      message: entrando
        ? 'SAFE MODE activado por el operador — pantallas en negro, iluminacion segura'
        : 'SAFE MODE desactivado — el control vuelve a la programacion',
      metadata: { manual: true },
    });
    get().tick(Date.now());
  },

  setOverrideEnabled: (enabled) => {
    get().log.add({
      timestamp: Date.now(),
      source: 'operator',
      category: 'LIGHTING',
      severity: 'info',
      message: enabled
        ? 'Override de preview habilitado (no afecta al show ni al hardware)'
        : 'Override de preview deshabilitado',
      metadata: { simulated: true },
    });
    set({ overrideEnabled: enabled });
    get().tick(Date.now());
  },

  setMode: (mode) => {
    const anterior = get().requestedMode;
    if (anterior === mode) return;
    const spec = BUILDING_MODES[mode];
    get().log.add({
      timestamp: Date.now(),
      source: 'operator',
      category: 'LIGHTING',
      severity: 'info',
      message: `Modo ${anterior} → ${mode} · escena ${spec.lightingSceneId}`,
      metadata: { from: anterior, to: mode, simulated: true },
    });
    set({ requestedMode: mode });
    get().tick(Date.now());
  },

  setScenario: (scenario) => {
    get().provider.setScenario(scenario);
    get().registry.reset();
    get().log.add({
      timestamp: Date.now(),
      source: 'dev',
      category: 'SYSTEM',
      severity: 'info',
      message: `Escenario de simulacion electrica: ${scenario}`,
      metadata: { simulated: true },
    });
    set({ scenario, lastTelemetryMs: 0 });
    get().tick(Date.now());
  },

  setFaultMode: (mode) => {
    get().provider.setFaultMode(mode);
    get().log.add({
      timestamp: Date.now(),
      source: 'dev',
      category: 'SYSTEM',
      severity: mode === 'none' ? 'info' : 'warning',
      message:
        mode === 'none'
          ? 'Enlace con el medidor restablecido (simulado)'
          : `Falla de enlace simulada: ${mode}`,
      metadata: { simulated: true },
    });
    set({ faultMode: mode, lastTelemetryMs: 0 });
    get().tick(Date.now());
  },

  setEventFilter: (eventFilter) => {
    set({ eventFilter, events: get().log.list(eventFilter) });
  },

  // M2A.2 / punto 5: una sola operacion sobre registro y log.
  acknowledgeAlarm: (key) => {
    const s = get();
    ackAlarm(key, { registry: s.registry, log: s.log, now: Date.now() });
    set({
      alarms: s.registry.active(),
      events: s.log.list(s.eventFilter),
      unacknowledged: s.log.unacknowledged().length,
    });
  },

  acknowledgeAll: () => {
    const s = get();
    ackAll({ registry: s.registry, log: s.log, now: Date.now() });
    set({
      alarms: s.registry.active(),
      events: s.log.list(s.eventFilter),
      unacknowledged: s.log.unacknowledged().length,
    });
  },

  askAi: (question) => {
    const s = get();
    const ctx = buildAiContext({
      now: s.now || Date.now(),
      buildingId: EL_TRUST.id,
      mode: s.requestedMode,
      effectiveMode:
        s.effectiveMode ??
        resolveEffectiveMode({ requested: s.requestedMode, state: s.showState, safeMode: s.safeMode }),
      safeMode: s.safeMode,
      controlReachable: true,
      show: s.showState,
      showId: s.show?.id ?? null,
      showName: s.show?.name ?? null,
      showDurationMs: s.show?.durationMs ?? 0,
      transport: s.transport,
      subsystems: s.subsystems,
      sample: s.sample,
      alarms: s.alarms,
      thresholds: DEMO_THRESHOLDS,
      log: s.log,
      spec: DEMO_INSTALLATION,
    });
    set({ aiHistory: [...s.aiHistory, { question, answer: s.assistant.ask(question, ctx) }] });
  },

  /**
   * Un tick por segundo. El show se consulta siempre; la telemetria solo cada
   * TELEMETRY_PERIOD_MS, porque un analizador real no publica a 60 Hz y ver
   * los valores temblando a esa velocidad es ilegible.
   */
  tick: (now) => {
    const s = get();
    const patch: Partial<ControlState> = { now };

    let engineState = s.engineState;
    let previewState = s.showState;
    let safeMode = s.safeMode;

    if (s.engine) {
      safeMode = s.engine.isSafeMode();
      // La verdad del motor se toma tal cual y NO se modifica (M2A.2 / 1).
      engineState = s.engine.getState();
      const preview = resolvePreviewState({
        engineState,
        requestedMode: s.requestedMode,
        scenes: DEMO_SCENES,
        safeMode,
        showDrivesLighting: showDrivesLighting(s.show),
        overrideEnabled: s.overrideEnabled,
      });
      previewState = preview.state;
      patch.engineState = engineState;
      patch.showState = previewState;
      patch.preview = preview;
      patch.transport = s.engine.getStatus();
      patch.safeMode = safeMode;
    }

    patch.effectiveMode = resolveEffectiveMode({
      requested: s.requestedMode,
      state: previewState,
      safeMode,
    });

    let sample = s.sample;
    let alarms = s.alarms;

    if (now - s.lastTelemetryMs >= TELEMETRY_PERIOD_MS) {
      sample = s.provider.readSample(now);
      patch.sample = sample;
      patch.lastTelemetryMs = now;

      const evaluadas = sample.telemetry
        ? evaluateAlarms(sample.telemetry, DEMO_THRESHOLDS, DEMO_INSTALLATION)
        : [];

      /*
       * Un evento por TRANSICION, no uno por muestra. El logger es compartido
       * con los tests (M2A.3 / punto 1): si produccion y test construyeran el
       * evento por caminos distintos, el test no probaria produccion — que es
       * exactamente como el ACK llego a funcionar solo en los tests.
       */
      logAlarmTransitions(s.log, s.registry.update(evaluadas, now));
      alarms = s.registry.active();
      patch.alarms = alarms;
    }

    patch.subsystems = buildSystemSnapshot({
      show: previewState,
      showStatus: patch.transport ?? s.transport,
      safeMode,
      sample,
      // M2A.2 / punto 2: las MISMAS alarmas que ve ENERGY.
      alarms,
      mediaErrors: [],
      controlReachable: true,
    });

    patch.events = s.log.list(s.eventFilter);
    patch.unacknowledged = s.log.unacknowledged().length;

    set(patch);
  },
}));
