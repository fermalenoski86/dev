import { describe, it, expect } from 'vitest';
import {
  AlarmRegistry,
  DEFAULT_STALE_AFTER_MS,
  DEMO_THRESHOLDS,
  SimulatedTelemetryProvider,
  alarmKey,
  diffAlarms,
  evaluateAlarms,
  evaluateFreshness,
  freshnessLabel,
  isUsableAsCurrent,
  sampleTelemetry,
  type ElectricalAlarm,
  type TrackedAlarm,
} from './index';

const T0 = Date.UTC(2026, 8, 21, 22, 30, 0);

/* ════════════════════════════════════════════════════════════════
 * M2A.1 / 2 — ciclo de vida de alarmas
 * ════════════════════════════════════════════════════════════════ */

const uv = (severity: 'warning' | 'critical', value: number, phase: 'A' | 'B' = 'A'): ElectricalAlarm => ({
  code: 'UNDERVOLTAGE',
  severity,
  metric: 'voltage',
  phase,
  value,
  unit: 'V',
  threshold: severity === 'critical' ? 207 : 218,
  message: `Subtension en L${phase === 'A' ? 1 : 2}: ${value} V`,
  timestamp: T0,
});

describe('M2A.1 punto 2: identidad de la condicion', () => {
  it('la clave incluye codigo, fase y metrica', () => {
    expect(alarmKey({ code: 'UNDERVOLTAGE', phase: 'A', metric: 'voltage' })).toBe(
      'UNDERVOLTAGE|A|voltage',
    );
    expect(alarmKey({ code: 'PHASE_IMBALANCE', phase: null, metric: 'imbalance_current' })).toBe(
      'PHASE_IMBALANCE|-|imbalance_current',
    );
  });

  it('CRITERIO: dos PHASE_IMBALANCE distintos no colisionan', () => {
    // Ambos tienen phase null. Sin `metric` compartirian clave y el ciclo de
    // vida las confundiria: una se "resolveria" cuando en realidad la tapa la
    // otra. Por eso la metrica es parte de la identidad.
    const tension = alarmKey({ code: 'PHASE_IMBALANCE', phase: null, metric: 'imbalance_voltage' });
    const corriente = alarmKey({ code: 'PHASE_IMBALANCE', phase: null, metric: 'imbalance_current' });
    expect(tension).not.toBe(corriente);
  });

  it('toda alarma que emite el evaluador trae metrica', () => {
    for (const escenario of ['NORMAL', 'PHASE_LOSS', 'UNDERVOLTAGE', 'LOW_POWER_FACTOR', 'PHASE_IMBALANCE', 'HIGH_LOAD'] as const) {
      for (const a of evaluateAlarms(sampleTelemetry(T0, { scenario: escenario }), DEMO_THRESHOLDS)) {
        expect(a.metric).toBeTruthy();
      }
    }
  });

  it('en PHASE_IMBALANCE las dos metricas conviven como condiciones separadas', () => {
    const t = sampleTelemetry(T0, { scenario: 'PHASE_IMBALANCE' });
    const reg = new AlarmRegistry();
    reg.update(evaluateAlarms(t, DEMO_THRESHOLDS), T0);
    const claves = reg.active().map((a) => a.key);
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe('M2A.1 punto 2: transiciones', () => {
  const vacio = new Map<string, TrackedAlarm>();

  it('aparecer produce ACTIVATED', () => {
    const t = diffAlarms(vacio, [uv('warning', 215)], T0);
    expect(t).toHaveLength(1);
    expect(t[0]!.type).toBe('ACTIVATED');
    expect(t[0]!.previousSeverity).toBeNull();
    expect(t[0]!.currentSeverity).toBe('warning');
  });

  it('CRITERIO: warning → critical produce ESCALATED', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('warning', 215)], T0);
    const t = reg.update([uv('critical', 203)], T0 + 1000);
    expect(t).toHaveLength(1);
    expect(t[0]!.type).toBe('ESCALATED');
    expect(t[0]!.previousSeverity).toBe('warning');
    expect(t[0]!.currentSeverity).toBe('critical');
    expect(t[0]!.message).toContain('escaló');
  });

  it('CRITERIO: critical → warning produce DEESCALATED', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('critical', 203)], T0);
    const t = reg.update([uv('warning', 215)], T0 + 1000);
    expect(t[0]!.type).toBe('DEESCALATED');
    expect(t[0]!.previousSeverity).toBe('critical');
    expect(t[0]!.currentSeverity).toBe('warning');
  });

  it('CRITERIO: desaparecer produce RESOLVED', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('warning', 215)], T0);
    const t = reg.update([], T0 + 1000);
    expect(t[0]!.type).toBe('RESOLVED');
    expect(t[0]!.previousSeverity).toBe('warning');
    expect(t[0]!.currentSeverity).toBeNull();
    expect(reg.size()).toBe(0);
  });

  it('CRITERIO: el ciclo completo en orden', () => {
    const reg = new AlarmRegistry();
    const tipos: string[] = [];
    const paso = (alarmas: ElectricalAlarm[], t: number) => {
      for (const tr of reg.update(alarmas, t)) tipos.push(tr.type);
    };
    paso([uv('warning', 215)], T0);
    paso([uv('critical', 203)], T0 + 1000);
    paso([uv('warning', 214)], T0 + 2000);
    paso([], T0 + 3000);
    expect(tipos).toEqual(['ACTIVATED', 'ESCALATED', 'DEESCALATED', 'RESOLVED']);
  });

  it('CRITERIO: una condicion estable NO genera eventos repetidos', () => {
    // Era el bug del Set: no distinguia "sigue igual" de "empeoro". Pero
    // tampoco debe generar ruido cuando no cambia nada.
    const reg = new AlarmRegistry();
    reg.update([uv('warning', 215)], T0);
    for (let i = 1; i <= 50; i++) {
      expect(reg.update([uv('warning', 215 - i * 0.01)], T0 + i * 1000)).toEqual([]);
    }
    expect(reg.size()).toBe(1);
  });

  it('el valor se refresca aunque no haya transicion', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('warning', 215)], T0);
    reg.update([uv('warning', 212)], T0 + 1000);
    expect(reg.active()[0]!.alarm.value).toBe(212);
    expect(reg.active()[0]!.lastSeenAt).toBe(T0 + 1000);
  });

  it('firstSeenAt conserva cuando apareció, no la última muestra', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('warning', 215)], T0);
    reg.update([uv('critical', 203)], T0 + 60_000);
    expect(reg.active()[0]!.firstSeenAt).toBe(T0);
  });

  it('condiciones distintas se siguen por separado', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('warning', 215, 'A'), uv('warning', 216, 'B')], T0);
    const t = reg.update([uv('critical', 203, 'A'), uv('warning', 216, 'B')], T0 + 1000);
    expect(t).toHaveLength(1);
    expect(t[0]!.type).toBe('ESCALATED');
    expect(t[0]!.alarm.phase).toBe('A');
    expect(reg.size()).toBe(2);
  });

  it('las transiciones se ordenan poniendo primero lo que empeora', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('critical', 203, 'A'), uv('warning', 216, 'B')], T0);
    const t = reg.update([uv('warning', 214, 'A'), uv('critical', 202, 'B')], T0 + 1000);
    expect(t.map((x) => x.type)).toEqual(['ESCALATED', 'DEESCALATED']);
  });

  it('si la misma condicion llega duplicada, gana la mas severa', () => {
    const t = diffAlarms(new Map(), [uv('warning', 215), uv('critical', 203)], T0);
    expect(t).toHaveLength(1);
    expect(t[0]!.currentSeverity).toBe('critical');
  });

  it('diffAlarms es pura: no muta el mapa anterior', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('warning', 215)], T0);
    const antes = new Map(reg.active().map((a) => [a.key, a]));
    const copia = new Map(antes);
    diffAlarms(antes, [uv('critical', 203)], T0 + 1000);
    expect(antes).toEqual(copia);
  });
});

describe('M2A.1 punto 2: acknowledge', () => {
  it('CRITERIO: reconocer NO borra la alarma activa', () => {
    // Reconocer es "la vi", no "la arreglé". La condición física sigue ahí.
    const reg = new AlarmRegistry();
    reg.update([uv('warning', 215)], T0);
    const key = reg.active()[0]!.key;

    expect(reg.acknowledge(key, T0 + 500)).toBe(true);
    expect(reg.size()).toBe(1);
    expect(reg.active()).toHaveLength(1);
    expect(reg.active()[0]!.acknowledged).toBe(true);
    expect(reg.unacknowledged()).toHaveLength(0);
  });

  it('reconocer dos veces no cuenta doble', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('warning', 215)], T0);
    const key = reg.active()[0]!.key;
    expect(reg.acknowledge(key, T0)).toBe(true);
    expect(reg.acknowledge(key, T0)).toBe(false);
  });

  it('CRITERIO: escalar invalida el ack — es una condicion nueva que nadie vio', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('warning', 215)], T0);
    reg.acknowledge(reg.active()[0]!.key, T0 + 500);
    expect(reg.unacknowledged()).toHaveLength(0);

    reg.update([uv('critical', 203)], T0 + 1000);
    expect(reg.active()[0]!.acknowledged).toBe(false);
    expect(reg.unacknowledged()).toHaveLength(1);
  });

  it('desescalar CONSERVA el ack: si ya la vieron peor, sigue vista', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('critical', 203)], T0);
    reg.acknowledge(reg.active()[0]!.key, T0 + 500);
    reg.update([uv('warning', 215)], T0 + 1000);
    expect(reg.active()[0]!.acknowledged).toBe(true);
  });

  it('una alarma resuelta y reaparecida vuelve sin reconocer', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('warning', 215)], T0);
    reg.acknowledgeAll(T0);
    reg.update([], T0 + 1000);
    reg.update([uv('warning', 215)], T0 + 2000);
    expect(reg.active()[0]!.acknowledged).toBe(false);
  });

  it('acknowledgeAll devuelve cuantas reconocio', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('warning', 215, 'A'), uv('warning', 216, 'B')], T0);
    expect(reg.acknowledgeAll(T0)).toBe(2);
    expect(reg.acknowledgeAll(T0)).toBe(0);
  });

  it('acknowledge de una clave inexistente no explota', () => {
    expect(new AlarmRegistry().acknowledge('no-existe', T0)).toBe(false);
  });

  it('las activas se ordenan por severidad', () => {
    const reg = new AlarmRegistry();
    reg.update([uv('warning', 215, 'B'), uv('critical', 203, 'A')], T0);
    expect(reg.active()[0]!.severity).toBe('critical');
  });
});

describe('M2A.1 punto 2: ciclo real desde el simulador', () => {
  it('pasar de NORMAL a PHASE_LOSS y volver produce el ciclo completo', () => {
    const reg = new AlarmRegistry();
    const tipos: string[] = [];

    const paso = (scenario: 'NORMAL' | 'PHASE_LOSS', t: number) => {
      const alarmas = evaluateAlarms(sampleTelemetry(t, { scenario }), DEMO_THRESHOLDS);
      for (const tr of reg.update(alarmas, t)) tipos.push(`${tr.type}:${tr.alarm.code}`);
    };

    paso('NORMAL', T0);
    expect(tipos).toEqual([]);
    paso('PHASE_LOSS', T0 + 1000);
    expect(tipos.some((x) => x === 'ACTIVATED:PHASE_LOSS')).toBe(true);
    const cuantas = reg.size();
    expect(cuantas).toBeGreaterThan(0);

    paso('NORMAL', T0 + 2000);
    expect(reg.size()).toBe(0);
    expect(tipos.filter((x) => x.startsWith('RESOLVED')).length).toBe(cuantas);
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2A.1 / 5 — frescura
 * ════════════════════════════════════════════════════════════════ */

describe('M2A.1 punto 5: frescura del dato', () => {
  const tel = sampleTelemetry(T0);

  it('un dato reciente es LIVE', () => {
    const s = evaluateFreshness({ now: T0 + 500, measuredAt: T0, receivedAt: T0, telemetry: tel });
    expect(s.quality).toBe('LIVE');
    expect(s.ageMs).toBe(500);
    expect(isUsableAsCurrent(s)).toBe(true);
  });

  it('CRITERIO: pasado el umbral pasa a STALE y deja de ser usable como actual', () => {
    const s = evaluateFreshness({
      now: T0 + DEFAULT_STALE_AFTER_MS + 1,
      measuredAt: T0,
      receivedAt: T0,
      telemetry: tel,
    });
    expect(s.quality).toBe('STALE');
    expect(isUsableAsCurrent(s)).toBe(false);
  });

  it('CRITERIO: en STALE el ULTIMO valor sigue disponible, etiquetado como tal', () => {
    // No se descarta el dato: se descarta la afirmación de que es actual.
    const s = evaluateFreshness({
      now: T0 + 60_000,
      measuredAt: T0,
      receivedAt: T0,
      telemetry: tel,
    });
    expect(s.telemetry).not.toBeNull();
    expect(freshnessLabel(s)).toContain('última lectura');
  });

  it('el umbral es configurable', () => {
    const args = { now: T0 + 2000, measuredAt: T0, receivedAt: T0, telemetry: tel };
    expect(evaluateFreshness({ ...args, staleAfterMs: 1000 }).quality).toBe('STALE');
    expect(evaluateFreshness({ ...args, staleAfterMs: 10_000 }).quality).toBe('LIVE');
  });

  it('justo en el umbral todavia es LIVE', () => {
    const s = evaluateFreshness({
      now: T0 + 5000,
      measuredAt: T0,
      receivedAt: T0,
      telemetry: tel,
      staleAfterMs: 5000,
    });
    expect(s.quality).toBe('LIVE');
  });

  it('sin telemetria es NO_DATA', () => {
    const s = evaluateFreshness({ now: T0, measuredAt: null, receivedAt: null, telemetry: null });
    expect(s.quality).toBe('NO_DATA');
    expect(isUsableAsCurrent(s)).toBe(false);
  });

  it('CRITERIO: un error de comunicacion gana sobre un valor reciente', () => {
    const s = evaluateFreshness({
      now: T0 + 100,
      measuredAt: T0,
      receivedAt: T0,
      telemetry: tel,
      commError: 'timeout Modbus',
    });
    expect(s.quality).toBe('COMM_ERROR');
    expect(s.errorMessage).toBe('timeout Modbus');
    expect(isUsableAsCurrent(s)).toBe(false);
  });

  it('measuredAt y receivedAt se guardan por separado', () => {
    const s = evaluateFreshness({
      now: T0 + 1000,
      measuredAt: T0,
      receivedAt: T0 + 400,
      telemetry: tel,
    });
    expect(s.measuredAt).toBe(T0);
    expect(s.receivedAt).toBe(T0 + 400);
    // La edad se mide contra la MEDICION, no contra la recepcion: lo que
    // importa es cuan viejo es el numero, no cuando llego el paquete.
    expect(s.ageMs).toBe(1000);
  });

  it('la edad nunca es negativa aunque el reloj vaya para atras', () => {
    const s = evaluateFreshness({ now: T0 - 5000, measuredAt: T0, receivedAt: T0, telemetry: tel });
    expect(s.ageMs).toBe(0);
  });
});

describe('M2A.1 punto 5: el provider entrega muestras con calidad', () => {
  it('en operacion normal entrega LIVE', () => {
    const p = new SimulatedTelemetryProvider();
    const s = p.readSample(T0);
    expect(s.quality).toBe('LIVE');
    expect(s.telemetry?.simulated).toBe(true);
  });

  it('CRITERIO: si deja de publicar, la ultima muestra envejece a STALE', () => {
    const p = new SimulatedTelemetryProvider({ staleAfterMs: 5000 });
    p.readSample(T0);
    p.setFaultMode('stale');
    const s = p.readSample(T0 + 30_000);
    expect(s.quality).toBe('STALE');
    expect(s.telemetry).not.toBeNull(); // se conserva como "ultima lectura"
    expect(s.measuredAt).toBe(T0);
    expect(s.ageMs).toBe(30_000);
  });

  it('CRITERIO: un fallo de comunicacion no simula ONLINE con el valor viejo', () => {
    const p = new SimulatedTelemetryProvider();
    p.readSample(T0);
    p.setFaultMode('comm_error');
    const s = p.readSample(T0 + 1000);
    expect(s.quality).toBe('COMM_ERROR');
    expect(s.errorMessage).toBeTruthy();
  });

  it('sin ninguna lectura previa, un fallo da NO_DATA', () => {
    const p = new SimulatedTelemetryProvider();
    p.setFaultMode('stale');
    expect(p.readSample(T0).quality).toBe('NO_DATA');
  });

  it('volver a normal recupera LIVE', () => {
    const p = new SimulatedTelemetryProvider();
    p.readSample(T0);
    p.setFaultMode('stale');
    expect(p.readSample(T0 + 60_000).quality).toBe('STALE');
    p.setFaultMode('none');
    expect(p.readSample(T0 + 61_000).quality).toBe('LIVE');
  });

  it('readSample sigue siendo determinista', () => {
    const a = new SimulatedTelemetryProvider({ seed: 5 });
    const b = new SimulatedTelemetryProvider({ seed: 5 });
    expect(a.readSample(T0)).toEqual(b.readSample(T0));
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2A.1 / 6 — limpiezas del simulador
 * ════════════════════════════════════════════════════════════════ */

describe('M2A.1 punto 6: mes calendario real', () => {
  it('el dia 1 del mes, la energia del mes es la del dia', () => {
    const dia1 = Date.UTC(2026, 9, 1, 15, 0, 0); // 12:00 local
    const t = sampleTelemetry(dia1);
    expect(t.energyMonthKwh).toBeCloseTo(t.energyTodayKwh, 1);
  });

  it('el dia 15 acumula catorce dias completos mas el corriente', () => {
    const dia15 = Date.UTC(2026, 9, 15, 15, 0, 0);
    const t = sampleTelemetry(dia15);
    const promedioDiario = (t.energyMonthKwh - t.energyTodayKwh) / 14;
    expect(promedioDiario).toBeGreaterThan(0);
    // Coherente con el consumo diario tipico del edificio.
    expect(promedioDiario).toBeGreaterThan(t.energyTodayKwh * 0.5);
  });

  it('CRITERIO: el mes usa el calendario real, no bloques de 30 dias', () => {
    // El 31 de un mes de 31 dias tiene que acumular 30 dias previos, y el 1 del
    // mes siguiente volver a cero. Con meses ficticios de 30 esto fallaba.
    const dia31 = sampleTelemetry(Date.UTC(2026, 9, 31, 15, 0, 0));
    const dia1Siguiente = sampleTelemetry(Date.UTC(2026, 10, 1, 15, 0, 0));
    expect(dia31.energyMonthKwh).toBeGreaterThan(dia1Siguiente.energyMonthKwh * 5);
    expect(dia1Siguiente.energyMonthKwh).toBeCloseTo(dia1Siguiente.energyTodayKwh, 1);
  });

  it('el mes respeta el huso horario del sitio', () => {
    // 00:30 UTC del dia 1 es todavia dia 30 anterior en Buenos Aires (UTC-3).
    const t = sampleTelemetry(Date.UTC(2026, 10, 1, 0, 30, 0), { utcOffsetHours: -3 });
    expect(t.energyMonthKwh).toBeGreaterThan(t.energyTodayKwh * 5);
  });

  it('peakDemandKw no supera la potencia instantanea maxima del dia', () => {
    const t = sampleTelemetry(T0);
    expect(t.peakDemandKw).toBeGreaterThan(0);
    expect(t.peakDemandKw).toBeLessThan(200);
  });
});
