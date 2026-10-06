import { z } from 'zod';
import type { ShowRuntimeState } from '@trust/shared-types';
import type { TelemetrySample, TrackedAlarm } from '@trust/telemetry';

/**
 * Estado operativo que ve el centro de control.
 *
 * ── M2A.1 / punto 1 ──────────────────────────────────────────────
 *
 * Antes cada subsistema tenia UN estado, y una pantalla aparecia `ONLINE` en
 * verde aunque no exista ningun hardware conectado. Esa es exactamente la
 * clase de error que un panel de operacion no puede cometer: presentar como
 * verificado algo que nadie verifico.
 *
 * Ahora son dos ejes independientes, porque responden preguntas distintas:
 *
 *   logicalState  que DEBERIA estar pasando, segun el show-engine.
 *                 LIVE / HOLD / BLACK / IDLE.
 *   health        en que condicion esta el subsistema.
 *                 ONLINE / WARNING / CRITICAL / STALE / OFFLINE.
 *   provenance    de donde sale ese juicio: SIMULATED o REAL.
 *
 * ── M2A.2 / punto 3 ──────────────────────────────────────────────
 *
 * `SIMULATED` era un valor de salud, y eso mezclaba dos preguntas: "como
 * esta" y "como lo sabemos". El problema concreto: una falla SIMULADA no
 * tenia como expresarse sin perder la marca de simulada — o se veia CRITICAL
 * (y parecia real) o se veia SIMULATED (y la falla desaparecia).
 *
 * Separados, un PHASE_LOSS simulado es `health: CRITICAL` +
 * `provenance: SIMULATED`: la falla se ve, y sigue constando que nadie midio
 * nada. `hasVerifiedDevices` mira SOLO provenance, asi que ninguna falla
 * simulada puede volverlo true.
 */

export const LogicalStateSchema = z.enum(['LIVE', 'HOLD', 'BLACK', 'IDLE']);
export type LogicalState = z.infer<typeof LogicalStateSchema>;

export const DeviceHealthSchema = z.enum(['ONLINE', 'WARNING', 'CRITICAL', 'STALE', 'OFFLINE']);
export type DeviceHealth = z.infer<typeof DeviceHealthSchema>;

/** De donde sale el juicio de salud. Ortogonal a la salud misma. */
export const ProvenanceSchema = z.enum(['SIMULATED', 'REAL']);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const SubsystemIdSchema = z.enum([
  'screen_corrientes',
  'screen_pellegrini',
  'screen_horizontal',
  'lighting_architectural',
  'lighting_rgbw',
  'clock',
  'edge',
  'connectivity',
  'electrical',
]);
export type SubsystemId = z.infer<typeof SubsystemIdSchema>;

export interface Subsystem {
  id: SubsystemId;
  label: string;
  group: 'media' | 'lighting' | 'clock' | 'system' | 'energy';
  /** Que dice el show-engine que deberia estar pasando. */
  logicalState: LogicalState;
  /** En que condicion esta. */
  health: DeviceHealth;
  /** Como lo sabemos. En M2A siempre SIMULATED. */
  provenance: Provenance;
  detail: string;
  healthDetail: string;
}

/**
 * Verde SOLO para lo verificado. Lo decide `provenance`, NUNCA `health`: un
 * dispositivo simulado puede estar en cualquier salud y sigue sin verificar.
 */
export const PROVENANCE_IS_VERIFIED: Record<Provenance, boolean> = {
  REAL: true,
  SIMULATED: false,
};

/* ────────────────────────────────────────────────────────────────
 * Modos del edificio
 * ──────────────────────────────────────────────────────────────── */

export const BuildingModeSchema = z.enum(['NORMAL', 'BRAND', 'TAKEOVER', 'EVENT', 'ICONIC']);
export type BuildingMode = z.infer<typeof BuildingModeSchema>;

export interface BuildingModeSpec {
  mode: BuildingMode;
  label: string;
  description: string;
  /** Escena de iluminacion que DEFINE al modo. Ver ADR-020. */
  lightingSceneId: string;
  brandContent: boolean;
  /**
   * Si el modo cede la cupula y el reloj al anunciante. Falso en todos salvo
   * TAKEOVER, y ahi solo parcialmente: la firma del edificio no se alquila
   * entera.
   */
  cedesSignature: boolean;
}

export const BUILDING_MODES: Record<BuildingMode, BuildingModeSpec> = {
  NORMAL: {
    mode: 'NORMAL',
    label: 'Normal',
    description: 'Identidad del edificio. Iluminacion calida, programacion regular.',
    lightingSceneId: 'trust_normal',
    brandContent: false,
    cedesSignature: false,
  },
  BRAND: {
    mode: 'BRAND',
    label: 'Brand',
    description: 'Contenido de marca en pantallas, acento sutil sin ceder la firma.',
    lightingSceneId: 'brand_accent',
    brandContent: true,
    cedesSignature: false,
  },
  TAKEOVER: {
    mode: 'TAKEOVER',
    label: 'Takeover',
    description: 'Campania completa: pantallas e iluminacion de la marca. Cupula y reloj siguen dorados.',
    lightingSceneId: 'mcd_red_gold',
    brandContent: true,
    cedesSignature: true,
  },
  EVENT: {
    mode: 'EVENT',
    label: 'Event',
    description: 'Evento puntual: identidad reforzada, sin marca.',
    lightingSceneId: 'event_bright',
    brandContent: false,
    cedesSignature: false,
  },
  ICONIC: {
    mode: 'ICONIC',
    label: 'Iconic',
    description: 'Solo el edificio: cupula y reloj al maximo. Es el modo que construye el activo.',
    lightingSceneId: 'iconic_signature',
    brandContent: false,
    cedesSignature: false,
  },
};

/* ────────────────────────────────────────────────────────────────
 * Derivacion del estado de supervision
 * ──────────────────────────────────────────────────────────────── */

export interface SystemSnapshotInput {
  show: ShowRuntimeState | null;
  showStatus: 'stopped' | 'playing' | 'paused' | 'ended';
  safeMode: boolean;
  /** Muestra de telemetria con su metadata de frescura. */
  sample: TelemetrySample | null;
  /**
   * M2A.2 / punto 2. Alarmas del AlarmRegistry — la MISMA evaluacion que ve
   * la pestania ENERGY. Antes el snapshot miraba `telemetry.status`, un campo
   * que el evaluador rellena aparte: dos caminos para la misma pregunta, y
   * bastaba que alguien construyera la telemetria sin pasar por `withAlarms`
   * para que Overview dijera "normal" mientras ENERGY mostraba un PHASE_LOSS.
   */
  alarms: readonly TrackedAlarm[];
  mediaErrors: readonly string[];
  controlReachable: boolean;
  /** Procedencia por subsistema. En M2A todos SIMULATED. */
  provenance?: Partial<Record<SubsystemId, Provenance>>;
  /** Salud conocida de dispositivos reales, cuando EDGE exista. */
  deviceHealth?: Partial<Record<SubsystemId, DeviceHealth>>;
}

const SCREEN_MAP = [
  { id: 'screen_corrientes' as const, screen: 'screen_a' as const, label: 'Pantalla Corrientes' },
  { id: 'screen_pellegrini' as const, screen: 'screen_b' as const, label: 'Pantalla Pellegrini' },
  { id: 'screen_horizontal' as const, screen: 'horizontal' as const, label: 'Pantalla horizontal' },
];

/** En Milestone 2A ningun dispositivo del edificio existe. Todos simulados. */
export const M2A_PROVENANCE: Record<SubsystemId, Provenance> = {
  screen_corrientes: 'SIMULATED',
  screen_pellegrini: 'SIMULATED',
  screen_horizontal: 'SIMULATED',
  lighting_architectural: 'SIMULATED',
  lighting_rgbw: 'SIMULATED',
  clock: 'SIMULATED',
  edge: 'SIMULATED',
  connectivity: 'SIMULATED',
  electrical: 'SIMULATED',
};

const SIM_NOTE = 'Sin hardware conectado: estado no verificado';

/**
 * M2A.2 / punto 2. Salud electrica derivada de UNA sola fuente:
 * calidad del dato + alarmas del registro. Nunca de `telemetry.status`.
 */
export function deriveElectricalHealth(
  sample: TelemetrySample | null,
  alarms: readonly TrackedAlarm[],
): DeviceHealth {
  if (!sample || sample.quality === 'NO_DATA') return 'OFFLINE';
  if (sample.quality === 'COMM_ERROR') return 'CRITICAL';
  // Las alarmas mandan sobre STALE: una condicion critica medida hace 30 s
  // sigue siendo una condicion critica.
  if (alarms.some((a) => a.severity === 'critical')) return 'CRITICAL';
  if (sample.quality === 'STALE') return 'STALE';
  if (alarms.some((a) => a.severity === 'warning')) return 'WARNING';
  return 'ONLINE';
}

export function buildSystemSnapshot(input: SystemSnapshotInput): Subsystem[] {
  const prov = { ...M2A_PROVENANCE, ...(input.provenance ?? {}) };
  const health = input.deviceHealth ?? {};
  const out: Subsystem[] = [];

  /**
   * Salud de un dispositivo del edificio. Mientras la procedencia sea
   * SIMULATED no hay nada que consultar: nadie lo midio, asi que la salud es
   * ONLINE por defecto y lo que comunica la incertidumbre es `provenance`.
   */
  const healthOf = (id: SubsystemId): DeviceHealth => health[id] ?? 'ONLINE';
  const noteOf = (id: SubsystemId): string => (prov[id] === 'SIMULATED' ? SIM_NOTE : '');

  for (const { id, screen, label } of SCREEN_MAP) {
    const rt = input.show?.screens[screen];
    const failed = rt?.source ? input.mediaErrors.includes(rt.source) : false;

    // El estado logico sale del motor tal cual. Un clip que no carga es un
    // problema de CONTENIDO, no del dispositivo.
    const logicalState: LogicalState = !input.show
      ? 'IDLE'
      : rt?.output === 'live'
        ? 'LIVE'
        : rt?.output === 'hold'
          ? 'HOLD'
          : 'BLACK';

    out.push({
      id,
      label,
      group: 'media',
      logicalState,
      health: healthOf(id),
      provenance: prov[id],
      detail: failed
        ? 'El clip asignado no carga'
        : input.safeMode
          ? 'Negro forzado por modo seguro'
          : rt
            ? `clip ${(rt.mediaTimeMs / 1000).toFixed(1)} s · cue ${rt.cue}`
            : 'Sin show cargado',
      healthDetail: noteOf(id),
    });
  }

  const zones = input.show ? Object.values(input.show.zones) : [];
  const encendidas = zones.filter((z) => z.enabled && z.intensity > 0.01).length;
  out.push({
    id: 'lighting_architectural',
    label: 'Iluminacion arquitectonica',
    group: 'lighting',
    logicalState: zones.length === 0 ? 'IDLE' : encendidas === 0 ? 'BLACK' : 'LIVE',
    health: healthOf('lighting_architectural'),
    provenance: prov.lighting_architectural,
    detail: input.safeMode
      ? 'Escena segura calida'
      : `${encendidas}/${zones.length} zonas activas · escena ${input.show?.lightingSceneId ?? '—'}`,
    healthDetail: noteOf('lighting_architectural'),
  });

  // "RGBW" es el mismo parque de luminarias visto por su capacidad de color.
  // Se lista aparte porque operativamente se pregunta distinto: no es "hay
  // luz?" sino "estamos usando color de marca?".
  const conColor = zones.filter(
    (z) => z.enabled && z.color.r + z.color.g + z.color.b > 0.05 && z.color.w < 0.5,
  ).length;
  out.push({
    id: 'lighting_rgbw',
    label: 'Iluminacion RGBW',
    group: 'lighting',
    logicalState: zones.length === 0 ? 'IDLE' : conColor > 0 ? 'LIVE' : 'HOLD',
    health: healthOf('lighting_rgbw'),
    provenance: prov.lighting_rgbw,
    detail: input.safeMode
      ? 'Sin color: blanco calido seguro'
      : conColor > 0
        ? `${conColor} zonas con color de marca`
        : 'Todas en blanco calido',
    healthDetail: noteOf('lighting_rgbw'),
  });

  out.push({
    id: 'clock',
    label: 'Reloj',
    group: 'clock',
    logicalState: !input.show ? 'IDLE' : input.show.clockState === 'off' ? 'BLACK' : 'LIVE',
    health: healthOf('clock'),
    provenance: prov.clock,
    detail: input.show
      ? `Estado ${input.show.clockState} · brillo ${(input.show.clockIntensity * 100).toFixed(0)} %`
      : 'Sin show cargado',
    healthDetail: noteOf('clock'),
  });

  out.push({
    id: 'edge',
    label: 'TRUST EDGE',
    group: 'system',
    logicalState: 'IDLE',
    health: prov.edge === 'SIMULATED' ? 'OFFLINE' : healthOf('edge'),
    provenance: prov.edge,
    detail: 'No hay EDGE desplegado',
    healthDetail: prov.edge === 'SIMULATED' ? 'Servicio no implementado todavia' : '',
  });

  out.push({
    id: 'connectivity',
    label: 'Conectividad',
    group: 'system',
    logicalState: 'IDLE',
    health: input.controlReachable ? healthOf('connectivity') : 'OFFLINE',
    provenance: prov.connectivity,
    detail: input.controlReachable
      ? 'CONTROL alcanzable (simulado)'
      : 'DEGRADED_OFFLINE — la programacion cacheada continua',
    healthDetail: input.controlReachable ? noteOf('connectivity') : '',
  });

  /*
   * M2A.2 / punto 2: una sola fuente. `deriveElectricalHealth` combina calidad
   * del dato y alarmas del registro; `telemetry.status` no se consulta.
   */
  const sample = input.sample;
  const t = sample?.telemetry ?? null;
  const electricalHealth = deriveElectricalHealth(sample, input.alarms);
  const criticas = input.alarms.filter((a) => a.severity === 'critical');

  out.push({
    id: 'electrical',
    label: 'Sistema electrico',
    group: 'energy',
    logicalState: t ? 'LIVE' : 'IDLE',
    health: electricalHealth,
    provenance: prov.electrical,
    detail: t
      ? `${t.activePowerKw.toFixed(1)} kW · PF ${t.powerFactor.toFixed(2)} · ${t.frequencyHz.toFixed(2)} Hz`
      : 'Sin telemetria',
    healthDetail: !sample
      ? 'Sin muestras'
      : criticas.length > 0
        ? `${criticas.length} alarma(s) critica(s): ${criticas.map((a) => a.alarm.code).join(', ')}`
        : sample.quality === 'STALE'
          ? `Ultima lectura hace ${(sample.ageMs / 1000).toFixed(0)} s`
          : sample.quality === 'COMM_ERROR'
            ? 'Error de comunicacion con el medidor'
            : sample.quality === 'NO_DATA'
              ? 'El medidor nunca entrego datos'
              : input.alarms.length > 0
                ? `${input.alarms.length} alarma(s) activa(s)`
                : noteOf('electrical'),
  });

  return out;
}

/** Peor salud del conjunto. Para el semaforo del header. */
export function worstDeviceHealth(subsystems: readonly Subsystem[]): DeviceHealth {
  const order: DeviceHealth[] = ['CRITICAL', 'OFFLINE', 'STALE', 'WARNING', 'ONLINE'];
  for (const s of order) {
    if (subsystems.some((x) => x.health === s)) return s;
  }
  return 'ONLINE';
}

/**
 * True si algun dispositivo esta verificado de verdad. En M2A: false.
 *
 * M2A.2 / punto 3: mira SOLO `provenance`. Una falla simulada, por critica que
 * sea, no puede volver esto true — si pudiera, una alarma de mentira
 * convertiria el panel en "verificado".
 */
export function hasVerifiedDevices(subsystems: readonly Subsystem[]): boolean {
  return subsystems.some((s) => PROVENANCE_IS_VERIFIED[s.provenance]);
}

/** Cuantos subsistemas son simulados. Para el aviso permanente de la UI. */
export function simulatedCount(subsystems: readonly Subsystem[]): number {
  return subsystems.filter((s) => s.provenance === 'SIMULATED').length;
}
