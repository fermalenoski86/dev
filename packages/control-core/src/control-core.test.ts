import { describe, it, expect } from 'vitest';
import { parseShowPackage } from '@trust/shared-types';
import { DEMO_SCENES, EL_TRUST, resolveStateAt } from '@trust/show-engine';
import {
  AlarmRegistry,
  DEMO_THRESHOLDS,
  evaluateAlarms,
  evaluateFreshness,
  sampleTelemetry,
  withAlarms,
  type ElectricalAlarm,
  type TelemetrySample,
  type TrackedAlarm,
} from '@trust/telemetry';
import {
  BUILDING_MODES,
  PROVENANCE_IS_VERIFIED,
  EventLog,
  MockAiAssistant,
  applyModeToState,
  buildAiContext,
  buildSystemSnapshot,
  hasVerifiedDevices,
  resolveEffectiveMode,
  worstDeviceHealth,
  type BuildingMode,
  type Subsystem,
} from './index';

const ctx = { building: EL_TRUST, scenes: DEMO_SCENES };
const T0 = Date.UTC(2026, 8, 21, 22, 30, 0);

const SHOW = parseShowPackage({
  id: 'ctrl_demo',
  name: 'Demo control',
  version: 1,
  durationMs: 30000,
  media: { horizontal: '/demo/h.mp4' },
  mediaGroups: {
    towers: {
      source: '/demo/m.mp4',
      canvas: { width: 2592, height: 576 },
      layout: {
        screen_a: { x: 0, y: 0, w: 1152 / 2592, h: 1 },
        screen_b: { x: 1152 / 2592, y: 0, w: 1440 / 2592, h: 1 },
      },
    },
  },
  initialState: { lightingScene: 'trust_normal', clockState: 'normal' },
  timeline: [
    { atMs: 1000, type: 'media.play', target: 'screen_a' },
    { atMs: 1000, type: 'media.play', target: 'screen_b' },
    { atMs: 1000, type: 'media.play', target: 'horizontal' },
  ],
});

const showState = (t = 5000, opts = {}) =>
  resolveStateAt(SHOW, ctx, t, { transport: 'playing', ...opts });

const liveSample = (scenario = 'NORMAL'): TelemetrySample =>
  evaluateFreshness({
    now: T0,
    measuredAt: T0,
    receivedAt: T0,
    telemetry: withAlarms(sampleTelemetry(T0, { scenario: scenario as never })).telemetry,
  });

const baseInput = {
  show: showState(),
  showStatus: 'playing' as const,
  safeMode: false,
  sample: liveSample(),
  alarms: [] as TrackedAlarm[],
  mediaErrors: [] as string[],
  controlReachable: true,
};

/** Alarmas reales evaluadas para un escenario, via AlarmRegistry. */
function alarmasDe(scenario: string, at = T0): { sample: TelemetrySample; alarms: TrackedAlarm[] } {
  const sample = liveSample(scenario);
  const reg = new AlarmRegistry();
  reg.update(evaluateAlarms(sample.telemetry!, DEMO_THRESHOLDS), at);
  return { sample, alarms: reg.active() };
}

/* ════════════════════════════════════════════════════════════════
 * M2A.1 / 1 — logicalState vs deviceHealth
 * ════════════════════════════════════════════════════════════════ */

describe('M2A.1 punto 1: estado logico separado de salud de dispositivo', () => {
  it('CRITERIO: ningun dispositivo fisico aparece ONLINE sin hardware', () => {
    const s = buildSystemSnapshot(baseInput);
    for (const sub of s) {
      expect(sub.provenance).toBe('SIMULATED');
    }
    expect(hasVerifiedDevices(s)).toBe(false);
  });

  it('CRITERIO: SIMULATED no cuenta como verificado', () => {
    expect(PROVENANCE_IS_VERIFIED.SIMULATED).toBe(false);
    expect(PROVENANCE_IS_VERIFIED.REAL).toBe(true);
    expect(hasVerifiedDevices(buildSystemSnapshot(baseInput))).toBe(false);
  });

  it('el show-engine puede decir LIVE aunque el dispositivo sea SIMULATED', () => {
    // Ejes independientes: la intencion del show es legitima aunque el LED de
    // la calle todavia no exista.
    const p = buildSystemSnapshot(baseInput).find((x) => x.id === 'screen_corrientes')!;
    expect(p.logicalState).toBe('LIVE');
    expect(p.provenance).toBe('SIMULATED');
  });

  it('el estado logico refleja output: LIVE / HOLD / BLACK', () => {
    expect(
      buildSystemSnapshot(baseInput).find((x) => x.id === 'screen_corrientes')!.logicalState,
    ).toBe('LIVE');

    const pausado = buildSystemSnapshot({
      ...baseInput,
      show: resolveStateAt(SHOW, ctx, 5000, { transport: 'paused' }),
      showStatus: 'paused',
    });
    expect(pausado.find((x) => x.id === 'screen_corrientes')!.logicalState).toBe('HOLD');

    const detenido = buildSystemSnapshot({
      ...baseInput,
      show: resolveStateAt(SHOW, ctx, 5000, { transport: 'stopped' }),
      showStatus: 'stopped',
    });
    expect(detenido.find((x) => x.id === 'screen_corrientes')!.logicalState).toBe('BLACK');
  });

  it('sin show cargado el estado logico es IDLE, no BLACK', () => {
    const s = buildSystemSnapshot({ ...baseInput, show: null, showStatus: 'stopped' });
    expect(s.find((x) => x.id === 'screen_corrientes')!.logicalState).toBe('IDLE');
  });

  it('SAFE MODE fuerza BLACK logico sin cambiar la salud del dispositivo', () => {
    const s = buildSystemSnapshot({
      ...baseInput,
      safeMode: true,
      show: resolveStateAt(SHOW, ctx, 5000, { transport: 'playing', safeMode: true }),
    });
    const p = s.find((x) => x.id === 'screen_corrientes')!;
    expect(p.logicalState).toBe('BLACK');
    expect(p.provenance).toBe('SIMULATED');
  });

  it('un clip que no carga es problema de contenido, no del dispositivo', () => {
    const s = buildSystemSnapshot({ ...baseInput, mediaErrors: ['/demo/m.mp4'] });
    const p = s.find((x) => x.id === 'screen_corrientes')!;
    expect(p.detail).toContain('no carga');
    expect(p.provenance).toBe('SIMULATED');
  });

  it('cada subsistema simulado explica por que no esta verificado', () => {
    for (const s of buildSystemSnapshot(baseInput)) {
      if (s.provenance === 'SIMULATED' && s.id !== 'electrical') {
        expect(s.healthDetail.length).toBeGreaterThan(0);
      }
    }
  });

  it('la salud puede inyectarse: el dia que EDGE reporte no cambia la funcion', () => {
    const s = buildSystemSnapshot({
      ...baseInput,
      deviceHealth: { screen_corrientes: 'WARNING', screen_pellegrini: 'OFFLINE' },
      provenance: { screen_corrientes: 'REAL', screen_pellegrini: 'REAL' },
    });
    expect(s.find((x) => x.id === 'screen_corrientes')!.health).toBe('WARNING');
    expect(s.find((x) => x.id === 'screen_corrientes')!.provenance).toBe('REAL');
    expect(s.find((x) => x.id === 'screen_pellegrini')!.health).toBe('OFFLINE');
    expect(s.find((x) => x.id === 'screen_horizontal')!.provenance).toBe('SIMULATED');
  });

  it('perder CONTROL deja conectividad OFFLINE', () => {
    const c = buildSystemSnapshot({ ...baseInput, controlReachable: false }).find(
      (x) => x.id === 'connectivity',
    )!;
    expect(c.health).toBe('OFFLINE');
    expect(c.detail).toContain('DEGRADED_OFFLINE');
  });

  it('worstDeviceHealth prioriza lo peor', () => {
    const mk = (health: Subsystem['health']): Subsystem => ({
      id: 'clock',
      label: '',
      group: 'clock',
      logicalState: 'IDLE',
      health,
      provenance: 'SIMULATED',
      detail: '',
      healthDetail: '',
    });
    expect(worstDeviceHealth([mk('ONLINE'), mk('WARNING')])).toBe('WARNING');
    expect(worstDeviceHealth([mk('WARNING'), mk('CRITICAL')])).toBe('CRITICAL');
    expect(worstDeviceHealth([mk('ONLINE'), mk('STALE')])).toBe('STALE');
    expect(worstDeviceHealth([mk('ONLINE')])).toBe('ONLINE');
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2A.1 / 5 — frescura reflejada en la salud
 * ════════════════════════════════════════════════════════════════ */

describe('M2A.1 punto 5: la frescura degrada la salud del electrico', () => {
  const conEdad = (ageMs: number): TelemetrySample =>
    evaluateFreshness({
      now: T0 + ageMs,
      measuredAt: T0,
      receivedAt: T0,
      telemetry: withAlarms(sampleTelemetry(T0)).telemetry,
      staleAfterMs: 5000,
    });

  it('CRITERIO: un dato viejo no se presenta como si estuviera al dia', () => {
    const e = buildSystemSnapshot({ ...baseInput, sample: conEdad(60_000) }).find(
      (x) => x.id === 'electrical',
    )!;
    expect(e.health).toBe('STALE');
    expect(e.healthDetail).toContain('Ultima lectura');
  });

  it('dentro de la tolerancia esta ONLINE, pero con procedencia simulada', () => {
    const e = buildSystemSnapshot({ ...baseInput, sample: conEdad(1000) }).find(
      (x) => x.id === 'electrical',
    )!;
    expect(e.health).toBe('ONLINE');
    expect(e.provenance).toBe('SIMULATED');
  });

  it('error de comunicacion es critico', () => {
    const sample = evaluateFreshness({
      now: T0,
      measuredAt: T0 - 1000,
      receivedAt: T0 - 1000,
      telemetry: withAlarms(sampleTelemetry(T0)).telemetry,
      commError: 'timeout',
    });
    expect(
      buildSystemSnapshot({ ...baseInput, sample }).find((x) => x.id === 'electrical')!.health,
    ).toBe('CRITICAL');
  });

  it('sin muestras el electrico queda OFFLINE', () => {
    expect(
      buildSystemSnapshot({ ...baseInput, sample: null }).find((x) => x.id === 'electrical')!
        .health,
    ).toBe('OFFLINE');
  });

  it('una alarma critica degrada la salud aunque el dato sea fresco', () => {
    const { sample, alarms } = alarmasDe('PHASE_LOSS');
    expect(
      buildSystemSnapshot({ ...baseInput, sample, alarms }).find((x) => x.id === 'electrical')!.health,
    ).toBe('CRITICAL');
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2A.1 / 3 — modos y estado de preview
 * ════════════════════════════════════════════════════════════════ */

describe('M2A.1 punto 3: requestedMode vs effectivePreviewMode', () => {
  it('cada modo apunta a una escena que existe', () => {
    for (const spec of Object.values(BUILDING_MODES)) {
      expect(DEMO_SCENES.has(spec.lightingSceneId)).toBe(true);
    }
  });

  it('cada modo tiene escena PROPIA: sin escenas compartidas', () => {
    // Si dos modos compartieran escena, el modo efectivo seria ambiguo.
    const escenas = Object.values(BUILDING_MODES).map((m) => m.lightingSceneId);
    expect(new Set(escenas).size).toBe(escenas.length);
  });

  it('CRITERIO: aplicar un modo hace que el estado coincida con el', () => {
    for (const mode of Object.keys(BUILDING_MODES) as BuildingMode[]) {
      const aplicado = applyModeToState(showState(), mode, DEMO_SCENES, false);
      const efectivo = resolveEffectiveMode({ requested: mode, state: aplicado, safeMode: false });
      expect(efectivo.matches).toBe(true);
      expect(efectivo.effective).toBe(mode);
      expect(efectivo.explanation).toBe('');
    }
  });

  it('CRITERIO: la UI no puede decir TAKEOVER con una escena incompatible', () => {
    const efectivo = resolveEffectiveMode({
      requested: 'TAKEOVER',
      state: showState(),
      safeMode: false,
    });
    expect(efectivo.matches).toBe(false);
    expect(efectivo.effective).toBe('NORMAL');
    expect(efectivo.reason).toBe('SHOW_TIMELINE');
    expect(efectivo.explanation).toContain('trust_normal');
  });

  it('SAFE MODE pisa cualquier modo y lo dice', () => {
    const e = resolveEffectiveMode({ requested: 'ICONIC', state: showState(), safeMode: true });
    expect(e.matches).toBe(false);
    expect(e.effective).toBeNull();
    expect(e.reason).toBe('SAFE_MODE');
  });

  it('aplicar un modo en SAFE MODE no cambia nada', () => {
    const estado = showState();
    expect(applyModeToState(estado, 'TAKEOVER', DEMO_SCENES, true)).toBe(estado);
  });

  it('una escena sin modo asociado se reporta como manual', () => {
    const estado = { ...showState(), lightingSceneId: 'safe_mode' };
    const e = resolveEffectiveMode({ requested: 'NORMAL', state: estado, safeMode: false });
    expect(e.reason).toBe('MANUAL_SCENE');
    expect(e.effective).toBeNull();
  });

  it('sin show cargado lo dice en vez de fingir coincidencia', () => {
    const e = resolveEffectiveMode({ requested: 'NORMAL', state: null, safeMode: false });
    expect(e.reason).toBe('NO_SHOW');
    expect(e.matches).toBe(false);
  });

  it('applyModeToState no muta el estado original', () => {
    const estado = showState();
    const copia = JSON.parse(JSON.stringify(estado));
    applyModeToState(estado, 'TAKEOVER', DEMO_SCENES, false);
    expect(estado).toEqual(copia);
  });

  it('TAKEOVER tine la torre pero NO cede la cupula: la firma no se alquila entera', () => {
    const aplicado = applyModeToState(showState(), 'TAKEOVER', DEMO_SCENES, false);
    expect(aplicado.zones.tower_upper.color.g).toBeLessThan(0.3);
    expect(aplicado.zones.dome.color.g).toBeGreaterThan(0.5);
  });

  it('solo TAKEOVER cede parte de la firma', () => {
    for (const [mode, spec] of Object.entries(BUILDING_MODES)) {
      expect(spec.cedesSignature).toBe(mode === 'TAKEOVER');
    }
  });
});

/* ════════════════════════════════════════════════════════════════
 * Event log
 * ════════════════════════════════════════════════════════════════ */

describe('event log', () => {
  const evt = (over = {}) => ({
    timestamp: T0,
    source: 'test',
    category: 'SYSTEM' as const,
    severity: 'info' as const,
    message: 'x',
    metadata: {},
    ...over,
  });

  it('ids deterministas por secuencia', () => {
    const log = new EventLog({ capacity: 5 });
    expect(log.add(evt()).id).toBe('evt_000000');
    expect(log.add(evt()).id).toBe('evt_000001');
  });

  it('respeta la capacidad descartando lo mas viejo', () => {
    const log = new EventLog({ capacity: 5 });
    for (let i = 0; i < 9; i++) log.add(evt({ message: `m${i}` }));
    expect(log.size()).toBe(5);
    expect(log.list()[0]!.message).toBe('m8');
  });

  it('filtra por categoria y recorta por ventana', () => {
    const log = new EventLog();
    log.add(evt({ category: 'ENERGY', timestamp: T0 - 100_000 }));
    log.add(evt({ category: 'MEDIA', timestamp: T0 }));
    expect(log.list('ENERGY')).toHaveLength(1);
    expect(log.since(T0 - 1000)).toHaveLength(1);
  });

  it('los info no cuentan como pendientes de reconocer', () => {
    const log = new EventLog();
    log.add(evt({ severity: 'info' }));
    log.add(evt({ severity: 'warning' }));
    expect(log.unacknowledged()).toHaveLength(1);
    expect(log.acknowledgeAll()).toBe(1);
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2A.1 / 4 — la IA explica, no evalua
 * ════════════════════════════════════════════════════════════════ */

function makeContext(over: Record<string, unknown> = {}) {
  const sample = liveSample();
  const registry = new AlarmRegistry();
  registry.update(evaluateAlarms(sample.telemetry!, DEMO_THRESHOLDS), T0);
  return buildAiContext({
    now: T0,
    buildingId: EL_TRUST.id,
    mode: 'NORMAL',
    effectiveMode: resolveEffectiveMode({
      requested: 'NORMAL',
      state: showState(),
      safeMode: false,
    }),
    safeMode: false,
    controlReachable: true,
    show: showState(),
    showId: SHOW.id,
    showName: SHOW.name,
    showDurationMs: SHOW.durationMs,
    transport: 'playing',
    subsystems: buildSystemSnapshot(baseInput),
    sample,
    alarms: registry.active(),
    thresholds: DEMO_THRESHOLDS,
    log: new EventLog(),
    ...over,
  });
}

function contextConEscenario(scenario: string) {
  const sample = liveSample(scenario);
  const registry = new AlarmRegistry();
  registry.update(evaluateAlarms(sample.telemetry!, DEMO_THRESHOLDS), T0);
  return makeContext({ sample, alarms: registry.active() });
}

describe('M2A.1 punto 4: el asistente no tiene criterio tecnico propio', () => {
  const ai = new MockAiAssistant();

  it('el contexto trae el umbral CONFIGURADO de cada alarma', () => {
    const pf = contextConEscenario('LOW_POWER_FACTOR').energy.activeAlarms.find(
      (a) => a.metric === 'power_factor',
    );
    expect(pf).toBeDefined();
    // pf 0.782 cruza el umbral critico, no el de aviso.
    expect(pf!.threshold).toBe(DEMO_THRESHOLDS.powerFactor.criticalBelow);
  });

  it('CRITERIO: cambiar el umbral cambia la respuesta, sin tocar el asistente', () => {
    // Si el asistente tuviera su propio 0.92 hardcodeado, esto fallaria.
    const sample = liveSample();
    const laxos = { ...DEMO_THRESHOLDS, powerFactor: { warnBelow: 0.1, criticalBelow: 0.05 } };
    const estrictos = { ...DEMO_THRESHOLDS, powerFactor: { warnBelow: 0.999, criticalBelow: 0.998 } };

    const rl = new AlarmRegistry();
    rl.update(evaluateAlarms(sample.telemetry!, laxos), T0);
    const re = new AlarmRegistry();
    re.update(evaluateAlarms(sample.telemetry!, estrictos), T0);

    const conLaxos = ai.ask(
      '¿Como esta el factor de potencia?',
      makeContext({ alarms: rl.active(), thresholds: laxos }),
    );
    const conEstrictos = ai.ask(
      '¿Como esta el factor de potencia?',
      makeContext({ alarms: re.active(), thresholds: estrictos }),
    );

    expect(conLaxos.text).toContain('No hay alarma activa');
    expect(conEstrictos.text).toContain('alarma');
    // Con pf 0.971 se cruza el umbral critico configurado (0.998), y el texto
    // cita ESE numero: sale de la configuracion, no del asistente.
    expect(conEstrictos.text).toContain('0.998');
  });

  it('CRITERIO: sin regla configurada lo dice, en vez de opinar', () => {
    const sinRegla = {
      ...DEMO_THRESHOLDS,
      powerFactor: undefined as unknown as typeof DEMO_THRESHOLDS.powerFactor,
    };
    const r = ai.ask('¿Como esta el factor de potencia?', makeContext({ thresholds: sinRegla, alarms: [] }));
    expect(r.text).toContain('No hay umbral de factor de potencia configurado');
  });

  it('CRITERIO: no afirma penalizacion en factura sin cuadro tarifario', () => {
    const r = ai.ask('¿Como esta el factor de potencia?', contextConEscenario('LOW_POWER_FACTOR'));
    expect(r.text.toLowerCase()).not.toContain('penaliza');
    expect(r.text).toContain('No hay cuadro tarifario cargado');
  });

  it('el contexto declara que los umbrales son DEMO y que no hay tarifa', () => {
    expect(makeContext().energy.rules.thresholdsAreDemo).toBe(true);
    expect(makeContext().energy.rules.tariff).toBeNull();
  });

  it('el desequilibrio se juzga por alarmas configuradas, no por numeros propios', () => {
    const r = ai.ask('¿Hay desequilibrio entre fases?', contextConEscenario('PHASE_IMBALANCE'));
    expect(r.text).toContain('umbral configurado');
    expect(r.usedFields).toContain('energy.rules');
  });

  it('sin desequilibrio dice que esta dentro de los umbrales configurados', () => {
    expect(ai.ask('¿Hay desequilibrio entre fases?', makeContext()).text).toContain(
      'dentro de los umbrales configurados',
    );
  });

  it('aclara que la demanda maxima no es el valor de la distribuidora', () => {
    const r = ai.ask('¿Cual fue la demanda maxima?', makeContext());
    expect(r.text).toContain('no la demanda facturable');
    expect(r.usedFields).toContain('energy.peakDemandIsApproximate');
  });

  it('avisa cuando el dato no esta en vivo', () => {
    const viejo = evaluateFreshness({
      now: T0 + 60_000,
      measuredAt: T0,
      receivedAt: T0,
      telemetry: withAlarms(sampleTelemetry(T0)).telemetry,
      staleAfterMs: 5000,
    });
    expect(ai.ask('¿Cuanto consumimos hoy?', makeContext({ sample: viejo })).text).toContain(
      'no está en vivo',
    );
  });

  it('aclara que ningun dispositivo fisico esta verificado', () => {
    expect(ai.ask('¿Como esta la instalacion?', makeContext()).text).toContain(
      'ningún dispositivo físico está conectado',
    );
  });

  it('explica la divergencia de modo en vez de afirmar el pedido', () => {
    const c = makeContext({
      effectiveMode: resolveEffectiveMode({
        requested: 'TAKEOVER',
        state: showState(),
        safeMode: false,
      }),
    });
    const r = ai.ask('¿En que modo esta el edificio?', c);
    expect(r.text).toContain('TAKEOVER');
    expect(r.text).toContain('NORMAL');
  });

  it('toda respuesta sigue siendo advisory y sin via de actuacion', () => {
    const r = ai.ask('¿Como esta la instalacion?', makeContext()) as unknown as Record<string, unknown>;
    expect(r.advisoryOnly).toBe(true);
    expect(Object.keys(r).sort()).toEqual(['advisoryOnly', 'simulated', 'text', 'usedFields']);
  });

  it('el contexto sigue siendo solo datos serializables', () => {
    const c = makeContext();
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    const recorrer = (v: unknown): void => {
      expect(typeof v).not.toBe('function');
      if (v && typeof v === 'object') Object.values(v).forEach(recorrer);
    };
    recorrer(c);
  });

  it('sin telemetria lo dice en vez de inventar', () => {
    expect(ai.ask('¿Cuanto consumimos hoy?', makeContext({ sample: null, alarms: [] })).text).toContain(
      'No hay telemetría',
    );
  });
});

/* ════════════════════════════════════════════════════════════════
 * Integracion: transiciones → event log
 * ════════════════════════════════════════════════════════════════ */

describe('integracion: transiciones de alarma al event log', () => {
  const mkAlarm = (severity: 'warning' | 'critical', value: number): ElectricalAlarm => ({
    code: 'UNDERVOLTAGE',
    severity,
    metric: 'voltage',
    phase: 'A',
    value,
    unit: 'V',
    threshold: severity === 'critical' ? 207 : 218,
    message: `Subtension en L1: ${value} V`,
    timestamp: T0,
  });

  it('CRITERIO: un evento por transicion, no uno por muestra', () => {
    const reg = new AlarmRegistry();
    const log = new EventLog();
    const registrar = (alarmas: ElectricalAlarm[], t: number) => {
      for (const tr of reg.update(alarmas, t)) {
        log.add({
          timestamp: tr.at,
          source: 'telemetry',
          category: 'ENERGY',
          severity: tr.type === 'RESOLVED' ? 'info' : tr.alarm.severity,
          message: tr.message,
          metadata: { transition: tr.type },
        });
      }
    };

    registrar([mkAlarm('warning', 215)], T0);
    // Diez muestras iguales: no deben generar diez eventos.
    for (let i = 1; i <= 10; i++) registrar([mkAlarm('warning', 215)], T0 + i * 1000);
    registrar([mkAlarm('critical', 203)], T0 + 20_000);
    registrar([mkAlarm('warning', 214)], T0 + 30_000);
    registrar([], T0 + 40_000);

    const tipos = log
      .list('ENERGY')
      .map((e) => e.metadata.transition)
      .reverse();
    expect(tipos).toEqual(['ACTIVATED', 'ESCALATED', 'DEESCALATED', 'RESOLVED']);
  });
});
