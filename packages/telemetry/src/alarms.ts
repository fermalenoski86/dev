import { z } from 'zod';
import {
  DEMO_INSTALLATION,
  PHASES,
  phaseOf,
  type ElectricalTelemetry,
  type InstallationSpec,
  type PhaseId,
  type TelemetryStatus,
} from './contract';

/**
 * Alarmas eléctricas.
 *
 * ⚠️ Los umbrales de este archivo son **DEMO**, elegidos para que los
 * escenarios del simulador disparen algo visible. NO son valores de ingeniería.
 * Los definitivos salen del proyecto eléctrico y de la normativa aplicable, y
 * los firma alguien con matrícula — no un modelo de lenguaje.
 *
 * Por eso son configuración, no constantes en el código: cambiarlos no debe
 * requerir tocar lógica ni recompilar criterio.
 */

export const AlarmSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type AlarmSeverity = z.infer<typeof AlarmSeveritySchema>;

export const ELECTRICAL_ALARM_CODES = [
  'OVERVOLTAGE',
  'UNDERVOLTAGE',
  'OVERCURRENT',
  'PHASE_LOSS',
  'PHASE_IMBALANCE',
  'LOW_POWER_FACTOR',
  'HIGH_THD',
  'HIGH_DEMAND',
  'FREQUENCY_DEVIATION',
] as const;
export type ElectricalAlarmCode = (typeof ELECTRICAL_ALARM_CODES)[number];

export const ElectricalAlarmThresholdsSchema = z.object({
  /** ⚠️ DEMO. Sustituir por los valores del proyecto eléctrico. */
  demoValues: z.literal(true),

  voltage: z.object({
    overWarnV: z.number().positive(),
    overCriticalV: z.number().positive(),
    underWarnV: z.number().positive(),
    underCriticalV: z.number().positive(),
    /** Por debajo de esto se considera fase caída, no subtensión. */
    phaseLossV: z.number().positive(),
  }),
  current: z.object({
    warnPercentOfRated: z.number().positive(),
    criticalPercentOfRated: z.number().positive(),
  }),
  imbalance: z.object({
    voltageWarnPercent: z.number().positive(),
    voltageCriticalPercent: z.number().positive(),
    currentWarnPercent: z.number().positive(),
    currentCriticalPercent: z.number().positive(),
  }),
  powerFactor: z.object({
    warnBelow: z.number().positive(),
    criticalBelow: z.number().positive(),
  }),
  thd: z.object({
    voltageWarnPercent: z.number().positive(),
    voltageCriticalPercent: z.number().positive(),
  }),
  demand: z.object({
    warnPercentOfContracted: z.number().positive(),
    criticalPercentOfContracted: z.number().positive(),
  }),
  frequency: z.object({
    deviationWarnHz: z.number().positive(),
    deviationCriticalHz: z.number().positive(),
  }),
});
export type ElectricalAlarmThresholds = z.infer<typeof ElectricalAlarmThresholdsSchema>;

/** ⚠️ UMBRALES DEMO — SIMULADOS. No usar para operar una instalación real. */
export const DEMO_THRESHOLDS: ElectricalAlarmThresholds =
  ElectricalAlarmThresholdsSchema.parse({
    demoValues: true,
    voltage: {
      overWarnV: 242, // +5 % de 230
      overCriticalV: 253, // +10 %
      underWarnV: 218, // −5 %
      underCriticalV: 207, // −10 %
      phaseLossV: 60,
    },
    current: { warnPercentOfRated: 80, criticalPercentOfRated: 95 },
    imbalance: {
      voltageWarnPercent: 2,
      voltageCriticalPercent: 3,
      currentWarnPercent: 15,
      currentCriticalPercent: 25,
    },
    powerFactor: { warnBelow: 0.92, criticalBelow: 0.85 },
    thd: { voltageWarnPercent: 5, voltageCriticalPercent: 8 },
    demand: { warnPercentOfContracted: 85, criticalPercentOfContracted: 100 },
    frequency: { deviationWarnHz: 0.5, deviationCriticalHz: 1 },
  });

/**
 * Metrica que disparo la alarma.
 *
 * M2A.1 / punto 2: es parte de la IDENTIDAD de la condicion, no decoracion.
 * `PHASE_IMBALANCE` se emite tanto por tension como por corriente, ambas con
 * `phase: null`. Sin `metric`, las dos comparten clave y el seguimiento de
 * ciclo de vida las confunde: una se "resuelve" cuando en realidad la tapo la
 * otra.
 */
export type AlarmMetric =
  | 'voltage'
  | 'current'
  | 'imbalance_voltage'
  | 'imbalance_current'
  | 'power_factor'
  | 'thd_voltage'
  | 'demand'
  | 'frequency';

export interface ElectricalAlarm {
  code: ElectricalAlarmCode;
  severity: AlarmSeverity;
  metric: AlarmMetric;
  /** Fase implicada, o null si es una medida del conjunto. */
  phase: PhaseId | null;
  /** Valor medido que disparó la regla. */
  value: number;
  unit: string;
  threshold: number;
  message: string;
  timestamp: number;
}

/**
 * Evalúa el estado instantáneo. Función pura: mismos datos y umbrales, mismas
 * alarmas. Sin histéresis ni temporización todavía — eso es de EDGE, donde
 * importa no disparar por un transitorio de 200 ms.
 */
export function evaluateAlarms(
  t: ElectricalTelemetry,
  thresholds: ElectricalAlarmThresholds = DEMO_THRESHOLDS,
  spec: InstallationSpec = DEMO_INSTALLATION,
): ElectricalAlarm[] {
  const out: ElectricalAlarm[] = [];
  const add = (a: Omit<ElectricalAlarm, 'timestamp'>) =>
    out.push({ ...a, timestamp: t.timestamp });

  for (const id of PHASES) {
    const p = phaseOf(t, id);

    // Fase caída primero: si no, una fase en 0 V se reporta como subtensión
    // crítica, que manda al operador a buscar el problema en el lugar equivocado.
    if (p.voltageV < thresholds.voltage.phaseLossV) {
      add({
        code: 'PHASE_LOSS',
        severity: 'critical',
        metric: 'voltage',
        phase: id,
        value: p.voltageV,
        unit: 'V',
        threshold: thresholds.voltage.phaseLossV,
        message: `Pérdida de fase L${id === 'A' ? 1 : id === 'B' ? 2 : 3}: ${p.voltageV} V`,
      });
    } else if (p.voltageV < thresholds.voltage.underCriticalV) {
      add({ code: 'UNDERVOLTAGE', severity: 'critical', metric: 'voltage', phase: id, value: p.voltageV, unit: 'V', threshold: thresholds.voltage.underCriticalV, message: `Subtensión crítica en L${phaseNum(id)}: ${p.voltageV} V` });
    } else if (p.voltageV < thresholds.voltage.underWarnV) {
      add({ code: 'UNDERVOLTAGE', severity: 'warning', metric: 'voltage', phase: id, value: p.voltageV, unit: 'V', threshold: thresholds.voltage.underWarnV, message: `Subtensión en L${phaseNum(id)}: ${p.voltageV} V` });
    } else if (p.voltageV > thresholds.voltage.overCriticalV) {
      add({ code: 'OVERVOLTAGE', severity: 'critical', metric: 'voltage', phase: id, value: p.voltageV, unit: 'V', threshold: thresholds.voltage.overCriticalV, message: `Sobretensión crítica en L${phaseNum(id)}: ${p.voltageV} V` });
    } else if (p.voltageV > thresholds.voltage.overWarnV) {
      add({ code: 'OVERVOLTAGE', severity: 'warning', metric: 'voltage', phase: id, value: p.voltageV, unit: 'V', threshold: thresholds.voltage.overWarnV, message: `Sobretensión en L${phaseNum(id)}: ${p.voltageV} V` });
    }

    const loadPct = (p.currentA / spec.ratedCurrentPerPhaseA) * 100;
    if (loadPct > thresholds.current.criticalPercentOfRated) {
      add({ code: 'OVERCURRENT', severity: 'critical', metric: 'current', phase: id, value: p.currentA, unit: 'A', threshold: (thresholds.current.criticalPercentOfRated / 100) * spec.ratedCurrentPerPhaseA, message: `Sobrecorriente crítica en L${phaseNum(id)}: ${p.currentA} A (${loadPct.toFixed(0)} % del nominal)` });
    } else if (loadPct > thresholds.current.warnPercentOfRated) {
      add({ code: 'OVERCURRENT', severity: 'warning', metric: 'current', phase: id, value: p.currentA, unit: 'A', threshold: (thresholds.current.warnPercentOfRated / 100) * spec.ratedCurrentPerPhaseA, message: `Corriente alta en L${phaseNum(id)}: ${p.currentA} A (${loadPct.toFixed(0)} % del nominal)` });
    }
  }

  const vi = t.voltageImbalancePercent;
  if (vi > thresholds.imbalance.voltageCriticalPercent) {
    add({ code: 'PHASE_IMBALANCE', severity: 'critical', metric: 'imbalance_voltage', phase: null, value: vi, unit: '%', threshold: thresholds.imbalance.voltageCriticalPercent, message: `Desequilibrio de tensión crítico: ${vi} %` });
  } else if (vi > thresholds.imbalance.voltageWarnPercent) {
    add({ code: 'PHASE_IMBALANCE', severity: 'warning', metric: 'imbalance_voltage', phase: null, value: vi, unit: '%', threshold: thresholds.imbalance.voltageWarnPercent, message: `Desequilibrio de tensión: ${vi} %` });
  }

  const ci = t.currentImbalancePercent;
  if (ci > thresholds.imbalance.currentCriticalPercent) {
    add({ code: 'PHASE_IMBALANCE', severity: 'critical', metric: 'imbalance_current', phase: null, value: ci, unit: '%', threshold: thresholds.imbalance.currentCriticalPercent, message: `Desequilibrio de corriente crítico: ${ci} %` });
  } else if (ci > thresholds.imbalance.currentWarnPercent) {
    add({ code: 'PHASE_IMBALANCE', severity: 'warning', metric: 'imbalance_current', phase: null, value: ci, unit: '%', threshold: thresholds.imbalance.currentWarnPercent, message: `Desequilibrio de corriente: ${ci} %` });
  }

  if (t.powerFactor < thresholds.powerFactor.criticalBelow) {
    add({ code: 'LOW_POWER_FACTOR', severity: 'critical', metric: 'power_factor', phase: null, value: t.powerFactor, unit: '', threshold: thresholds.powerFactor.criticalBelow, message: `Factor de potencia muy bajo: ${t.powerFactor.toFixed(3)} (umbral ${thresholds.powerFactor.criticalBelow})` });
  } else if (t.powerFactor < thresholds.powerFactor.warnBelow) {
    add({ code: 'LOW_POWER_FACTOR', severity: 'warning', metric: 'power_factor', phase: null, value: t.powerFactor, unit: '', threshold: thresholds.powerFactor.warnBelow, message: `Factor de potencia bajo: ${t.powerFactor.toFixed(3)}` });
  }

  if (t.thdVoltagePercent !== null) {
    if (t.thdVoltagePercent > thresholds.thd.voltageCriticalPercent) {
      add({ code: 'HIGH_THD', severity: 'critical', metric: 'thd_voltage', phase: null, value: t.thdVoltagePercent, unit: '%', threshold: thresholds.thd.voltageCriticalPercent, message: `Distorsión armónica de tensión crítica: ${t.thdVoltagePercent} %` });
    } else if (t.thdVoltagePercent > thresholds.thd.voltageWarnPercent) {
      add({ code: 'HIGH_THD', severity: 'warning', metric: 'thd_voltage', phase: null, value: t.thdVoltagePercent, unit: '%', threshold: thresholds.thd.voltageWarnPercent, message: `Distorsión armónica de tensión elevada: ${t.thdVoltagePercent} %` });
    }
  }

  const demandPct = (t.activePowerKw / spec.contractedPowerKw) * 100;
  if (demandPct > thresholds.demand.criticalPercentOfContracted) {
    add({ code: 'HIGH_DEMAND', severity: 'critical', metric: 'demand', phase: null, value: t.activePowerKw, unit: 'kW', threshold: spec.contractedPowerKw, message: `Demanda por encima de la potencia contratada: ${t.activePowerKw} kW` });
  } else if (demandPct > thresholds.demand.warnPercentOfContracted) {
    add({ code: 'HIGH_DEMAND', severity: 'warning', metric: 'demand', phase: null, value: t.activePowerKw, unit: 'kW', threshold: (thresholds.demand.warnPercentOfContracted / 100) * spec.contractedPowerKw, message: `Demanda alta: ${t.activePowerKw} kW (${demandPct.toFixed(0)} % de lo contratado)` });
  }

  const df = Math.abs(t.frequencyHz - spec.nominalFrequencyHz);
  if (df > thresholds.frequency.deviationCriticalHz) {
    add({ code: 'FREQUENCY_DEVIATION', severity: 'critical', metric: 'frequency', phase: null, value: t.frequencyHz, unit: 'Hz', threshold: thresholds.frequency.deviationCriticalHz, message: `Desvío de frecuencia crítico: ${t.frequencyHz} Hz` });
  } else if (df > thresholds.frequency.deviationWarnHz) {
    add({ code: 'FREQUENCY_DEVIATION', severity: 'warning', metric: 'frequency', phase: null, value: t.frequencyHz, unit: 'Hz', threshold: thresholds.frequency.deviationWarnHz, message: `Desvío de frecuencia: ${t.frequencyHz} Hz` });
  }

  return out;
}

function phaseNum(id: PhaseId): number {
  return id === 'A' ? 1 : id === 'B' ? 2 : 3;
}

export function statusFromAlarms(alarms: readonly ElectricalAlarm[]): TelemetryStatus {
  if (alarms.some((a) => a.severity === 'critical')) return 'critical';
  if (alarms.some((a) => a.severity === 'warning')) return 'warning';
  return 'normal';
}

/** Telemetría con `status` y `alarmCodes` ya resueltos por el evaluador. */
export function withAlarms(
  t: ElectricalTelemetry,
  thresholds: ElectricalAlarmThresholds = DEMO_THRESHOLDS,
  spec: InstallationSpec = DEMO_INSTALLATION,
): { telemetry: ElectricalTelemetry; alarms: ElectricalAlarm[] } {
  const alarms = evaluateAlarms(t, thresholds, spec);
  return {
    telemetry: {
      ...t,
      status: statusFromAlarms(alarms),
      alarmCodes: [...new Set(alarms.map((a) => a.code))],
    },
    alarms,
  };
}


/**
 * Identidad estable de una condicion: codigo + fase + metrica.
 *
 * Es lo que permite decir "esta es la MISMA alarma que antes, cambio de
 * severidad" en vez de "se resolvio una y aparecio otra".
 */
export function alarmKey(a: Pick<ElectricalAlarm, 'code' | 'phase' | 'metric'>): string {
  return `${a.code}|${a.phase ?? '-'}|${a.metric}`;
}
