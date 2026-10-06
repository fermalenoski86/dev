import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────
 * IDs estables. Cambiar uno de estos rompe show packages viejos:
 * cualquier cambio acá exige bump de version en ShowPackage.
 * ──────────────────────────────────────────────────────────────── */

export const ScreenIdSchema = z.enum(['screen_a', 'screen_b', 'horizontal']);
export type ScreenId = z.infer<typeof ScreenIdSchema>;

export const LightingZoneIdSchema = z.enum([
  'dome',
  'clock',
  'tower_upper',
  'tower_mid',
  'corrientes_left',
  'corrientes_right',
  'chamfer',
  'pellegrini_left',
  'pellegrini_right',
  'arches_upper',
  'arches_lower',
  'base',
]);
export type LightingZoneId = z.infer<typeof LightingZoneIdSchema>;

export const CameraIdSchema = z.enum(['hero_obelisco', 'hero_3d', 'street_corrientes']);
export type CameraId = z.infer<typeof CameraIdSchema>;

export const ClockStateSchema = z.enum(['normal', 'off', 'accent', 'countdown']);
export type ClockState = z.infer<typeof ClockStateSchema>;

/* ────────────────────────────────────────────────────────────────
 * Modelo físico del edificio
 * ──────────────────────────────────────────────────────────────── */

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3Schema>;

/** RGBW normalizado 0..1. W separado porque las luminarias reales son RGBW,
 *  y el blanco dedicado es lo que evita el look "discoteca". */
export const RgbwSchema = z.object({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
});
export type Rgbw = z.infer<typeof RgbwSchema>;

/**
 * Recorte normalizado dentro de una fuente de video compartida.
 *
 * REVIEW-003 / P1-5: limitar cada componente a 0..1 no alcanza. Un rect con
 * x=0.8 y w=0.5 se sale de la textura y three lo envuelve, asi que la pantalla
 * mostraria el borde opuesto del master pegado al final. Falla en silencio.
 */
export const UvRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
  })
  .refine((r) => r.w > 0 && r.h > 0, {
    message: 'el recorte no puede tener ancho o alto cero',
  })
  .refine((r) => r.x + r.w <= 1 + 1e-9, {
    message: 'el recorte se sale del borde derecho de la fuente (x + w > 1)',
  })
  .refine((r) => r.y + r.h <= 1 + 1e-9, {
    message: 'el recorte se sale del borde superior de la fuente (y + h > 1)',
  });
export type UvRect = z.infer<typeof UvRectSchema>;
export const FULL_FRAME: UvRect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Convierte un recorte en pixeles del lienzo (origen ARRIBA a la izquierda,
 * como piensa quien produce el contenido) a UV de textura (origen ABAJO a la
 * izquierda, como muestrea three con flipY). Asi nadie tiene que invertir el
 * eje Y a mano en un JSON.
 */
export function uvFromPixels(
  canvas: { width: number; height: number },
  rect: { x: number; y: number; width: number; height: number },
): UvRect {
  return {
    x: rect.x / canvas.width,
    y: (canvas.height - rect.y - rect.height) / canvas.height,
    w: rect.width / canvas.width,
    h: rect.height / canvas.height,
  };
}

export const ScreenSurfaceSchema = z.object({
  id: ScreenIdSchema,
  name: z.string(),
  physicalWidthM: z.number().positive(),
  physicalHeightM: z.number().positive(),
  pixelWidth: z.number().int().positive(),
  pixelHeight: z.number().int().positive(),
  pixelPitchMm: z.number().positive().optional(),
  /** Posición y rotación en el digital twin. Reemplazable por GLB real. */
  position: Vec3Schema,
  rotationY: z.number().default(0),
  mediaSource: z.string().optional(),
  enabled: z.boolean().default(true),
  /**
   * CAPACIDAD fisica de compartir decoder: con que otras superficies esta
   * pantalla puede reproducir un unico master frame-locked (mismo procesador,
   * mismo reloj de video, latencia equivalente).
   *
   * Esto es del edificio y no cambia entre campanias. La MEMBRESIA de cada
   * grupo (quien comparte decoder en ESTA campania) la define el show en
   * `mediaGroups`. Ver ADR-013.
   */
  syncCapableWith: z.array(ScreenIdSchema).default([]),
});
export type ScreenSurface = z.infer<typeof ScreenSurfaceSchema>;

export const LightingZoneSchema = z.object({
  id: LightingZoneIdSchema,
  name: z.string(),
  intensity: z.number().min(0).max(1),
  color: RgbwSchema,
  enabled: z.boolean().default(true),
  /** Meshes del twin que esta zona ilumina. En EDGE mapea a universos DMX. */
  targetIds: z.array(z.string()).default([]),
});
export type LightingZone = z.infer<typeof LightingZoneSchema>;

export const CameraPresetSchema = z.object({
  id: CameraIdSchema,
  name: z.string(),
  position: Vec3Schema,
  target: Vec3Schema,
  fov: z.number().positive(),
  /** hero_3d es fija: el contenido anamórfico se genera para este punto de vista. */
  locked: z.boolean().default(false),
});
export type CameraPreset = z.infer<typeof CameraPresetSchema>;

export const BuildingConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  screens: z.array(ScreenSurfaceSchema),
  lightingZones: z.array(LightingZoneSchema),
  cameras: z.array(CameraPresetSchema),
});
export type BuildingConfig = z.infer<typeof BuildingConfigSchema>;

/* ────────────────────────────────────────────────────────────────
 * Escenas de iluminación
 * ──────────────────────────────────────────────────────────────── */

export const LightingSceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Zonas no mencionadas quedan como estaban: las escenas son parciales a propósito. */
  zones: z.record(
    LightingZoneIdSchema,
    z.object({
      intensity: z.number().min(0).max(1),
      color: RgbwSchema,
      enabled: z.boolean().optional(),
    }),
  ),
  /** Fade por defecto de la escena, en ms. La estética TRUST es de fades largos. */
  fadeMs: z.number().int().min(0).default(2000),
});
export type LightingScene = z.infer<typeof LightingSceneSchema>;

/* ────────────────────────────────────────────────────────────────
 * Eventos de timeline (v1)
 * ──────────────────────────────────────────────────────────────── */

const BaseEvent = z.object({ atMs: z.number().int().min(0) });

export const ShowEventSchema = z.discriminatedUnion('type', [
  BaseEvent.extend({ type: z.literal('media.play'), target: ScreenIdSchema, fromMs: z.number().int().min(0).default(0) }),
  BaseEvent.extend({ type: z.literal('media.pause'), target: ScreenIdSchema }),
  BaseEvent.extend({ type: z.literal('media.seek'), target: ScreenIdSchema, toMs: z.number().int().min(0) }),
  BaseEvent.extend({ type: z.literal('media.stop'), target: ScreenIdSchema }),
  BaseEvent.extend({ type: z.literal('lighting.scene'), value: z.string(), fadeMs: z.number().int().min(0).optional() }),
  BaseEvent.extend({
    type: z.literal('lighting.zone.set'),
    target: LightingZoneIdSchema,
    intensity: z.number().min(0).max(1).optional(),
    color: RgbwSchema.optional(),
    enabled: z.boolean().optional(),
    fadeMs: z.number().int().min(0).optional(),
  }),
  BaseEvent.extend({ type: z.literal('clock.state'), value: ClockStateSchema }),
  BaseEvent.extend({ type: z.literal('camera.switch'), value: CameraIdSchema }),
]);
export type ShowEvent = z.infer<typeof ShowEventSchema>;
export type ShowEventType = ShowEvent['type'];

/* Reservados para fases siguientes. NO implementados todavía:
 * external.trigger | artnet.scene | led.processor.command | analytics.marker */

/* ────────────────────────────────────────────────────────────────
 * SHOW PACKAGE v1 — el contrato que PREVIS, CONTROL y EDGE comparten
 * ──────────────────────────────────────────────────────────────── */

/**
 * Grupo de pantallas definido POR EL SHOW: un solo archivo, un solo decoder,
 * y un recorte UV por pantalla. El contenido anamorfico se autorea como un
 * lienzo unico y se reparte aca. La membresia es editorial (cambia por
 * campania); la capacidad fisica esta en `ScreenSurface.syncCapableWith`.
 */
export const MediaGroupSchema = z.object({
  source: z.string().min(1),
  /**
   * Tamanio del lienzo del master en px. Opcional en v1, pero si esta,
   * preflight verifica que cada recorte respete el aspecto fisico de su
   * pantalla (un recorte con otro aspecto se ve estirado en el edificio).
   */
  canvas: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .optional(),
  layout: z.record(ScreenIdSchema, UvRectSchema),
});
export type MediaGroup = z.infer<typeof MediaGroupSchema>;

export const ShowPackageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.literal(1),
  durationMs: z.number().int().positive(),
  media: z.record(ScreenIdSchema, z.string()).default({}),
  /** Grupos con fuente unica. Tienen prioridad sobre `media` para sus miembros. */
  mediaGroups: z.record(z.string(), MediaGroupSchema).default({}),
  initialState: z.object({
    lightingScene: z.string(),
    clockState: ClockStateSchema.default('normal'),
    camera: CameraIdSchema.optional(),
  }),
  timeline: z.array(ShowEventSchema).default([]),
});
export type ShowPackage = z.infer<typeof ShowPackageSchema>;

/** Punto único de entrada de datos externos. Nunca parsear JSON a mano. */
export function parseShowPackage(input: unknown): ShowPackage {
  return ShowPackageSchema.parse(input);
}

export function safeParseShowPackage(input: unknown) {
  return ShowPackageSchema.safeParse(input);
}

/* ────────────────────────────────────────────────────────────────
 * Estado resuelto del show en un instante t
 * ──────────────────────────────────────────────────────────────── */

/**
 * REVIEW-002 / P0-2. Tres conceptos que antes vivian todos en `playing`:
 *
 *  - `cue`    lo que comando el timeline (media.play / pause / stop)
 *  - transporte  si el show corre (lo sabe ShowEngine, no el timeline)
 *  - `output` lo que efectivamente se ve
 *
 * `output` no es sinonimo de `cue`: un show pausado tiene cue=playing y
 * output=hold. Usar `playing` como sinonimo de visibilidad fue el origen de
 * que pause, stop y SAFE MODE se vieran igual.
 */
export type ScreenCue = 'playing' | 'paused' | 'stopped';

/**
 * - `live`  reproduciendo
 * - `hold`  frame congelado (pausa de show o media.pause)
 * - `black` salida neutra (media.stop, sin fuente, fallo de clip, SAFE MODE)
 */
export type ScreenOutput = 'live' | 'hold' | 'black';

export interface ScreenRuntimeState {
  id: ScreenId;
  source: string | null;
  /** Recorte dentro de la fuente. Distinto de FULL_FRAME cuando la pantalla esta en un mediaGroup. */
  uv: UvRect;
  cue: ScreenCue;
  output: ScreenOutput;
  /** Posición del contenido dentro del clip, en ms. Determinista para cualquier t. */
  mediaTimeMs: number;
}

export interface LightingZoneRuntimeState {
  id: LightingZoneId;
  intensity: number;
  color: Rgbw;
  enabled: boolean;
}

export interface ShowRuntimeState {
  timeMs: number;
  screens: Record<ScreenId, ScreenRuntimeState>;
  zones: Record<LightingZoneId, LightingZoneRuntimeState>;
  lightingSceneId: string;
  clockState: ClockState;
  /** Brillo del reloj ya interpolado en t. El renderer no hace easing propio. */
  clockIntensity: number;
  /** Angulo de la aguja en grados, funcion del tiempo. Nunca de elapsedTime. */
  clockAngleDeg: number;
  camera: CameraId;
}

export const WARM_WHITE: Rgbw = { r: 1, g: 0.78, b: 0.48, w: 0.85 };
export const BLACK: Rgbw = { r: 0, g: 0, b: 0, w: 0 };
