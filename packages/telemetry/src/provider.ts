import type { ElectricalTelemetry } from './contract';
import { DEMO_INSTALLATION, type InstallationSpec } from './contract';
import {
  DEFAULT_STALE_AFTER_MS,
  evaluateFreshness,
  type TelemetrySample,
} from './freshness';
import {
  DEFAULT_SIMULATION,
  sampleSeries,
  sampleTelemetry,
  type SimulationConfig,
  type TelemetryScenario,
} from './simulator';

/**
 * Abstracción de origen de telemetría.
 *
 * Existe para que el día que llegue el analizador de red no haya que tocar ni
 * la UI ni el motor de alarmas: se cambia el provider y nada más. La UI no
 * sabe si detrás hay un simulador o un Modbus, salvo por la bandera
 * `simulated`, que es justamente lo que debe seguir viéndose.
 */
export interface TelemetryProvider {
  readonly id: string;
  /** true mientras no haya instrumento real detrás. */
  readonly simulated: boolean;

  /**
   * Lectura con metadata de frescura (M2A.1 / punto 5).
   *
   * Devuelve un sobre, no la medida pelada: el consumidor tiene que ver
   * SIEMPRE la calidad del dato junto al dato. Un provider real que pierde
   * comunicación devuelve la última medida con `quality: 'STALE'`, nunca la
   * medida sola aparentando estar al día.
   */
  readSample(atMs: number): TelemetrySample;

  /** Serie histórica para tendencias. */
  history(fromMs: number, toMs: number, points: number): ElectricalTelemetry[];
}

export type SimulatedProviderOptions = Partial<SimulationConfig> & {
  staleAfterMs?: number;
  /**
   * Corta la entrega de muestras, para poder probar STALE/COMM_ERROR sin
   * hardware. Solo simulación.
   */
  faultMode?: 'none' | 'stale' | 'comm_error';
};

/**
 * Provider simulado. Delega en `sampleTelemetry`, que es pura, así que este
 * objeto no guarda estado de señal: solo configuración.
 */
export class SimulatedTelemetryProvider implements TelemetryProvider {
  readonly simulated = true;
  private config: SimulationConfig;
  private staleAfterMs: number;
  private faultMode: 'none' | 'stale' | 'comm_error';
  /** Instante de la última muestra realmente entregada. */
  private lastMeasuredAt: number | null = null;
  private lastTelemetry: ElectricalTelemetry | null = null;

  constructor(options: SimulatedProviderOptions = {}) {
    const { staleAfterMs, faultMode, ...sim } = options;
    this.config = { ...DEFAULT_SIMULATION, ...sim };
    this.staleAfterMs = staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.faultMode = faultMode ?? 'none';
  }

  /** Simula una falla de enlace. Solo para probar la UI sin hardware. */
  setFaultMode(mode: 'none' | 'stale' | 'comm_error'): void {
    this.faultMode = mode;
  }

  getFaultMode(): 'none' | 'stale' | 'comm_error' {
    return this.faultMode;
  }

  get id(): string {
    return this.config.deviceId;
  }

  get scenario(): TelemetryScenario {
    return this.config.scenario;
  }

  get spec(): InstallationSpec {
    return this.config.spec;
  }

  /** Cambiar escenario NO altera el historial ya mostrado: se recalcula entero. */
  setScenario(scenario: TelemetryScenario): void {
    this.config = { ...this.config, scenario };
  }

  /**
   * Lectura cruda sin sobre. Útil para tests y para el generador de series;
   * la UI debe usar `readSample`, que incluye la calidad del dato.
   */
  read(atMs: number): ElectricalTelemetry {
    return sampleTelemetry(atMs, this.config);
  }

  readSample(atMs: number): TelemetrySample {
    if (this.faultMode === 'comm_error') {
      // Se conserva la última medida conocida, pero marcada como error: se
      // puede mostrar como "última lectura", nunca como valor actual.
      return evaluateFreshness({
        now: atMs,
        measuredAt: this.lastMeasuredAt,
        receivedAt: this.lastMeasuredAt,
        telemetry: this.lastTelemetry,
        staleAfterMs: this.staleAfterMs,
        commError: 'Sin respuesta del medidor (simulado)',
      });
    }

    if (this.faultMode === 'stale') {
      // El medidor dejó de publicar: la última muestra envejece sola.
      return evaluateFreshness({
        now: atMs,
        measuredAt: this.lastMeasuredAt,
        receivedAt: this.lastMeasuredAt,
        telemetry: this.lastTelemetry,
        staleAfterMs: this.staleAfterMs,
      });
    }

    const telemetry = sampleTelemetry(atMs, this.config);
    this.lastMeasuredAt = atMs;
    this.lastTelemetry = telemetry;
    return evaluateFreshness({
      now: atMs,
      measuredAt: atMs,
      receivedAt: atMs,
      telemetry,
      staleAfterMs: this.staleAfterMs,
    });
  }

  history(fromMs: number, toMs: number, points: number): ElectricalTelemetry[] {
    return sampleSeries(fromMs, toMs, points, this.config);
  }
}

/**
 * ModbusTelemetryProvider — NO IMPLEMENTADO.
 *
 * Deliberadamente es un stub que tira error en vez de devolver ceros o datos
 * inventados: un provider "real" que calla y entrega valores plausibles es la
 * forma más rápida de que alguien crea que el edificio está medido cuando no
 * lo está.
 *
 * Cuando se implemente, va a vivir en TRUST EDGE y no en el navegador. El
 * frontend nunca habla Modbus (PRINCIPLES.md §2): EDGE lee el analizador y
 * publica esta misma forma de dato por la API.
 *
 * Pendiente al implementar:
 *  - modelo y mapa de registros del analizador (no elegido todavía),
 *  - escalas y endianness por registro,
 *  - RTU sobre RS-485 o TCP, según dónde quede el tablero,
 *  - política de reintento y qué hacer ante lecturas viejas,
 *  - marcar `simulated: false` solo cuando el dato venga del instrumento.
 */
export class ModbusTelemetryProvider implements TelemetryProvider {
  readonly id = 'modbus-not-implemented';
  readonly simulated = false;

  constructor() {
    throw new Error(
      'ModbusTelemetryProvider no está implementado. Milestone 2A es solo simulación; ' +
        'la lectura Modbus vive en TRUST EDGE, nunca en el frontend.',
    );
  }

  readSample(): TelemetrySample {
    throw new Error('no implementado');
  }

  history(): ElectricalTelemetry[] {
    throw new Error('no implementado');
  }
}

export const DEFAULT_SPEC = DEMO_INSTALLATION;
