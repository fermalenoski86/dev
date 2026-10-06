import {
  BuildingConfigSchema,
  LightingSceneSchema,
  type BuildingConfig,
  type LightingScene,
} from '@trust/shared-types';

/**
 * Geometría de EL TRUST. Valores configurables, nunca hardcodeados en
 * componentes visuales. Origen (0,0,0) = base del edificio en la ochava.
 * Eje -Z apunta hacia el Obelisco.
 *
 * MEDIDAS CONFIRMADAS (Gate V3.1):
 *   screen_a — Corrientes  7,68 × 3,84 m · P6.67 · 1152 × 576 px
 *   screen_b — Pellegrini  9,60 × 3,84 m · P6.67 · 1440 × 576 px
 *   Lienzo superior lógico A+B: 2592 × 576 px.
 *
 * MEDIDAS SUPUESTAS: todo lo demás, incluida la pantalla horizontal y TODA la
 * geometría del edificio. No se modela el edificio real acá: el Digital Twin
 * arquitectónico se desarrolla aparte y entra como GLB + TRUST_GEOMETRY_SPEC.
 */
export const EL_TRUST: BuildingConfig = BuildingConfigSchema.parse({
  id: 'el_trust_bsas',
  name: 'EL TRUST — Buenos Aires',
  screens: [
    {
      id: 'screen_a',
      name: 'Pantalla Superior A — Corrientes',
      physicalWidthM: 7.68,
      physicalHeightM: 3.84,
      pixelWidth: 1152,
      pixelHeight: 576,
      pixelPitchMm: 6.67,
      position: [-5.4, 46, 5.6],
      rotationY: 0,
      enabled: true,
      // Capacidad física, no membresía: quién comparte decoder lo decide cada show.
      syncCapableWith: ['screen_b', 'horizontal'],
    },
    {
      id: 'screen_b',
      name: 'Pantalla Superior B — Pellegrini',
      physicalWidthM: 9.6,
      physicalHeightM: 3.84,
      pixelWidth: 1440,
      pixelHeight: 576,
      pixelPitchMm: 6.67,
      position: [5.6, 46, -5.4],
      rotationY: Math.PI / 2,
      enabled: true,
      syncCapableWith: ['screen_a', 'horizontal'],
    },
    {
      id: 'horizontal',
      name: 'Pantalla Horizontal (existente)',
      // SUPUESTO: dimensiones no cerradas. Superficie configurable.
      physicalWidthM: 14,
      physicalHeightM: 3,
      pixelWidth: 1920,
      pixelHeight: 412,
      position: [0, 16, 0],
      rotationY: -Math.PI / 4,
      enabled: true,
      // SUPUESTO: que la horizontal comparta procesador/reloj de video con A y B.
      // Confirmar con el integrador antes de vender un takeover A+B+horizontal
      // frame-locked. Si no se cumple, se saca de acá y preflight lo bloquea.
      syncCapableWith: ['screen_a', 'screen_b'],
    },
  ],
  lightingZones: [
    zone('dome', 'Cúpula', ['mesh_dome'], 0.75),
    zone('clock', 'Reloj', ['mesh_clock'], 0.8),
    zone('tower_upper', 'Torre superior', ['mesh_tower_u'], 0.55),
    zone('tower_mid', 'Torre media', ['mesh_tower_m'], 0.45),
    zone('corrientes_left', 'Corrientes izq.', ['mesh_corr_l'], 0.4),
    zone('corrientes_right', 'Corrientes der.', ['mesh_corr_r'], 0.4),
    zone('chamfer', 'Ochava', ['mesh_chamfer'], 0.5),
    zone('pellegrini_left', 'Pellegrini izq.', ['mesh_pell_l'], 0.4),
    zone('pellegrini_right', 'Pellegrini der.', ['mesh_pell_r'], 0.4),
    zone('arches_upper', 'Arcadas superiores', ['mesh_arch_u'], 0.5),
    zone('arches_lower', 'Arcadas inferiores', ['mesh_arch_l'], 0.45),
    zone('base', 'Basamento', ['mesh_base'], 0.35),
  ],
  cameras: [
    {
      id: 'hero_obelisco',
      name: 'Hero — desde el Obelisco',
      position: [6, 22, 78],
      target: [0, 30, 0],
      fov: 38,
      locked: false,
    },
    {
      // Cámara FIJA. El contenido anamórfico de fase 2 se genera para este punto
      // de vista exacto: mover esta cámara invalida el contenido 3D.
      id: 'hero_3d',
      name: 'Hero 3D — punto anamórfico',
      position: [34, 34, 34],
      target: [0, 40, 0],
      fov: 30,
      locked: true,
    },
    {
      id: 'street_corrientes',
      name: 'Calle — Corrientes',
      position: [-4, 2, 36],
      target: [0, 34, 0],
      fov: 52,
      locked: false,
    },
  ],
});

function zone(id: string, name: string, targetIds: string[], intensity: number) {
  return {
    id,
    name,
    intensity,
    color: { r: 1, g: 0.78, b: 0.48, w: 0.85 },
    enabled: true,
    targetIds,
  };
}

/* ────────────────────────────────────────────────────────────────
 * Escenas demo.
 * Criterio TRUST: cálido como estado base, RGBW solo como acento.
 * Nunca competir con las pantallas.
 * ──────────────────────────────────────────────────────────────── */

const warm = (r: number, g: number, b: number, w: number) => ({ r, g, b, w });

export const TRUST_NORMAL: LightingScene = LightingSceneSchema.parse({
  id: 'trust_normal',
  name: 'TRUST Normal — cálida y elegante',
  fadeMs: 3000,
  zones: {
    dome: { intensity: 0.85, color: warm(1, 0.8, 0.52, 0.9) },
    clock: { intensity: 0.9, color: warm(1, 0.82, 0.55, 0.95) },
    tower_upper: { intensity: 0.6, color: warm(1, 0.78, 0.48, 0.85) },
    tower_mid: { intensity: 0.5, color: warm(1, 0.78, 0.48, 0.85) },
    corrientes_left: { intensity: 0.42, color: warm(1, 0.76, 0.46, 0.8) },
    corrientes_right: { intensity: 0.42, color: warm(1, 0.76, 0.46, 0.8) },
    chamfer: { intensity: 0.55, color: warm(1, 0.78, 0.5, 0.85) },
    pellegrini_left: { intensity: 0.42, color: warm(1, 0.76, 0.46, 0.8) },
    pellegrini_right: { intensity: 0.42, color: warm(1, 0.76, 0.46, 0.8) },
    arches_upper: { intensity: 0.5, color: warm(1, 0.78, 0.5, 0.82) },
    arches_lower: { intensity: 0.45, color: warm(1, 0.78, 0.5, 0.82) },
    base: { intensity: 0.35, color: warm(1, 0.74, 0.44, 0.75) },
  },
});

export const MCD_RED_GOLD: LightingScene = LightingSceneSchema.parse({
  id: 'mcd_red_gold',
  name: 'Takeover — Rojo y Dorado',
  fadeMs: 2500,
  zones: {
    // La cúpula y el reloj se mantienen dorados: son la firma del edificio,
    // no se ceden al anunciante.
    dome: { intensity: 0.9, color: warm(1, 0.72, 0.18, 0.35) },
    clock: { intensity: 0.85, color: warm(1, 0.75, 0.22, 0.4) },
    tower_upper: { intensity: 0.7, color: warm(0.95, 0.1, 0.06, 0.05) },
    tower_mid: { intensity: 0.6, color: warm(0.95, 0.1, 0.06, 0.05) },
    corrientes_left: { intensity: 0.5, color: warm(0.9, 0.12, 0.08, 0.05) },
    corrientes_right: { intensity: 0.5, color: warm(0.9, 0.12, 0.08, 0.05) },
    chamfer: { intensity: 0.65, color: warm(1, 0.68, 0.16, 0.3) },
    pellegrini_left: { intensity: 0.5, color: warm(0.9, 0.12, 0.08, 0.05) },
    pellegrini_right: { intensity: 0.5, color: warm(0.9, 0.12, 0.08, 0.05) },
    arches_upper: { intensity: 0.55, color: warm(1, 0.66, 0.15, 0.25) },
    arches_lower: { intensity: 0.5, color: warm(1, 0.66, 0.15, 0.25) },
    base: { intensity: 0.4, color: warm(0.85, 0.15, 0.1, 0.1) },
  },
});

/**
 * SAFE MODE — primitiva del sistema, no una escena más.
 *
 * Estado al que cae el edificio ante un fallo LOCAL: watchdog de EDGE, botón
 * físico, clip inválido, fallo de comunicación con procesadores, o vencimiento
 * del lease de operación.
 *
 * La pérdida de internet o de CONTROL NO dispara esto: eso es DEGRADED_OFFLINE
 * y la programación local cacheada continúa. Definición canónica en
 * docs/architecture/OPERATING_STATES.md.
 */
export const SAFE_MODE: LightingScene = LightingSceneSchema.parse({
  id: 'safe_mode',
  name: 'SAFE MODE',
  fadeMs: 1500,
  zones: {
    dome: { intensity: 0.7, color: warm(1, 0.8, 0.55, 0.95) },
    clock: { intensity: 0.8, color: warm(1, 0.82, 0.58, 1) },
    tower_upper: { intensity: 0.5, color: warm(1, 0.8, 0.55, 0.95) },
    tower_mid: { intensity: 0.45, color: warm(1, 0.8, 0.55, 0.95) },
    corrientes_left: { intensity: 0.4, color: warm(1, 0.8, 0.55, 0.95) },
    corrientes_right: { intensity: 0.4, color: warm(1, 0.8, 0.55, 0.95) },
    chamfer: { intensity: 0.45, color: warm(1, 0.8, 0.55, 0.95) },
    pellegrini_left: { intensity: 0.4, color: warm(1, 0.8, 0.55, 0.95) },
    pellegrini_right: { intensity: 0.4, color: warm(1, 0.8, 0.55, 0.95) },
    arches_upper: { intensity: 0.4, color: warm(1, 0.8, 0.55, 0.95) },
    arches_lower: { intensity: 0.4, color: warm(1, 0.8, 0.55, 0.95) },
    base: { intensity: 0.3, color: warm(1, 0.8, 0.55, 0.95) },
  },
});

/**
 * Acento de marca sin ceder la firma: las pantallas llevan el contenido del
 * anunciante, pero la iluminacion del edificio sigue siendo la propia. Es el
 * escalon entre no vender nada y vender el edificio entero.
 */
export const BRAND_ACCENT: LightingScene = LightingSceneSchema.parse({
  id: 'brand_accent',
  name: 'Brand — acento sutil',
  fadeMs: 3500,
  zones: {
    dome: { intensity: 0.9, color: warm(1, 0.8, 0.52, 0.9) },
    clock: { intensity: 0.92, color: warm(1, 0.82, 0.55, 0.95) },
    tower_upper: { intensity: 0.65, color: warm(1, 0.78, 0.48, 0.85) },
    tower_mid: { intensity: 0.55, color: warm(1, 0.78, 0.48, 0.85) },
    chamfer: { intensity: 0.6, color: warm(1, 0.78, 0.5, 0.85) },
    arches_upper: { intensity: 0.55, color: warm(1, 0.78, 0.5, 0.82) },
    arches_lower: { intensity: 0.5, color: warm(1, 0.78, 0.5, 0.82) },
    base: { intensity: 0.4, color: warm(1, 0.74, 0.44, 0.75) },
  },
});

/** Evento: identidad reforzada, sin marca. Mas presencia que la normal. */
export const EVENT_BRIGHT: LightingScene = LightingSceneSchema.parse({
  id: 'event_bright',
  name: 'Event — identidad reforzada',
  fadeMs: 2500,
  zones: {
    dome: { intensity: 1, color: warm(1, 0.82, 0.56, 0.95) },
    clock: { intensity: 1, color: warm(1, 0.84, 0.58, 1) },
    tower_upper: { intensity: 0.85, color: warm(1, 0.8, 0.52, 0.9) },
    tower_mid: { intensity: 0.75, color: warm(1, 0.8, 0.52, 0.9) },
    corrientes_left: { intensity: 0.65, color: warm(1, 0.78, 0.5, 0.85) },
    corrientes_right: { intensity: 0.65, color: warm(1, 0.78, 0.5, 0.85) },
    chamfer: { intensity: 0.8, color: warm(1, 0.8, 0.54, 0.9) },
    pellegrini_left: { intensity: 0.65, color: warm(1, 0.78, 0.5, 0.85) },
    pellegrini_right: { intensity: 0.65, color: warm(1, 0.78, 0.5, 0.85) },
    arches_upper: { intensity: 0.7, color: warm(1, 0.78, 0.52, 0.85) },
    arches_lower: { intensity: 0.65, color: warm(1, 0.78, 0.52, 0.85) },
    base: { intensity: 0.55, color: warm(1, 0.76, 0.48, 0.8) },
  },
});

/**
 * Iconic: el edificio solo, sin marca, con la cupula y el reloj al maximo.
 * Es el modo que construye el activo — lo que hace que la esquina valga, y
 * por lo tanto lo que despues permite cobrar un takeover caro.
 */
export const ICONIC_SIGNATURE: LightingScene = LightingSceneSchema.parse({
  id: 'iconic_signature',
  name: 'Iconic — firma del edificio',
  fadeMs: 5000,
  zones: {
    dome: { intensity: 1, color: warm(1, 0.78, 0.44, 0.88) },
    clock: { intensity: 1, color: warm(1, 0.8, 0.48, 0.92) },
    tower_upper: { intensity: 0.9, color: warm(1, 0.76, 0.42, 0.82) },
    tower_mid: { intensity: 0.7, color: warm(1, 0.76, 0.42, 0.82) },
    corrientes_left: { intensity: 0.5, color: warm(1, 0.74, 0.4, 0.75) },
    corrientes_right: { intensity: 0.5, color: warm(1, 0.74, 0.4, 0.75) },
    chamfer: { intensity: 0.75, color: warm(1, 0.78, 0.46, 0.85) },
    pellegrini_left: { intensity: 0.5, color: warm(1, 0.74, 0.4, 0.75) },
    pellegrini_right: { intensity: 0.5, color: warm(1, 0.74, 0.4, 0.75) },
    arches_upper: { intensity: 0.6, color: warm(1, 0.76, 0.44, 0.8) },
    arches_lower: { intensity: 0.5, color: warm(1, 0.76, 0.44, 0.8) },
    base: { intensity: 0.3, color: warm(1, 0.72, 0.38, 0.7) },
  },
});

export const DEMO_SCENES = new Map<string, LightingScene>([
  [TRUST_NORMAL.id, TRUST_NORMAL],
  [MCD_RED_GOLD.id, MCD_RED_GOLD],
  [BRAND_ACCENT.id, BRAND_ACCENT],
  [EVENT_BRIGHT.id, EVENT_BRIGHT],
  [ICONIC_SIGNATURE.id, ICONIC_SIGNATURE],
  [SAFE_MODE.id, SAFE_MODE],
]);
