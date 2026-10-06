import { describe, it, expect } from 'vitest';
import {
  DEMO_INSTALLATION,
  DEMO_THRESHOLDS,
  ElectricalTelemetrySchema,
  ModbusTelemetryProvider,
  PHASES,
  SimulatedTelemetryProvider,
  TELEMETRY_SCENARIOS,
  dailyLoadFactor,
  evaluateAlarms,
  imbalancePercent,
  integrateEnergy,
  parseElectricalTelemetry,
  phaseLoadPercent,
  phaseOf,
  sampleSeries,
  sampleTelemetry,
  statusFromAlarms,
  withAlarms,
} from './index';

const T0 = Date.UTC(2026, 8, 21, 22, 30, 0); // 19:30 local (UTC-3): prime time

describe('determinismo del simulador', () => {
  it('CRITERIO: misma (seed, escenario, t) da exactamente lo mismo', () => {
    for (const t of [T0, T0 + 1, T0 + 37_000, T0 + 3_600_000]) {
      expect(sampleTelemetry(t)).toEqual(sampleTelemetry(t));
    }
  });

  it('dos providers distintos con la misma seed coinciden', () => {
    const a = new SimulatedTelemetryProvider({ seed: 7 });
    const b = new SimulatedTelemetryProvider({ seed: 7 });
    expect(a.read(T0)).toEqual(b.read(T0));
  });

  it('seeds distintas dan señales distintas', () => {
    const a = sampleTelemetry(T0, { seed: 1 });
    const b = sampleTelemetry(T0, { seed: 2 });
    expect(a.phaseA.currentA).not.toBe(b.phaseA.currentA);
  });

  it('el orden de consulta no altera el resultado (sin estado acumulado)', () => {
    const adelante = [0, 1000, 2000, 3000].map((d) => sampleTelemetry(T0 + d).activePowerKw);
    const atras = [3000, 2000, 1000, 0].map((d) => sampleTelemetry(T0 + d).activePowerKw).reverse();
    expect(atras).toEqual(adelante);
  });

  it('CRITERIO: la serie histórica coincide con la lectura en vivo en cada punto', () => {
    // Si esto falla, el gráfico contradice al indicador grande y el panel miente.
    const from = T0 - 3_600_000;
    const series = sampleSeries(from, T0, 13);
    const step = (T0 - from) / 12;
    series.forEach((punto, i) => {
      expect(punto).toEqual(sampleTelemetry(from + i * step));
    });
  });

  it('la señal es continua: no salta entre muestras contiguas', () => {
    let previa = sampleTelemetry(T0);
    for (let i = 1; i <= 60; i++) {
      const actual = sampleTelemetry(T0 + i * 1000);
      expect(Math.abs(actual.phaseA.currentA - previa.phaseA.currentA)).toBeLessThan(4);
      previa = actual;
    }
  });
});

describe('plausibilidad física', () => {
  it('toda muestra pasa el schema', () => {
    for (const scenario of TELEMETRY_SCENARIOS) {
      for (let h = 0; h < 24; h += 3) {
        expect(() =>
          parseElectricalTelemetry(sampleTelemetry(T0 + h * 3_600_000, { scenario })),
        ).not.toThrow();
      }
    }
  });

  it('en NORMAL la tensión ronda los 230 V y la frecuencia los 50 Hz', () => {
    for (let h = 0; h < 24; h += 1) {
      const t = sampleTelemetry(T0 + h * 3_600_000);
      for (const id of PHASES) {
        expect(phaseOf(t, id).voltageV).toBeGreaterThan(220);
        expect(phaseOf(t, id).voltageV).toBeLessThan(240);
      }
      expect(t.frequencyHz).toBeGreaterThan(49.8);
      expect(t.frequencyHz).toBeLessThan(50.2);
    }
  });

  it('en NORMAL el factor de potencia queda entre 0.92 y 0.99', () => {
    for (let i = 0; i < 40; i++) {
      const pf = sampleTelemetry(T0 + i * 97_000).powerFactor;
      expect(pf).toBeGreaterThanOrEqual(0.92);
      expect(pf).toBeLessThanOrEqual(0.99);
    }
  });

  it('la potencia activa es la suma de las tres fases', () => {
    const t = sampleTelemetry(T0);
    const suma = t.phaseA.activePowerKw + t.phaseB.activePowerKw + t.phaseC.activePowerKw;
    expect(t.activePowerKw).toBeCloseTo(suma, 2);
  });

  it('S >= P y el triángulo de potencias cierra', () => {
    const t = sampleTelemetry(T0);
    expect(t.apparentPowerKva).toBeGreaterThanOrEqual(t.activePowerKw - 0.01);
    expect(t.activePowerKw ** 2 + t.reactivePowerKvar ** 2).toBeCloseTo(t.apparentPowerKva ** 2, 0);
  });

  it('el pico de demanda es nocturno: un edificio DOOH no consume como una oficina', () => {
    expect(dailyLoadFactor(21)).toBeGreaterThan(dailyLoadFactor(11));
    expect(dailyLoadFactor(21)).toBeGreaterThan(dailyLoadFactor(4));
    expect(dailyLoadFactor(4)).toBeLessThan(0.5);
  });

  it('la energía del día crece monótonamente', () => {
    const inicio = Date.UTC(2026, 8, 21, 6, 0, 0);
    let previa = -1;
    for (let h = 0; h < 12; h++) {
      const e = integrateEnergy(inicio + h * 3_600_000).today;
      expect(e).toBeGreaterThanOrEqual(previa);
      previa = e;
    }
  });

  it('la energía del mes nunca es menor que la del día', () => {
    const e = integrateEnergy(T0);
    expect(e.month).toBeGreaterThanOrEqual(e.today);
    expect(e.total).toBeGreaterThanOrEqual(e.month);
  });
});

describe('escenarios', () => {
  it('HIGH_LOAD consume más que NORMAL', () => {
    expect(sampleTelemetry(T0, { scenario: 'HIGH_LOAD' }).activePowerKw).toBeGreaterThan(
      sampleTelemetry(T0, { scenario: 'NORMAL' }).activePowerKw,
    );
  });

  it('PHASE_LOSS deja L3 sin tensión ni corriente', () => {
    const t = sampleTelemetry(T0, { scenario: 'PHASE_LOSS' });
    expect(t.phaseC.voltageV).toBeLessThan(DEMO_THRESHOLDS.voltage.phaseLossV);
    expect(t.phaseC.currentA).toBe(0);
    expect(t.phaseA.voltageV).toBeGreaterThan(200);
  });

  it('UNDERVOLTAGE baja las tres fases', () => {
    const t = sampleTelemetry(T0, { scenario: 'UNDERVOLTAGE' });
    for (const id of PHASES) expect(phaseOf(t, id).voltageV).toBeLessThan(DEMO_THRESHOLDS.voltage.underWarnV);
  });

  it('PHASE_IMBALANCE desbalancea corrientes sin tirar tensiones', () => {
    const t = sampleTelemetry(T0, { scenario: 'PHASE_IMBALANCE' });
    expect(t.currentImbalancePercent).toBeGreaterThan(DEMO_THRESHOLDS.imbalance.currentWarnPercent);
    expect(t.voltageImbalancePercent).toBeLessThan(5);
  });

  it('LOW_POWER_FACTOR baja el PF por debajo del umbral', () => {
    expect(sampleTelemetry(T0, { scenario: 'LOW_POWER_FACTOR' }).powerFactor).toBeLessThan(
      DEMO_THRESHOLDS.powerFactor.warnBelow,
    );
  });

  it('cambiar de escenario no rompe el determinismo del nuevo', () => {
    const p = new SimulatedTelemetryProvider();
    p.setScenario('HIGH_LOAD');
    expect(p.read(T0)).toEqual(p.read(T0));
    expect(p.read(T0)).toEqual(sampleTelemetry(T0, { scenario: 'HIGH_LOAD' }));
  });
});

describe('alarmas', () => {
  it('NORMAL no dispara alarmas en todo el día', () => {
    for (let h = 0; h < 24; h += 1) {
      const t = sampleTelemetry(T0 + h * 3_600_000);
      expect(evaluateAlarms(t)).toEqual([]);
    }
  });

  it('PHASE_LOSS sí escala a critical en withAlarms', () => {
    expect(withAlarms(sampleTelemetry(T0, { scenario: 'PHASE_LOSS' })).telemetry.status).toBe('critical');
  });

  it('PHASE_LOSS se reporta como pérdida de fase, NO como subtensión', () => {
    // Confundirlas manda al operador a buscar el problema donde no está.
    const alarms = evaluateAlarms(sampleTelemetry(T0, { scenario: 'PHASE_LOSS' }));
    const codes = alarms.map((a) => a.code);
    expect(codes).toContain('PHASE_LOSS');
    expect(alarms.filter((a) => a.code === 'UNDERVOLTAGE' && a.phase === 'C')).toHaveLength(0);
    expect(alarms.find((a) => a.code === 'PHASE_LOSS')!.severity).toBe('critical');
  });

  it('UNDERVOLTAGE dispara en las tres fases', () => {
    const alarms = evaluateAlarms(sampleTelemetry(T0, { scenario: 'UNDERVOLTAGE' }));
    expect(alarms.filter((a) => a.code === 'UNDERVOLTAGE')).toHaveLength(3);
  });

  it('LOW_POWER_FACTOR dispara y menciona la penalización', () => {
    const alarms = evaluateAlarms(sampleTelemetry(T0, { scenario: 'LOW_POWER_FACTOR' }));
    const pf = alarms.find((a) => a.code === 'LOW_POWER_FACTOR');
    expect(pf).toBeDefined();
    expect(pf!.message.toLowerCase()).toContain('factor de potencia');
  });

  it('PHASE_IMBALANCE dispara desequilibrio de corriente', () => {
    const codes = evaluateAlarms(sampleTelemetry(T0, { scenario: 'PHASE_IMBALANCE' })).map((a) => a.code);
    expect(codes).toContain('PHASE_IMBALANCE');
  });

  it('los umbrales son configurables, no constantes del código', () => {
    const t = sampleTelemetry(T0); // normal, sin alarmas
    expect(evaluateAlarms(t)).toEqual([]);
    // Rama critica configurable
    const criticoEstricto = { ...DEMO_THRESHOLDS, powerFactor: { warnBelow: 0.999, criticalBelow: 0.998 } };
    const critico = evaluateAlarms(t, criticoEstricto).find((a) => a.code === 'LOW_POWER_FACTOR');
    expect(critico?.severity).toBe('critical');

    // Rama de ADVERTENCIA configurable, por separado. Sin este caso, el umbral
    // de warning podria estar hardcodeado y ningun test se enteraria: lo
    // encontro el mutation check.
    const warnEstricto = { ...DEMO_THRESHOLDS, powerFactor: { warnBelow: 0.999, criticalBelow: 0.5 } };
    const aviso = evaluateAlarms(t, warnEstricto).find((a) => a.code === 'LOW_POWER_FACTOR');
    expect(aviso?.severity).toBe('warning');
    expect(aviso?.threshold).toBe(0.999);

    // Y aflojar el umbral tiene que apagar la alarma.
    const laxo = { ...DEMO_THRESHOLDS, powerFactor: { warnBelow: 0.1, criticalBelow: 0.05 } };
    expect(evaluateAlarms(t, laxo).map((a) => a.code)).not.toContain('LOW_POWER_FACTOR');
  });

  it('OVERCURRENT se mide contra la corriente nominal del tablero', () => {
    const t = sampleTelemetry(T0, { scenario: 'HIGH_LOAD' });
    const chico = { ...DEMO_INSTALLATION, ratedCurrentPerPhaseA: 20 };
    expect(evaluateAlarms(t, DEMO_THRESHOLDS, chico).map((a) => a.code)).toContain('OVERCURRENT');
  });

  it('statusFromAlarms toma la severidad máxima', () => {
    expect(statusFromAlarms([])).toBe('normal');
    expect(statusFromAlarms([{ severity: 'warning' } as never])).toBe('warning');
    expect(statusFromAlarms([{ severity: 'warning' } as never, { severity: 'critical' } as never])).toBe('critical');
  });

  it('withAlarms completa status y alarmCodes sin duplicar', () => {
    const { telemetry, alarms } = withAlarms(sampleTelemetry(T0, { scenario: 'UNDERVOLTAGE' }));
    // 210 V es -8,5 %: advertencia. Critico recien por debajo de 207 V (-10 %).
    expect(telemetry.status).toBe('warning');
    expect(telemetry.alarmCodes).toContain('UNDERVOLTAGE');
    expect(new Set(telemetry.alarmCodes).size).toBe(telemetry.alarmCodes.length);
    expect(alarms.length).toBeGreaterThanOrEqual(3);
  });

  it('el simulador NO decide alarmas: eso es del evaluador', () => {
    // Si el simulador marcara status, no se podría testear el evaluador.
    const crudo = sampleTelemetry(T0, { scenario: 'PHASE_LOSS' });
    expect(crudo.status).toBe('normal');
    expect(crudo.alarmCodes).toEqual([]);
  });
});

describe('contrato', () => {
  it('los campos de calidad de energía aceptan null', () => {
    const t = sampleTelemetry(T0);
    const sinThd = { ...t, thdVoltagePercent: null, thdCurrentPercent: null };
    expect(() => parseElectricalTelemetry(sinThd)).not.toThrow();
  });

  it('rechaza tensiones negativas', () => {
    const t = sampleTelemetry(T0);
    expect(() =>
      parseElectricalTelemetry({ ...t, phaseA: { ...t.phaseA, voltageV: -5 } }),
    ).toThrow();
  });

  it('toda muestra simulada lleva simulated: true', () => {
    for (const scenario of TELEMETRY_SCENARIOS) {
      expect(sampleTelemetry(T0, { scenario }).simulated).toBe(true);
    }
    expect(new SimulatedTelemetryProvider().simulated).toBe(true);
  });

  it('el campo simulated es obligatorio: no se puede omitir por olvido', () => {
    const t = sampleTelemetry(T0) as Record<string, unknown>;
    const sinFlag = { ...t };
    delete sinFlag.simulated;
    expect(ElectricalTelemetrySchema.safeParse(sinFlag).success).toBe(false);
  });

  it('el desequilibrio usa la definición NEMA', () => {
    expect(imbalancePercent([100, 100, 100])).toBe(0);
    // promedio 100, desvío máximo 10 → 10 %
    expect(imbalancePercent([110, 95, 95])).toBeCloseTo(10, 6);
  });

  it('phaseLoadPercent usa la corriente nominal del tablero', () => {
    const p = { voltageV: 230, currentA: 62.5, activePowerKw: 14, powerFactor: null, thdVoltagePercent: null, thdCurrentPercent: null };
    expect(phaseLoadPercent(p, DEMO_INSTALLATION)).toBeCloseTo(50, 6);
  });
});

describe('ModbusTelemetryProvider', () => {
  it('falla ruidosamente en vez de devolver datos inventados', () => {
    // Un provider "real" que calla y entrega ceros plausibles es la forma más
    // rápida de que alguien crea que el edificio está medido cuando no lo está.
    expect(() => new ModbusTelemetryProvider()).toThrow(/no está implementado/i);
  });
});
