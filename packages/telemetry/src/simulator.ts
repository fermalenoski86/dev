import {
  DEMO_INSTALLATION,
  ElectricalTelemetrySchema,
  imbalancePercent,
  type ElectricalTelemetry,
  type InstallationSpec,
  type PhaseTelemetry,
} from './contract';

/**
 * ⚠️ SIMULADOR. Ningún dato de acá sale de un instrumento.
 *
 * Misma decisión que en show-engine (ADR-001): `sampleTelemetry` es una
 * **función pura de (seed, escenario, t)**. No acumula estado entre llamadas.
 *
 * Por qué importa acá, y no es purismo:
 *
 *  - El gráfico de 24 h y el número grande en pantalla salen de la MISMA
 *    función. Con un simulador con estado, la serie histórica se genera de una
 *    forma y el valor en vivo de otra, y tarde o temprano el gráfico
 *    contradice al indicador. En un panel de operación eso destruye la
 *    confianza en todo el resto.
 *  - Un bug se reproduce con (seed, escenario, t). No hay "se veía raro ayer".
 *  - Los tests no necesitan timers.
 */

export const TELEMETRY_SCENARIOS = [
  'NORMAL',
  'HIGH_LOAD',
  'PHASE_IMBALANCE',
  'UNDERVOLTAGE',
  'PHASE_LOSS',
  'LOW_POWER_FACTOR',
] as const;
export type TelemetryScenario = (typeof TELEMETRY_SCENARIOS)[number];

export const SCENARIO_LABELS: Record<TelemetryScenario, string> = {
  NORMAL: 'Operación normal',
  HIGH_LOAD: 'Carga alta (takeover a brillo pleno)',
  PHASE_IMBALANCE: 'Desequilibrio entre fases',
  UNDERVOLTAGE: 'Subtensión de red',
  PHASE_LOSS: 'Pérdida de fase (L3)',
  LOW_POWER_FACTOR: 'Factor de potencia bajo',
};

/* ────────────────────────────────────────────────────────────────
 * Ruido determinista
 * ──────────────────────────────────────────────────────────────── */

/** Hash entero → [0,1). Sin estado: la misma entrada da siempre lo mismo. */
function hash01(seed: number, salt: number): number {
  let h = (seed ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Ruido suave: interpola entre valores de hash en una grilla temporal, así la
 * señal se mueve de forma continua en vez de saltar cada muestra. Un analizador
 * real no da valores independientes entre lecturas consecutivas.
 */
function smoothNoise(seed: number, salt: number, tMs: number, periodMs: number): number {
  const x = tMs / periodMs;
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(seed, salt + i * 7919);
  const b = hash01(seed, salt + (i + 1) * 7919);
  const s = f * f * (3 - 2 * f); // smoothstep
  return a + (b - a) * s;
}

/** Ruido centrado en 0, amplitud ±1. */
function noise(seed: number, salt: number, tMs: number, periodMs: number): number {
  return smoothNoise(seed, salt, tMs, periodMs) * 2 - 1;
}

/* ────────────────────────────────────────────────────────────────
 * Perfil de carga del edificio
 * ──────────────────────────────────────────────────────────────── */

const MS_DAY = 86_400_000;

/**
 * Curva diaria de demanda, 0..1 según la hora local.
 *
 * Un edificio DOOH no sigue la curva de una oficina: el pico es de noche,
 * cuando las pantallas van a brillo pleno y la iluminación arquitectónica está
 * encendida. De día el LED baja consumo relativo porque, aunque el brillo sube,
 * el contenido promedio es más claro y la luz de fachada está apagada.
 */
export function dailyLoadFactor(hourOfDay: number): number {
  const h = ((hourOfDay % 24) + 24) % 24;
  if (h < 6) return 0.34 + 0.04 * Math.cos(((h - 3) / 3) * Math.PI); // madrugada
  if (h < 9) return 0.38 + ((h - 6) / 3) * 0.18; // amanece
  if (h < 18) return 0.56 + 0.06 * Math.sin(((h - 9) / 9) * Math.PI); // día
  if (h < 21) return 0.62 + ((h - 18) / 3) * 0.36; // prime time
  return 0.98 - ((h - 21) / 3) * 0.6; // baja hacia la madrugada
}

export interface SimulationConfig {
  seed: number;
  scenario: TelemetryScenario;
  spec: InstallationSpec;
  deviceId: string;
  /** Desfase horario del sitio respecto de UTC. Buenos Aires: -3. */
  utcOffsetHours: number;
}

export const DEFAULT_SIMULATION: SimulationConfig = {
  seed: 20260921,
  scenario: 'NORMAL',
  spec: DEMO_INSTALLATION,
  deviceId: 'SIM-PM-001',
  utcOffsetHours: -3,
};

interface ScenarioShape {
  loadScale: number;
  /** Multiplicador de tensión por fase [A, B, C]. */
  voltageScale: [number, number, number];
  /** Multiplicador de corriente por fase [A, B, C]. */
  currentScale: [number, number, number];
  powerFactorBase: number;
  thdVoltageBase: number;
}

const SHAPES: Record<TelemetryScenario, ScenarioShape> = {
  NORMAL: {
    loadScale: 1,
    voltageScale: [1, 1, 1],
    currentScale: [1, 1, 1],
    powerFactorBase: 0.962,
    thdVoltageBase: 2.1,
  },
  HIGH_LOAD: {
    loadScale: 1.62,
    voltageScale: [0.985, 0.983, 0.986],
    currentScale: [1, 1, 1],
    powerFactorBase: 0.948,
    thdVoltageBase: 3.4,
  },
  PHASE_IMBALANCE: {
    loadScale: 1.05,
    voltageScale: [1.006, 0.994, 0.99],
    currentScale: [1.34, 0.95, 0.72],
    powerFactorBase: 0.951,
    thdVoltageBase: 2.6,
  },
  UNDERVOLTAGE: {
    loadScale: 0.95,
    voltageScale: [0.915, 0.918, 0.912],
    currentScale: [1.08, 1.08, 1.08],
    powerFactorBase: 0.955,
    thdVoltageBase: 3.1,
  },
  PHASE_LOSS: {
    // L3 se cae: su tensión y corriente se van a cero y la carga se reparte mal.
    loadScale: 0.78,
    voltageScale: [1.01, 1.008, 0.02],
    currentScale: [1.42, 1.38, 0.01],
    powerFactorBase: 0.93,
    thdVoltageBase: 4.8,
  },
  LOW_POWER_FACTOR: {
    loadScale: 1.02,
    voltageScale: [0.998, 0.997, 0.999],
    currentScale: [1.22, 1.24, 1.21],
    powerFactorBase: 0.782,
    thdVoltageBase: 5.6,
  },
};

/** Reparto base de la carga del edificio entre fases. Nunca es exacto en la vida real. */
const PHASE_SPLIT: [number, number, number] = [0.352, 0.334, 0.314];

function buildPhase(
  cfg: SimulationConfig,
  tMs: number,
  index: 0 | 1 | 2,
  shape: ScenarioShape,
  totalKw: number,
  pf: number,
): PhaseTelemetry {
  const salt = 1000 + index * 131;
  const vNoise = noise(cfg.seed, salt, tMs, 45_000) * 1.6;
  const voltageV = Math.max(
    0,
    cfg.spec.nominalVoltageV * shape.voltageScale[index] + vNoise,
  );

  const share = PHASE_SPLIT[index] * shape.currentScale[index];
  const phaseKw = totalKw * share;
  const iNoise = 1 + noise(cfg.seed, salt + 57, tMs, 30_000) * 0.02;
  const currentA = voltageV > 20 ? ((phaseKw * 1000) / (voltageV * pf)) * iNoise : 0;

  const thdV = shape.thdVoltageBase + noise(cfg.seed, salt + 311, tMs, 120_000) * 0.4;

  return {
    voltageV: round(voltageV, 1),
    currentA: round(currentA, 1),
    activePowerKw: round(voltageV > 20 ? phaseKw : 0, 2),
    powerFactor: round(pf + noise(cfg.seed, salt + 777, tMs, 90_000) * 0.006, 3),
    thdVoltagePercent: round(Math.max(0, thdV), 2),
    thdCurrentPercent: round(Math.max(0, thdV * 2.4 + 1.2), 2),
  };
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/**
 * Telemetría en el instante `tMs` (epoch ms). Función pura.
 *
 * `status` y `alarmCodes` quedan en 'normal'/[] acá a propósito: evaluarlos es
 * trabajo de `evaluateAlarms`, que tiene los umbrales. Un simulador que decide
 * si algo es alarma ya no sirve para testear el evaluador de alarmas.
 */
export function sampleTelemetry(
  tMs: number,
  config: Partial<SimulationConfig> = {},
): ElectricalTelemetry {
  const cfg: SimulationConfig = { ...DEFAULT_SIMULATION, ...config };
  const shape = SHAPES[cfg.scenario];

  const localMs = tMs + cfg.utcOffsetHours * 3_600_000;
  const hour = (localMs % MS_DAY) / 3_600_000;

  const baseKw = cfg.spec.contractedPowerKw * 0.72;
  const load = dailyLoadFactor(hour) * shape.loadScale;
  const drift = 1 + noise(cfg.seed, 11, tMs, 240_000) * 0.035;
  const totalKw = baseKw * load * drift;

  const pf = clamp(
    shape.powerFactorBase + noise(cfg.seed, 23, tMs, 150_000) * 0.012,
    0.5,
    1,
  );

  const phaseA = buildPhase(cfg, tMs, 0, shape, totalKw, pf);
  const phaseB = buildPhase(cfg, tMs, 1, shape, totalKw, pf);
  const phaseC = buildPhase(cfg, tMs, 2, shape, totalKw, pf);

  const activePowerKw = round(
    phaseA.activePowerKw + phaseB.activePowerKw + phaseC.activePowerKw,
    2,
  );
  const apparentPowerKva = round(pf > 0 ? activePowerKw / pf : 0, 2);
  const reactivePowerKvar = round(
    Math.sqrt(Math.max(0, apparentPowerKva ** 2 - activePowerKw ** 2)),
    2,
  );

  const vA = phaseA.voltageV;
  const vB = phaseB.voltageV;
  const vC = phaseC.voltageV;
  const line = (x: number, y: number) => round(Math.min(x, y) < 20 ? Math.max(x, y) : ((x + y) / 2) * Math.sqrt(3), 1);

  const freq = round(
    cfg.spec.nominalFrequencyHz + noise(cfg.seed, 41, tMs, 60_000) * 0.06,
    2,
  );

  const energy = integrateEnergy(tMs, cfg);

  return ElectricalTelemetrySchema.parse({
    timestamp: Math.floor(tMs),
    deviceId: cfg.deviceId,
    phaseA,
    phaseB,
    phaseC,
    lineVoltageAB: line(vA, vB),
    lineVoltageBC: line(vB, vC),
    lineVoltageCA: line(vC, vA),
    activePowerKw,
    apparentPowerKva,
    reactivePowerKvar,
    powerFactor: round(pf, 3),
    frequencyHz: freq,
    energyTotalKwh: energy.total,
    energyTodayKwh: energy.today,
    energyMonthKwh: energy.month,
    peakDemandKw: energy.peakDemandKw,
    voltageImbalancePercent: round(imbalancePercent([vA, vB, vC]), 2),
    currentImbalancePercent: round(
      imbalancePercent([phaseA.currentA, phaseB.currentA, phaseC.currentA]),
      2,
    ),
    thdVoltagePercent: phaseA.thdVoltagePercent,
    thdCurrentPercent: phaseA.thdCurrentPercent,
    status: 'normal',
    alarmCodes: [],
    simulated: true,
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Energía acumulada. Se integra la curva de carga en pasos de 15 minutos, que
 * es el intervalo de facturación que usan las distribuidoras.
 *
 * M2A.1 / punto 6 — dos aclaraciones importantes:
 *
 * 1. `energyMonthKwh` usa el MES CALENDARIO LOCAL real (del día 1 a hoy en
 *    hora del sitio), no un mes ficticio de 30 días como antes. El día del mes
 *    sale de `Date` con el offset del sitio aplicado.
 *
 * 2. `peakDemandKw` es una APROXIMACIÓN: el máximo de las muestras de 15 min
 *    integradas. NO es la demanda máxima fiscal de la distribuidora, que se
 *    calcula sobre ventanas deslizantes definidas por el cuadro tarifario y
 *    es el número que efectivamente se factura. Sirve para operar, no para
 *    discutir una factura.
 */
export function integrateEnergy(
  tMs: number,
  config: Partial<SimulationConfig> = {},
): { today: number; month: number; total: number; peakDemandKw: number } {
  const cfg: SimulationConfig = { ...DEFAULT_SIMULATION, ...config };
  const shape = SHAPES[cfg.scenario];
  const stepMs = 900_000; // 15 min
  const baseKw = cfg.spec.contractedPowerKw * 0.72;

  const localMs = tMs + cfg.utcOffsetHours * 3_600_000;
  const dayStartLocal = Math.floor(localMs / MS_DAY) * MS_DAY;
  const dayIndex = Math.floor(localMs / MS_DAY);

  let today = 0;
  let peak = 0;
  for (let t = dayStartLocal; t < localMs; t += stepMs) {
    const utc = t - cfg.utcOffsetHours * 3_600_000;
    const hour = (t % MS_DAY) / 3_600_000;
    const kw =
      baseKw * dailyLoadFactor(hour) * shape.loadScale * (1 + noise(cfg.seed, 11, utc, 240_000) * 0.035);
    today += (kw * stepMs) / 3_600_000;
    if (kw > peak) peak = kw;
  }

  // Día del mes en hora local: se usa el calendario real, con su cantidad de
  // días variable, en vez de asumir meses de 30.
  const local = new Date(localMs);
  const diasCompletosDelMes = local.getUTCDate() - 1;

  // Los días anteriores se promedian en vez de integrarse uno por uno: recorrer
  // 30 días en pasos de 15 min en cada frame no aporta precisión que se note.
  const avgDailyKwh = averageDailyKwh(baseKw * shape.loadScale);
  const month = today + diasCompletosDelMes * avgDailyKwh;
  const total = 412_500 + dayIndex * avgDailyKwh + today;

  return {
    today: round(today, 1),
    month: round(month, 1),
    total: round(total, 1),
    peakDemandKw: round(peak, 1),
  };
}

function averageDailyKwh(scaledBaseKw: number): number {
  let sum = 0;
  for (let h = 0; h < 24; h += 0.25) sum += dailyLoadFactor(h) * scaledBaseKw * 0.25;
  return sum;
}

/** Serie histórica. Mismo muestreo que el valor en vivo, por construcción. */
export function sampleSeries(
  fromMs: number,
  toMs: number,
  points: number,
  config: Partial<SimulationConfig> = {},
): ElectricalTelemetry[] {
  if (points < 2 || toMs <= fromMs) return [];
  const step = (toMs - fromMs) / (points - 1);
  return Array.from({ length: points }, (_, i) => sampleTelemetry(fromMs + i * step, config));
}
