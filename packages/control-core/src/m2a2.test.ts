import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseShowPackage, type ShowPackage } from '@trust/shared-types';
import { DEMO_SCENES, EL_TRUST, ShowEngine } from '@trust/show-engine';
import { ManualClock } from '@trust/timeline';
import {
  AlarmRegistry,
  DEMO_THRESHOLDS,
  SimulatedTelemetryProvider,
  evaluateAlarms,
  evaluateFreshness,
  resolveSeriesWindow,
  sampleTelemetry,
  withAlarms,
  type TelemetrySample,
  type TrackedAlarm,
} from '@trust/telemetry';
import {
  ALARM_ACKNOWLEDGED,
  EventLog,
  acknowledgeAlarm,
  acknowledgeAll,
  buildSystemSnapshot,
  deriveElectricalHealth,
  hasVerifiedDevices,
  isAckConsistent,
  resolveEffectiveMode,
  resolvePreviewState,
  showDrivesLighting,
  type BuildingMode,
} from './index';

const ctx = { building: EL_TRUST, scenes: DEMO_SCENES };
const T0 = Date.UTC(2026, 8, 21, 22, 30, 0);
const SHOWS_DIR = resolve(__dirname, '../../../shows');

const loadShow = (name: string): ShowPackage =>
  parseShowPackage(JSON.parse(readFileSync(resolve(SHOWS_DIR, `${name}.json`), 'utf8')));

/* ════════════════════════════════════════════════════════════════
 * M2A.2 / 1 — el motor es la verdad; el modo no lo pisa
 * ════════════════════════════════════════════════════════════════ */

describe('M2A.2 punto 1: engineState no se toca', () => {
  const engineAt = (show: ShowPackage, tMs: number) => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show, context: ctx, now: clock.now });
    engine.play();
    clock.advance(tMs);
    return engine;
  };

  const preview = (show: ShowPackage, tMs: number, mode: BuildingMode) => {
    const engine = engineAt(show, tMs);
    const engineState = engine.getState();
    const result = resolvePreviewState({
      engineState,
      requestedMode: mode,
      scenes: DEMO_SCENES,
      safeMode: engine.isSafeMode(),
      showDrivesLighting: showDrivesLighting(show),
      overrideEnabled: true,
    });
    return { engineState, result };
  };

  it('CRITERIO trust_signature_001: la respiración de dome sobrevive a NORMAL', () => {
    // El bug: applyModeToState corría en cada tick y aplastaba la cúpula al
    // valor fijo de trust_normal, anulando el fade de 16-20 s del show.
    const show = loadShow('trust_signature_001');

    const muestras = [16000, 17000, 18000, 19000, 20000].map((t) => {
      const { engineState, result } = preview(show, t, 'NORMAL');
      return {
        t,
        motor: engineState.zones.dome.intensity,
        visto: result.state!.zones.dome.intensity,
        source: result.source,
      };
    });

    for (const m of muestras) {
      // Lo que se muestra es EXACTAMENTE lo que resolvió el motor.
      expect(m.visto, `t=${m.t}`).toBe(m.motor);
      expect(m.source).toBe('ENGINE');
    }

    // Y la respiración existe de verdad: la cúpula se mueve en esa ventana.
    const valores = muestras.map((m) => m.visto);
    expect(Math.max(...valores) - Math.min(...valores)).toBeGreaterThan(0.05);

    // El valor fijo de trust_normal (0.85) NO es lo que se ve durante el fade.
    const trustNormalDome = DEMO_SCENES.get('trust_normal')!.zones.dome!.intensity;
    expect(muestras.some((m) => Math.abs(m.visto - trustNormalDome) > 0.02)).toBe(true);
  });

  it('CRITERIO mcdonalds_takeover_001: el lighting.scene del timeline se ve', () => {
    const show = loadShow('mcdonalds_takeover_001');
    // El evento mcd_red_gold está en 7000 con fade 2500: a los 9500 ya llegó.
    const { engineState, result } = preview(show, 9500, 'NORMAL');

    expect(engineState.lightingSceneId).toBe('mcd_red_gold');
    expect(result.state!.lightingSceneId).toBe('mcd_red_gold');
    expect(result.state).toBe(engineState); // misma identidad: no se copió ni tocó
    expect(result.overrideBlockedReason).toBe('SHOW_TIMELINE');

    // La torre está en rojo de marca, no en cálido de identidad.
    expect(result.state!.zones.tower_upper.color.g).toBeLessThan(0.3);
  });

  it('el modo ICONIC tampoco pisa un takeover del timeline', () => {
    const show = loadShow('mcdonalds_takeover_001');
    const { engineState, result } = preview(show, 9500, 'ICONIC');
    expect(result.state).toBe(engineState);
    expect(result.state!.lightingSceneId).toBe('mcd_red_gold');
  });

  it('a lo largo de TODO el show, lo mostrado es idéntico a lo del motor', () => {
    for (const nombre of ['trust_signature_001', 'mcdonalds_takeover_001']) {
      const show = loadShow(nombre);
      for (let t = 0; t <= show.durationMs; t += 500) {
        const { engineState, result } = preview(show, t, 'TAKEOVER');
        expect(result.state, `${nombre} t=${t}`).toBe(engineState);
      }
    }
  });

  it('sin eventos de iluminación, el override SÍ se aplica', () => {
    // Un show que no ilumina deja lugar al preview del operador: es el único
    // caso donde el modo puede mostrar algo sin contradecir al motor.
    const show = parseShowPackage({
      ...loadShow('mcdonalds_takeover_001'),
      id: 'sin_luces',
      timeline: [{ atMs: 0, type: 'media.play', target: 'horizontal' }],
    });
    expect(showDrivesLighting(show)).toBe(false);

    const { engineState, result } = preview(show, 5000, 'TAKEOVER');
    expect(result.source).toBe('MANUAL_OVERRIDE');
    expect(result.state!.lightingSceneId).toBe('mcd_red_gold');
    // Aun así el estado del motor queda intacto.
    expect(engineState.lightingSceneId).toBe('trust_normal');
    expect(result.state).not.toBe(engineState);
  });

  it('con el override deshabilitado nunca se aplica, aunque el show no ilumine', () => {
    const show = parseShowPackage({
      ...loadShow('mcdonalds_takeover_001'),
      id: 'sin_luces2',
      timeline: [],
    });
    const engine = engineAt(show, 5000);
    const engineState = engine.getState();
    const r = resolvePreviewState({
      engineState,
      requestedMode: 'TAKEOVER',
      scenes: DEMO_SCENES,
      safeMode: false,
      showDrivesLighting: false,
      overrideEnabled: false,
    });
    expect(r.state).toBe(engineState);
    expect(r.overrideBlockedReason).toBe('DISABLED');
  });

  it('SAFE MODE bloquea el override incluso sin eventos de iluminación', () => {
    const show = parseShowPackage({ ...loadShow('mcdonalds_takeover_001'), id: 's3', timeline: [] });
    const engine = engineAt(show, 5000);
    engine.enterSafeMode();
    const engineState = engine.getState();
    const r = resolvePreviewState({
      engineState,
      requestedMode: 'TAKEOVER',
      scenes: DEMO_SCENES,
      safeMode: true,
      showDrivesLighting: false,
      overrideEnabled: true,
    });
    expect(r.state).toBe(engineState);
    expect(r.overrideBlockedReason).toBe('SAFE_MODE');
  });

  it('la divergencia de modo se informa, no se resuelve pisando al motor', () => {
    const show = loadShow('mcdonalds_takeover_001');
    const { result } = preview(show, 9500, 'NORMAL');
    const modo = resolveEffectiveMode({
      requested: 'NORMAL',
      state: result.state,
      safeMode: false,
    });
    expect(modo.matches).toBe(false);
    expect(modo.effective).toBe('TAKEOVER');
    expect(modo.reason).toBe('SHOW_TIMELINE');
  });

  it('showDrivesLighting detecta ambos tipos de evento', () => {
    const base = loadShow('mcdonalds_takeover_001');
    expect(showDrivesLighting(base)).toBe(true);
    expect(
      showDrivesLighting(
        parseShowPackage({ ...base, id: 'z', timeline: [{ atMs: 0, type: 'lighting.zone.set', target: 'dome', intensity: 0.5 }] }),
      ),
    ).toBe(true);
    expect(showDrivesLighting(parseShowPackage({ ...base, id: 'n', timeline: [] }))).toBe(false);
    expect(showDrivesLighting(null)).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2A.2 / 2 — una sola fuente de verdad eléctrica
 * ════════════════════════════════════════════════════════════════ */

describe('M2A.2 punto 2: alarmas y salud eléctrica, misma fuente', () => {
  const desdeProvider = (scenario: string, at = T0) => {
    const provider = new SimulatedTelemetryProvider({ scenario: scenario as never });
    const sample = provider.readSample(at);
    const registry = new AlarmRegistry();
    registry.update(evaluateAlarms(sample.telemetry!, DEMO_THRESHOLDS), at);
    return { sample, alarms: registry.active(), registry };
  };

  const snapshot = (sample: TelemetrySample, alarms: readonly TrackedAlarm[]) =>
    buildSystemSnapshot({
      show: null,
      showStatus: 'stopped',
      safeMode: false,
      sample,
      alarms,
      mediaErrors: [],
      controlReachable: true,
    });

  it('CRITERIO: PHASE_LOSS con provider real da alarma CRITICAL y resumen CRITICAL', () => {
    const { sample, alarms } = desdeProvider('PHASE_LOSS');

    const criticas = alarms.filter((a) => a.severity === 'critical');
    expect(criticas.length).toBeGreaterThan(0);
    expect(criticas.some((a) => a.alarm.code === 'PHASE_LOSS')).toBe(true);

    const electrico = snapshot(sample, alarms).find((s) => s.id === 'electrical')!;
    expect(electrico.health).toBe('CRITICAL');
    expect(electrico.healthDetail).toContain('PHASE_LOSS');
  });

  it('CRITERIO: el snapshot NO depende de telemetry.status', () => {
    // Telemetría con status 'normal' (nunca pasó por withAlarms) pero con
    // alarmas críticas evaluadas aparte: antes esto mostraba todo en orden.
    const { alarms } = desdeProvider('PHASE_LOSS');
    const crudo = sampleTelemetry(T0, { scenario: 'PHASE_LOSS' });
    expect(crudo.status).toBe('normal'); // el simulador no evalúa (ADR-017)

    const sample = evaluateFreshness({
      now: T0,
      measuredAt: T0,
      receivedAt: T0,
      telemetry: crudo,
    });
    expect(snapshot(sample, alarms).find((s) => s.id === 'electrical')!.health).toBe('CRITICAL');
  });

  it('y al revés: telemetry.status crítico sin alarmas evaluadas no inventa una crítica', () => {
    const mentiroso = { ...sampleTelemetry(T0), status: 'critical' as const };
    const sample = evaluateFreshness({
      now: T0,
      measuredAt: T0,
      receivedAt: T0,
      telemetry: mentiroso,
    });
    expect(snapshot(sample, []).find((s) => s.id === 'electrical')!.health).toBe('ONLINE');
  });

  it('cada escenario coincide entre alarmas y salud del resumen', () => {
    for (const scenario of ['NORMAL', 'PHASE_LOSS', 'UNDERVOLTAGE', 'LOW_POWER_FACTOR'] as const) {
      const { sample, alarms } = desdeProvider(scenario);
      const salud = snapshot(sample, alarms).find((s) => s.id === 'electrical')!.health;
      const esperado = alarms.some((a) => a.severity === 'critical')
        ? 'CRITICAL'
        : alarms.some((a) => a.severity === 'warning')
          ? 'WARNING'
          : 'ONLINE';
      expect(salud, scenario).toBe(esperado);
    }
  });

  it('deriveElectricalHealth: la calidad del dato y las alarmas se combinan', () => {
    const vivo = evaluateFreshness({ now: T0, measuredAt: T0, receivedAt: T0, telemetry: sampleTelemetry(T0) });
    const viejo = evaluateFreshness({
      now: T0 + 60_000,
      measuredAt: T0,
      receivedAt: T0,
      telemetry: sampleTelemetry(T0),
      staleAfterMs: 5000,
    });
    const { alarms } = desdeProvider('PHASE_LOSS');

    expect(deriveElectricalHealth(null, [])).toBe('OFFLINE');
    expect(deriveElectricalHealth(vivo, [])).toBe('ONLINE');
    expect(deriveElectricalHealth(viejo, [])).toBe('STALE');
    // Una condición crítica no deja de serlo porque el dato sea viejo.
    expect(deriveElectricalHealth(viejo, alarms)).toBe('CRITICAL');
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2A.2 / 3 — provenance separado de health
 * ════════════════════════════════════════════════════════════════ */

describe('M2A.2 punto 3: una falla simulada nunca verifica nada', () => {
  it('CRITERIO: PHASE_LOSS simulado da CRITICAL sin volver verificado el sistema', () => {
    const provider = new SimulatedTelemetryProvider({ scenario: 'PHASE_LOSS' });
    const sample = provider.readSample(T0);
    const reg = new AlarmRegistry();
    reg.update(evaluateAlarms(sample.telemetry!, DEMO_THRESHOLDS), T0);

    const s = buildSystemSnapshot({
      show: null,
      showStatus: 'stopped',
      safeMode: false,
      sample,
      alarms: reg.active(),
      mediaErrors: [],
      controlReachable: true,
    });

    expect(s.find((x) => x.id === 'electrical')!.health).toBe('CRITICAL');
    expect(s.find((x) => x.id === 'electrical')!.provenance).toBe('SIMULATED');
    expect(hasVerifiedDevices(s)).toBe(false);
  });

  it('ninguna combinación de fallas simuladas vuelve true a hasVerifiedDevices', () => {
    for (const scenario of ['NORMAL', 'PHASE_LOSS', 'UNDERVOLTAGE', 'HIGH_LOAD', 'LOW_POWER_FACTOR'] as const) {
      const provider = new SimulatedTelemetryProvider({ scenario });
      for (const fault of ['none', 'stale', 'comm_error'] as const) {
        provider.readSample(T0);
        provider.setFaultMode(fault);
        const sample = provider.readSample(T0 + 60_000);
        const reg = new AlarmRegistry();
        if (sample.telemetry) reg.update(evaluateAlarms(sample.telemetry, DEMO_THRESHOLDS), T0);
        const s = buildSystemSnapshot({
          show: null,
          showStatus: 'stopped',
          safeMode: false,
          sample,
          alarms: reg.active(),
          mediaErrors: [],
          controlReachable: false,
        });
        expect(hasVerifiedDevices(s), `${scenario}/${fault}`).toBe(false);
      }
    }
  });

  it('CRITERIO: el estado logico NO contamina la salud del dispositivo', () => {
    // Una pantalla en BLACK porque el show la detuvo esta funcionando bien.
    // Si el negro degradara la salud, cada STOP encenderia alarmas falsas.
    const show = loadShow('mcdonalds_takeover_001');
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show, context: ctx, now: clock.now });
    engine.stop();

    const s = buildSystemSnapshot({
      show: engine.getState(),
      showStatus: 'stopped',
      safeMode: false,
      sample: null,
      alarms: [],
      mediaErrors: [],
      controlReachable: true,
    });

    for (const id of ['screen_corrientes', 'screen_pellegrini', 'screen_horizontal']) {
      const sub = s.find((x) => x.id === id)!;
      expect(sub.logicalState, id).toBe('BLACK');
      expect(sub.health, id).toBe('ONLINE');
      expect(sub.provenance, id).toBe('SIMULATED');
    }

    // Y lo mismo en SAFE MODE: negro forzado tampoco es falla de dispositivo.
    engine.enterSafeMode();
    const seguro = buildSystemSnapshot({
      show: engine.getState(),
      showStatus: 'stopped',
      safeMode: true,
      sample: null,
      alarms: [],
      mediaErrors: [],
      controlReachable: true,
    });
    const p = seguro.find((x) => x.id === 'screen_corrientes')!;
    expect(p.logicalState).toBe('BLACK');
    expect(p.health).toBe('ONLINE');
  });

  it('solo un dispositivo con provenance REAL cuenta como verificado', () => {
    const s = buildSystemSnapshot({
      show: null,
      showStatus: 'stopped',
      safeMode: false,
      sample: null,
      alarms: [],
      mediaErrors: [],
      controlReachable: true,
      provenance: { clock: 'REAL' },
      deviceHealth: { clock: 'OFFLINE' },
    });
    // Incluso OFFLINE: si es real, es información verificada.
    expect(s.find((x) => x.id === 'clock')!.health).toBe('OFFLINE');
    expect(hasVerifiedDevices(s)).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2A.2 / 4 — las series no inventan puntos
 * ════════════════════════════════════════════════════════════════ */

describe('M2A.2 punto 4: la serie se congela en measuredAt', () => {
  const RANGO = 3_600_000;
  const tel = withAlarms(sampleTelemetry(T0)).telemetry;

  it('con dato LIVE la serie llega hasta ahora', () => {
    const sample = evaluateFreshness({ now: T0, measuredAt: T0, receivedAt: T0, telemetry: tel });
    const w = resolveSeriesWindow(T0, RANGO, sample);
    expect(w.toMs).toBe(T0);
    expect(w.gap).toBeNull();
    expect(w.empty).toBe(false);
  });

  it('CRITERIO: con STALE no se generan puntos posteriores a measuredAt', () => {
    const now = T0 + 600_000; // 10 min sin publicar
    const sample = evaluateFreshness({
      now,
      measuredAt: T0,
      receivedAt: T0,
      telemetry: tel,
      staleAfterMs: 5000,
    });
    const w = resolveSeriesWindow(now, RANGO, sample);
    expect(w.toMs).toBe(T0);
    expect(w.toMs).toBeLessThan(now);
    expect(w.gap).toEqual({ fromMs: T0, toMs: now });
    expect(w.gapFraction).toBeCloseTo(600_000 / RANGO, 6);
  });

  it('CRITERIO: con COMM_ERROR tampoco', () => {
    const now = T0 + 120_000;
    const sample = evaluateFreshness({
      now,
      measuredAt: T0,
      receivedAt: T0,
      telemetry: tel,
      commError: 'timeout',
    });
    const w = resolveSeriesWindow(now, RANGO, sample);
    expect(w.toMs).toBe(T0);
    expect(w.gap).not.toBeNull();
  });

  it('si el hueco cubre la ventana entera, no hay nada que graficar', () => {
    const now = T0 + RANGO * 2;
    const sample = evaluateFreshness({
      now,
      measuredAt: T0,
      receivedAt: T0,
      telemetry: tel,
      staleAfterMs: 5000,
    });
    const w = resolveSeriesWindow(now, RANGO, sample);
    expect(w.empty).toBe(true);
    expect(w.gapFraction).toBe(1);
  });

  it('sin muestra la ventana queda vacía, no llena de ceros', () => {
    const w = resolveSeriesWindow(T0, RANGO, null);
    expect(w.empty).toBe(true);
    expect(w.gap).toEqual({ fromMs: T0 - RANGO, toMs: T0 });
  });

  it('el hueco nunca se solapa con la parte graficada', () => {
    for (const edad of [0, 1000, 60_000, 600_000, RANGO - 1]) {
      const now = T0 + edad;
      const sample = evaluateFreshness({
        now,
        measuredAt: T0,
        receivedAt: T0,
        telemetry: tel,
        staleAfterMs: 5000,
      });
      const w = resolveSeriesWindow(now, RANGO, sample);
      if (w.gap) expect(w.gap.fromMs).toBeGreaterThanOrEqual(w.toMs);
    }
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2A.2 / 5 — ACK sincronizado
 * ════════════════════════════════════════════════════════════════ */

describe('M2A.2 punto 5: ACK consistente entre registro y log', () => {
  const armar = (scenario: string) => {
    const provider = new SimulatedTelemetryProvider({ scenario: scenario as never });
    const sample = provider.readSample(T0);
    const registry = new AlarmRegistry();
    const log = new EventLog();
    for (const tr of registry.update(evaluateAlarms(sample.telemetry!, DEMO_THRESHOLDS), T0)) {
      log.add({
        timestamp: tr.at,
        source: 'telemetry',
        category: 'ENERGY',
        severity: tr.currentSeverity ?? 'info',
        message: tr.message,
        metadata: { transition: tr.type, key: tr.key, simulated: true },
      });
    }
    return { registry, log };
  };

  it('CRITERIO: el ACK individual deja el estado consistente', () => {
    const { registry, log } = armar('UNDERVOLTAGE');
    const key = registry.unacknowledged()[0]!.key;

    const r = acknowledgeAlarm(key, { registry, log, now: T0 + 1000 });

    expect(r.acknowledgedAlarms).toHaveLength(1);
    expect(registry.get(key)!.acknowledged).toBe(true);
    // La alarma NO se borró: sigue activa.
    expect(registry.active().some((a) => a.key === key)).toBe(true);
    // Los eventos de esa condición quedaron reconocidos.
    expect(log.list('ENERGY').filter((e) => e.metadata.key === key && !e.acknowledged)).toHaveLength(0);
  });

  it('CRITERIO: se registra un evento ALARM_ACKNOWLEDGED', () => {
    const { registry, log } = armar('UNDERVOLTAGE');
    const key = registry.unacknowledged()[0]!.key;
    const r = acknowledgeAlarm(key, { registry, log, now: T0 + 1000, actor: 'fer' });

    expect(r.emitted).toHaveLength(1);
    const evt = r.emitted[0]!;
    expect(evt.metadata.transition).toBe(ALARM_ACKNOWLEDGED);
    expect(evt.metadata.key).toBe(key);
    expect(evt.source).toBe('fer');
    // El propio evento de ACK no queda pendiente de reconocer.
    expect(evt.acknowledged).toBe(true);
  });

  it('CRITERIO: ACK ALL no deja nada pendiente en ninguno de los dos lados', () => {
    const { registry, log } = armar('PHASE_LOSS');
    expect(registry.unacknowledged().length).toBeGreaterThan(0);
    expect(log.unacknowledged().length).toBeGreaterThan(0);

    acknowledgeAll({ registry, log, now: T0 + 1000 });

    expect(registry.unacknowledged()).toHaveLength(0);
    expect(log.unacknowledged()).toHaveLength(0);
    expect(isAckConsistent(registry, log)).toBe(true);
    // Y las condiciones siguen activas: reconocer no es resolver.
    expect(registry.active().length).toBeGreaterThan(0);
  });

  it('ACK ALL emite un evento por cada condición reconocida', () => {
    const { registry, log } = armar('PHASE_LOSS');
    const pendientes = registry.unacknowledged().length;
    const r = acknowledgeAll({ registry, log, now: T0 + 1000 });
    expect(r.emitted).toHaveLength(pendientes);
    for (const e of r.emitted) expect(e.metadata.transition).toBe(ALARM_ACKNOWLEDGED);
  });

  it('reconocer dos veces no duplica eventos', () => {
    const { registry, log } = armar('UNDERVOLTAGE');
    const key = registry.unacknowledged()[0]!.key;
    acknowledgeAlarm(key, { registry, log, now: T0 + 1000 });
    const segunda = acknowledgeAlarm(key, { registry, log, now: T0 + 2000 });
    expect(segunda.emitted).toHaveLength(0);
    expect(segunda.acknowledgedAlarms).toHaveLength(0);
  });

  it('una condición que escala vuelve a quedar pendiente, y el log lo refleja', () => {
    const { registry, log } = armar('UNDERVOLTAGE');
    const key = registry.unacknowledged()[0]!.key;
    acknowledgeAll({ registry, log, now: T0 + 1000 });
    expect(isAckConsistent(registry, log)).toBe(true);

    // Misma condición, ahora crítica.
    const peor = { ...registry.get(key)!.alarm, severity: 'critical' as const, value: 199 };
    for (const tr of registry.update([peor], T0 + 2000)) {
      log.add({
        timestamp: tr.at,
        source: 'telemetry',
        category: 'ENERGY',
        severity: 'critical',
        message: tr.message,
        metadata: { transition: tr.type, key: tr.key },
      });
    }

    expect(registry.get(key)!.acknowledged).toBe(false);
    expect(isAckConsistent(registry, log)).toBe(false);
  });

  it('ACK sobre una clave inexistente no emite nada', () => {
    const { registry, log } = armar('NORMAL');
    const r = acknowledgeAlarm('NO_EXISTE|-|voltage', { registry, log, now: T0 });
    expect(r.emitted).toHaveLength(0);
    expect(r.acknowledgedEvents).toBe(0);
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2A.2 / 6 — la alarma describe la condición, nada más
 * ════════════════════════════════════════════════════════════════ */

describe('M2A.2 punto 6: sin afirmaciones tarifarias', () => {
  it('CRITERIO: ninguna alarma menciona penalización ni factura', () => {
    for (const scenario of ['NORMAL', 'PHASE_LOSS', 'UNDERVOLTAGE', 'LOW_POWER_FACTOR', 'HIGH_LOAD', 'PHASE_IMBALANCE'] as const) {
      for (const a of evaluateAlarms(sampleTelemetry(T0, { scenario }), DEMO_THRESHOLDS)) {
        const m = a.message.toLowerCase();
        expect(m, a.code).not.toContain('penaliza');
        expect(m, a.code).not.toContain('factura');
        expect(m, a.code).not.toContain('tarif');
      }
    }
  });

  it('la alarma de factor de potencia describe el valor y su umbral', () => {
    const a = evaluateAlarms(
      sampleTelemetry(T0, { scenario: 'LOW_POWER_FACTOR' }),
      DEMO_THRESHOLDS,
    ).find((x) => x.code === 'LOW_POWER_FACTOR')!;
    expect(a.message).toContain('Factor de potencia');
    expect(a.message).toContain(String(DEMO_THRESHOLDS.powerFactor.criticalBelow));
    expect(a.threshold).toBe(DEMO_THRESHOLDS.powerFactor.criticalBelow);
  });
});
