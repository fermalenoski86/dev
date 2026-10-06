import { z } from 'zod';

/**
 * Contrato de telemetría eléctrica — TRUST CONTROL Milestone 2A.
 *
 * ⚠️ TODO DATO QUE CIRCULA POR ESTE CONTRATO HOY ES **SIMULADO**.
 * No hay analizador de red conectado. Ver `docs/architecture/ENERGY.md`.
 *
 * El contrato se escribe ahora, antes del hardware, por la misma razón que el
 * SHOW PACKAGE se escribió antes de EDGE: si la forma de los datos se define
 * recién cuando llega el equipo, la UI termina moldeada por el registro Modbus
 * de un fabricante y cambiar de analizador obliga a rehacerla.
 *
 * Flujo futuro:
 *   analizador trifásico → Modbus RTU/TCP → TRUST EDGE → API → TRUST CONTROL
 */

export const PhaseIdSchema = z.enum(['A', 'B', 'C']);
export type PhaseId = z.infer<typeof PhaseIdSchema>;

export const TelemetryStatusSchema = z.enum(['normal', 'warning', 'critical']);
export type TelemetryStatus = z.infer<typeof TelemetryStatusSchema>;

/**
 * Medidas por fase. Un analizador barato entrega esto y nada más; uno de power
 * quality agrega THD y armónicos. Por eso todo lo de calidad es nullable: el
 * modelo final todavía no está elegido y la UI tiene que poder mostrar "n/d"
 * en vez de inventar un cero, que se confunde con "medido y da cero".
 */
export const PhaseTelemetrySchema = z.object({
  voltageV: z.number().nonnegative(),
  currentA: z.number().nonnegative(),
  activePowerKw: z.number(),
  /** Nullable: no todos los analizadores dan PF por fase. */
  powerFactor: z.number().min(-1).max(1).nullable().default(null),
  thdVoltagePercent: z.number().nonnegative().nullable().default(null),
  thdCurrentPercent: z.number().nonnegative().nullable().default(null),
});
export type PhaseTelemetry = z.infer<typeof PhaseTelemetrySchema>;

export const ElectricalTelemetrySchema = z.object({
  /** Epoch ms. Es el instante de la MEDICIÓN, no el de la recepción. */
  timestamp: z.number().int(),
  deviceId: z.string().min(1),

  phaseA: PhaseTelemetrySchema,
  phaseB: PhaseTelemetrySchema,
  phaseC: PhaseTelemetrySchema,

  /** Tensiones compuestas (fase-fase). Con 230 V F-N rondan los 398 V. */
  lineVoltageAB: z.number().nonnegative(),
  lineVoltageBC: z.number().nonnegative(),
  lineVoltageCA: z.number().nonnegative(),

  activePowerKw: z.number(),
  apparentPowerKva: z.number().nonnegative(),
  reactivePowerKvar: z.number(),

  powerFactor: z.number().min(-1).max(1),
  frequencyHz: z.number().nonnegative(),

  energyTotalKwh: z.number().nonnegative(),
  energyTodayKwh: z.number().nonnegative(),
  energyMonthKwh: z.number().nonnegative(),

  peakDemandKw: z.number().nonnegative(),

  voltageImbalancePercent: z.number().nonnegative(),
  currentImbalancePercent: z.number().nonnegative(),

  thdVoltagePercent: z.number().nonnegative().nullable().default(null),
  thdCurrentPercent: z.number().nonnegative().nullable().default(null),

  status: TelemetryStatusSchema,
  alarmCodes: z.array(z.string()).default([]),

  /**
   * Origen del dato. No es decorativo: la UI tiene que poder marcar SIMULATED
   * de forma que no dependa de que alguien se acuerde de ponerlo en un cartel.
   */
  simulated: z.boolean(),
});
export type ElectricalTelemetry = z.infer<typeof ElectricalTelemetrySchema>;

export function parseElectricalTelemetry(input: unknown): ElectricalTelemetry {
  return ElectricalTelemetrySchema.parse(input);
}

/** Datos de placa de la instalación. Valores DEMO hasta el relevamiento eléctrico. */
export const InstallationSpecSchema = z.object({
  nominalVoltageV: z.number().positive(),
  nominalFrequencyHz: z.number().positive(),
  /** Corriente nominal por fase del tablero. Base del "% de carga". */
  ratedCurrentPerPhaseA: z.number().positive(),
  contractedPowerKw: z.number().positive(),
});
export type InstallationSpec = z.infer<typeof InstallationSpecSchema>;

/** ⚠️ DEMO / SIMULADO. Reemplazar con los datos reales del tablero. */
export const DEMO_INSTALLATION: InstallationSpec = InstallationSpecSchema.parse({
  nominalVoltageV: 230,
  nominalFrequencyHz: 50,
  ratedCurrentPerPhaseA: 125,
  contractedPowerKw: 75,
});

export const PHASES = ['A', 'B', 'C'] as const;

export function phaseOf(t: ElectricalTelemetry, id: PhaseId): PhaseTelemetry {
  return id === 'A' ? t.phaseA : id === 'B' ? t.phaseB : t.phaseC;
}

/** % de carga de una fase contra la corriente nominal del tablero. */
export function phaseLoadPercent(
  phase: PhaseTelemetry,
  spec: InstallationSpec = DEMO_INSTALLATION,
): number {
  return (phase.currentA / spec.ratedCurrentPerPhaseA) * 100;
}

/**
 * Desequilibrio según NEMA: desvío máximo respecto del promedio, sobre el
 * promedio. Es la definición que usan los analizadores comerciales; calcularlo
 * de otra forma daría números que no coinciden con el display del equipo
 * cuando se conecte, y eso arruina la confianza en el sistema entero.
 */
export function imbalancePercent(values: readonly number[]): number {
  const usable = values.filter((v) => Number.isFinite(v));
  if (usable.length === 0) return 0;
  const avg = usable.reduce((a, b) => a + b, 0) / usable.length;
  if (avg === 0) return 0;
  const maxDev = Math.max(...usable.map((v) => Math.abs(v - avg)));
  return (maxDev / avg) * 100;
}
