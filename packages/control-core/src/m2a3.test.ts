import { describe, it, expect } from 'vitest';
import {
  AlarmRegistry,
  DEMO_INSTALLATION,
  DEMO_THRESHOLDS,
  SimulatedTelemetryProvider,
  evaluateAlarms,
  evaluateFreshness,
  resolveSeriesWindow,
  sampleTelemetry,
  withAlarms,
} from '@trust/telemetry';
import {
  ALARM_ACKNOWLEDGED,
  EventLog,
  acknowledgeAlarm,
  acknowledgeAll,
  isAckConsistent,
  logAlarmTransitions,
} from './index';

const T0 = Date.UTC(2026, 8, 21, 22, 30, 0);

/* ════════════════════════════════════════════════════════════════
 * M2A.3 / 1 — ACK end to end con el MISMO logger que produccion
 * ════════════════════════════════════════════════════════════════ */

/**
 * Replica el ciclo del store: provider → evaluateAlarms → registry.update →
 * logAlarmTransitions. Ni una linea del logger se reescribe aca: si el evento
 * saliera sin `metadata.key`, estos tests fallarian igual que la aplicacion.
 */
function cicloDelStore(scenario: string, at = T0) {
  const provider = new SimulatedTelemetryProvider({ scenario: scenario as never });
  const registry = new AlarmRegistry();
  const log = new EventLog();

  const tick = (tMs: number) => {
    const sample = provider.readSample(tMs);
    const evaluadas = sample.telemetry
      ? evaluateAlarms(sample.telemetry, DEMO_THRESHOLDS, DEMO_INSTALLATION)
      : [];
    const emitidos = logAlarmTransitions(log, registry.update(evaluadas, tMs));
    return { sample, evaluadas, emitidos };
  };

  const primero = tick(at);
  return { provider, registry, log, tick, ...primero };
}

describe('M2A.3 punto 1: el ACK funciona con el logger de produccion', () => {
  it('CRITERIO: el logger real guarda metadata.key', () => {
    // La causa raiz: el store escribia el evento inline sin `key`, y
    // acknowledgeAlarm busca por `e.metadata.key === key`. El ACK andaba en
    // los tests (que ponian la key a mano) y no en la aplicacion.
    const { log, registry } = cicloDelStore('UNDERVOLTAGE');
    const claves = registry.active().map((a) => a.key);
    expect(claves.length).toBeGreaterThan(0);

    for (const e of log.list('ENERGY')) {
      expect(e.metadata.key, e.message).toBeTruthy();
      expect(claves).toContain(e.metadata.key);
    }
  });

  it('el evento incluye los siete campos ademas de la key', () => {
    const { log } = cicloDelStore('UNDERVOLTAGE');
    const e = log.list('ENERGY')[0]!;
    for (const campo of ['transition', 'key', 'code', 'metric', 'phase', 'value', 'threshold', 'simulated']) {
      expect(Object.keys(e.metadata), campo).toContain(campo);
    }
  });

  it('CRITERIO: flujo completo — la alarma queda reconocida', () => {
    const { registry, log } = cicloDelStore('UNDERVOLTAGE');
    const key = registry.unacknowledged()[0]!.key;

    const r = acknowledgeAlarm(key, { registry, log, now: T0 + 1000, actor: 'fer' });

    expect(r.acknowledgedAlarms).toHaveLength(1);
    expect(registry.get(key)!.acknowledged).toBe(true);
  });

  it('CRITERIO: el evento ORIGINAL queda reconocido', () => {
    const { registry, log } = cicloDelStore('UNDERVOLTAGE');
    const key = registry.unacknowledged()[0]!.key;
    const original = log.list('ENERGY').find((e) => e.metadata.key === key)!;
    expect(original.acknowledged).toBe(false);

    const r = acknowledgeAlarm(key, { registry, log, now: T0 + 1000 });

    expect(r.acknowledgedEvents).toBeGreaterThan(0);
    const despues = log.list('ENERGY').find((e) => e.id === original.id)!;
    expect(despues.acknowledged).toBe(true);
  });

  it('CRITERIO: el contador del header baja', () => {
    const { registry, log } = cicloDelStore('UNDERVOLTAGE');
    const antes = log.unacknowledged().length;
    expect(antes).toBeGreaterThan(0);

    acknowledgeAlarm(registry.unacknowledged()[0]!.key, { registry, log, now: T0 + 1000 });

    expect(log.unacknowledged().length).toBeLessThan(antes);
  });

  it('CRITERIO: la alarma sigue ACTIVA hasta que se resuelve', () => {
    const { registry, log, provider, tick } = cicloDelStore('UNDERVOLTAGE');
    const key = registry.unacknowledged()[0]!.key;

    acknowledgeAlarm(key, { registry, log, now: T0 + 1000 });
    expect(registry.active().some((a) => a.key === key)).toBe(true);

    // Sigue activa varios ticks mas: reconocer no es resolver.
    tick(T0 + 2000);
    tick(T0 + 3000);
    expect(registry.active().some((a) => a.key === key)).toBe(true);
    expect(registry.get(key)!.acknowledged).toBe(true);

    // Recien cuando la condicion fisica desaparece, se resuelve.
    provider.setScenario('NORMAL');
    tick(T0 + 4000);
    expect(registry.get(key)).toBeUndefined();
    expect(
      log.list('ENERGY').some((e) => e.metadata.transition === 'RESOLVED' && e.metadata.key === key),
    ).toBe(true);
  });

  it('CRITERIO: queda registrado ALARM_ACKNOWLEDGED', () => {
    const { registry, log } = cicloDelStore('UNDERVOLTAGE');
    const key = registry.unacknowledged()[0]!.key;
    acknowledgeAlarm(key, { registry, log, now: T0 + 1000, actor: 'fer' });

    const ack = log
      .list('ENERGY')
      .find((e) => e.metadata.transition === ALARM_ACKNOWLEDGED && e.metadata.key === key);
    expect(ack).toBeDefined();
    expect(ack!.source).toBe('fer');
    expect(ack!.acknowledged).toBe(true);
  });

  it('ACK ALL sobre el flujo real no deja nada pendiente', () => {
    const { registry, log } = cicloDelStore('PHASE_LOSS');
    expect(registry.unacknowledged().length).toBeGreaterThan(0);
    expect(log.unacknowledged().length).toBeGreaterThan(0);

    acknowledgeAll({ registry, log, now: T0 + 1000 });

    expect(isAckConsistent(registry, log)).toBe(true);
    expect(registry.active().length).toBeGreaterThan(0); // siguen activas
  });

  it('reconocer una condicion no reconoce las otras', () => {
    const { registry, log } = cicloDelStore('PHASE_LOSS');
    const pendientes = registry.unacknowledged();
    expect(pendientes.length).toBeGreaterThan(1);

    acknowledgeAlarm(pendientes[0]!.key, { registry, log, now: T0 + 1000 });

    expect(registry.unacknowledged()).toHaveLength(pendientes.length - 1);
    const otra = pendientes[1]!.key;
    expect(log.list('ENERGY').some((e) => e.metadata.key === otra && !e.acknowledged)).toBe(true);
  });

  it('una condicion que escala vuelve a quedar pendiente en ambos lados', () => {
    const { registry, log, provider, tick } = cicloDelStore('UNDERVOLTAGE');
    acknowledgeAll({ registry, log, now: T0 + 1000 });
    expect(isAckConsistent(registry, log)).toBe(true);

    // PHASE_LOSS lleva L3 a critico: aparecen condiciones nuevas.
    provider.setScenario('PHASE_LOSS');
    tick(T0 + 2000);

    expect(isAckConsistent(registry, log)).toBe(false);
    expect(registry.unacknowledged().length).toBeGreaterThan(0);
  });

  it('sin alarmas no se escribe nada en el log', () => {
    const { log } = cicloDelStore('NORMAL');
    expect(log.list('ENERGY')).toHaveLength(0);
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2A.3 / 2 — la serie nunca pasa de measuredAt
 * ════════════════════════════════════════════════════════════════ */

describe('M2A.3 punto 2: la ventana termina en measuredAt, tambien con LIVE', () => {
  const RANGO = 3_600_000;
  const tel = withAlarms(sampleTelemetry(T0)).telemetry;

  const muestra = (now: number, staleAfterMs = 5000) =>
    evaluateFreshness({ now, measuredAt: T0, receivedAt: T0, telemetry: tel, staleAfterMs });

  it('CRITERIO: LIVE con 4 s de antiguedad corta en measuredAt, no en now', () => {
    const now = T0 + 4000;
    const sample = muestra(now);
    expect(sample.quality).toBe('LIVE'); // dentro de la tolerancia de 5 s

    const w = resolveSeriesWindow(now, RANGO, sample);

    expect(w.toMs).toBe(T0);
    expect(w.toMs).not.toBe(now);
    expect(w.gap).toEqual({ fromMs: T0, toMs: now });
    expect(w.empty).toBe(false);
  });

  it('la tolerancia define frescura, no autoriza a inventar mediciones', () => {
    // Mismo instante, distinta tolerancia: cambia la CALIDAD, nunca el corte.
    const now = T0 + 4000;
    for (const staleAfterMs of [1000, 5000, 60_000]) {
      const sample = muestra(now, staleAfterMs);
      const w = resolveSeriesWindow(now, RANGO, sample);
      expect(w.toMs, `stale=${staleAfterMs}`).toBe(T0);
    }
    expect(muestra(now, 1000).quality).toBe('STALE');
    expect(muestra(now, 60_000).quality).toBe('LIVE');
  });

  it('solo hay gap nulo si la medicion es de este mismo instante', () => {
    const w = resolveSeriesWindow(T0, RANGO, muestra(T0));
    expect(w.toMs).toBe(T0);
    expect(w.gap).toBeNull();
    expect(w.gapFraction).toBe(0);
  });

  it('el gap crece con la antiguedad, sin saltos al cruzar el umbral', () => {
    const anteriores: number[] = [];
    for (const edad of [0, 500, 4000, 4999, 5000, 5001, 30_000]) {
      const now = T0 + edad;
      const w = resolveSeriesWindow(now, RANGO, muestra(now));
      expect(w.toMs).toBe(T0);
      expect(w.gapFraction).toBeCloseTo(edad / RANGO, 9);
      anteriores.push(w.gapFraction);
    }
    // Monotono: cruzar de LIVE a STALE no produce un salto en el grafico.
    for (let i = 1; i < anteriores.length; i++) {
      expect(anteriores[i]!).toBeGreaterThanOrEqual(anteriores[i - 1]!);
    }
  });

  it('la ventana graficada y el hueco nunca se solapan, en ninguna calidad', () => {
    for (const edad of [0, 100, 4000, 10_000, 600_000]) {
      const now = T0 + edad;
      const w = resolveSeriesWindow(now, RANGO, muestra(now));
      expect(w.toMs).toBeLessThanOrEqual(now);
      if (w.gap) {
        expect(w.gap.fromMs).toBe(w.toMs);
        expect(w.gap.toMs).toBe(now);
      }
    }
  });

  it('con el provider real, cada muestra corta en su propio measuredAt', () => {
    const provider = new SimulatedTelemetryProvider();
    for (const t of [T0, T0 + 1000, T0 + 7000]) {
      const sample = provider.readSample(t);
      // Se consulta la ventana un rato despues de medir, como hace la UI.
      const w = resolveSeriesWindow(t + 900, RANGO, sample);
      expect(w.toMs).toBe(sample.measuredAt);
      expect(w.gap).toEqual({ fromMs: t, toMs: t + 900 });
    }
  });
});
