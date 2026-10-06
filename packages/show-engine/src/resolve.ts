import type {
  BuildingConfig,
  LightingScene,
  LightingZoneId,
  LightingZoneRuntimeState,
  Rgbw,
  ScreenCue,
  ScreenId,
  ScreenOutput,
  ScreenRuntimeState,
  UvRect,
  ShowEvent,
  ShowPackage,
  ShowRuntimeState,
} from '@trust/shared-types';
import { FULL_FRAME } from '@trust/shared-types';

/**
 * Principio central del motor:
 *
 *   state(t) = fold(initialState, eventos con atMs <= t)
 *
 * REVIEW-001 / P0: los fades también son parte de ese estado.
 *
 * Antes, `fadeMs` estaba en el schema pero el motor aplicaba saltos y el
 * renderer inventaba la transicion con `useFrame(delta)`. Resultado: el motor
 * era determinista y la imagen no. Seekear a 25s y reproducir hasta 25s daban
 * el mismo `state` y pixeles distintos, que es exactamente el bug que el
 * determinismo pretendia evitar.
 *
 * Ahora cada zona guarda una TRANSICION (desde, hasta, cuando, cuanto) y
 * `resolveStateAt(t)` devuelve el valor YA INTERPOLADO en t. El renderer no
 * tiene semantica temporal propia: pinta lo que el motor le dice.
 */

export interface ResolveContext {
  building: BuildingConfig;
  scenes: Map<string, LightingScene>;
  /** Escena de estado seguro. Por defecto la registrada como 'safe_mode'. */
  safeSceneId?: string;
}

/**
 * REVIEW-002 / P0-1 y P0-2.
 *
 * El estado resuelto depende de t Y del estado del transporte. Un show pausado
 * en t=10000 no es lo mismo que un show corriendo en t=10000: el cue es el
 * mismo, la salida no. Se pasa explicito para que `resolveStateAt` siga siendo
 * una funcion pura de sus argumentos.
 */
export interface ResolveOptions {
  transport?: 'playing' | 'paused' | 'stopped' | 'ended';
  safeMode?: boolean;
  /** Hora de pared en ms para la aguja del reloj. Sin esto, deriva del show. */
  wallClockMs?: number;
  /** Timeline ya ordenado, de compileShow(). Evita re-ordenar en cada frame. */
  events?: readonly ShowEvent[];
}

/** Fade del brillo del reloj al cambiar de estado. */
export const CLOCK_FADE_MS = 1200;

const CLOCK_INTENSITY: Record<string, number> = {
  normal: 0.9,
  off: 0,
  accent: 1.6,
  countdown: 1.2,
};

/** Fade por defecto cuando ni el evento ni la escena declaran uno. */
export const DEFAULT_FADE_MS = 0;

interface ZoneTrack {
  fromIntensity: number;
  toIntensity: number;
  fromColor: Rgbw;
  toColor: Rgbw;
  startMs: number;
  fadeMs: number;
  enabled: boolean;
  /** Instante en que el corte duro se hace efectivo. null = no hay apagado pendiente. */
  enabledOffAtMs: number | null;
}

/** Orden total y estable: por tiempo y, a igual tiempo, por orden de declaracion. */
export function sortEvents(timeline: readonly ShowEvent[]): ShowEvent[] {
  return timeline
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.atMs - b.event.atMs || a.index - b.index)
    .map(({ event }) => event);
}

export function mixRgbw(a: Rgbw, b: Rgbw, k: number): Rgbw {
  const f = Math.min(Math.max(k, 0), 1);
  return {
    r: a.r + (b.r - a.r) * f,
    g: a.g + (b.g - a.g) * f,
    b: a.b + (b.b - a.b) * f,
    w: a.w + (b.w - a.w) * f,
  };
}

/**
 * Progreso de una transicion en el instante t. Lineal, como una consola de
 * iluminacion real (ver ADR-007). Nada de exponenciales dependientes de delta.
 */
function progress(track: ZoneTrack, t: number): number {
  if (track.fadeMs <= 0) return t >= track.startMs ? 1 : 0;
  const k = (t - track.startMs) / track.fadeMs;
  return Math.min(Math.max(k, 0), 1);
}

function sampleTrack(track: ZoneTrack, t: number): { intensity: number; color: Rgbw } {
  const k = progress(track, t);
  return {
    intensity: track.fromIntensity + (track.toIntensity - track.fromIntensity) * k,
    color: mixRgbw(track.fromColor, track.toColor, k),
  };
}

/** Arranca una transicion desde donde la zona este AHORA, aunque este a mitad de fade. */
function startTransition(
  track: ZoneTrack,
  atMs: number,
  target: { intensity?: number; color?: Rgbw; enabled?: boolean },
  fadeMs: number,
): void {
  const current = sampleTrack(track, atMs);
  track.fromIntensity = current.intensity;
  track.fromColor = current.color;
  track.toIntensity = target.intensity ?? current.intensity;
  track.toColor = target.color ?? current.color;
  track.startMs = atMs;
  track.fadeMs = Math.max(0, fadeMs);

  /*
   * REVIEW-002 / P2-9. `enabled` es un corte duro (el rele de la luminaria).
   * Apagarlo al inicio de un fade de salida corta la luz en seco y tira a la
   * basura la transicion que el show pedia. Por eso:
   *   enabled: true  -> inmediato (encender antes de subir)
   *   enabled: false -> al terminar el fade (bajar y recien ahi cortar)
   */
  if (target.enabled === true) {
    track.enabled = true;
    track.enabledOffAtMs = null;
  } else if (target.enabled === false) {
    track.enabledOffAtMs = atMs + Math.max(0, fadeMs);
  }
}

function applyScene(
  tracks: Record<LightingZoneId, ZoneTrack>,
  scene: LightingScene | undefined,
  atMs: number,
  fadeOverrideMs?: number,
): void {
  if (!scene) return;
  const fadeMs = fadeOverrideMs ?? scene.fadeMs;
  for (const [zoneId, patch] of Object.entries(scene.zones)) {
    const track = tracks[zoneId as LightingZoneId];
    if (!track || !patch) continue;
    startTransition(track, atMs, patch, fadeMs);
  }
}

function initialTracks(ctx: ResolveContext, show: ShowPackage): Record<LightingZoneId, ZoneTrack> {
  const tracks = {} as Record<LightingZoneId, ZoneTrack>;
  for (const zone of ctx.building.lightingZones) {
    tracks[zone.id] = {
      fromIntensity: zone.intensity,
      toIntensity: zone.intensity,
      fromColor: { ...zone.color },
      toColor: { ...zone.color },
      startMs: 0,
      fadeMs: 0,
      enabled: zone.enabled,
      enabledOffAtMs: null,
    };
  }
  // El estado inicial se aplica SIN fade: un show arranca ya en su estado base,
  // no fundiendo desde la configuracion de fabrica del edificio.
  applyScene(tracks, ctx.scenes.get(show.initialState.lightingScene), 0, 0);
  return tracks;
}

/**
 * Estado del show en el instante t, con las transiciones ya interpoladas.
 * Funcion pura: misma t, mismo resultado, siempre.
 */
export function resolveStateAt(
  show: ShowPackage,
  ctx: ResolveContext,
  timeMs: number,
  opts: ResolveOptions = {},
): ShowRuntimeState {
  const t = Math.floor(Math.min(Math.max(0, timeMs), show.durationMs));
  const transport = opts.transport ?? 'playing';
  const safeMode = opts.safeMode ?? false;

  /*
   * ── Fuentes ─────────────────────────────────────────────────────────────
   * La membresia de grupo la define EL SHOW (ADR-013). Una pantalla que
   * aparece en el layout de un mediaGroup toma la fuente y el recorte del
   * grupo; si no, usa `media`. Si por error aparece en dos grupos, gana el
   * primero por id ordenado: determinista aca, bloqueado por preflight antes.
   */
  const groupIds = Object.keys(show.mediaGroups).sort();
  const sourceOf = new Map<ScreenId, { source: string | null; uv: UvRect }>();
  for (const surface of ctx.building.screens) {
    let source: string | null = show.media[surface.id] ?? surface.mediaSource ?? null;
    let uv: UvRect = FULL_FRAME;
    for (const groupId of groupIds) {
      const group = show.mediaGroups[groupId];
      const rect = group?.layout[surface.id];
      if (group && rect) {
        source = group.source;
        uv = rect;
        break;
      }
    }
    sourceOf.set(surface.id, { source, uv });
  }

  const cues = {} as Record<ScreenId, { cue: ScreenCue; mediaTimeMs: number }>;
  for (const surface of ctx.building.screens) {
    cues[surface.id] = { cue: 'stopped', mediaTimeMs: 0 };
  }

  const tracks = initialTracks(ctx, show);
  let lightingSceneId = show.initialState.lightingScene;
  const safeSceneId = ctx.safeSceneId ?? 'safe_mode';
  let clockState = show.initialState.clockState;
  let camera = show.initialState.camera ?? ctx.building.cameras[0]?.id ?? 'hero_obelisco';

  // El brillo del reloj es una transicion mas, no un easing del renderer.
  let clockFrom = CLOCK_INTENSITY[show.initialState.clockState] ?? 0.9;
  let clockTo = clockFrom;
  let clockStartMs = 0;

  const playAnchor: Partial<Record<ScreenId, { atMs: number; fromMs: number }>> = {};

  // Si viene precompilado, el orden ya esta resuelto (REVIEW-003 / P1-7).
  const timeline = opts.events ?? sortEvents(show.timeline);

  for (const event of timeline) {
    if (event.atMs > t) break;

    switch (event.type) {
      case 'media.play': {
        const cue = cues[event.target];
        if (!cue) break;
        cue.cue = 'playing';
        playAnchor[event.target] = { atMs: event.atMs, fromMs: event.fromMs };
        break;
      }
      case 'media.pause': {
        const cue = cues[event.target];
        const anchor = playAnchor[event.target];
        if (!cue) break;
        if (cue.cue === 'playing' && anchor) {
          cue.mediaTimeMs = anchor.fromMs + (event.atMs - anchor.atMs);
        }
        cue.cue = 'paused';
        delete playAnchor[event.target];
        break;
      }
      case 'media.seek': {
        const cue = cues[event.target];
        if (!cue) break;
        cue.mediaTimeMs = event.toMs;
        if (cue.cue === 'playing') {
          playAnchor[event.target] = { atMs: event.atMs, fromMs: event.toMs };
        }
        break;
      }
      case 'media.stop': {
        const cue = cues[event.target];
        if (!cue) break;
        cue.cue = 'stopped';
        cue.mediaTimeMs = 0;
        delete playAnchor[event.target];
        break;
      }
      case 'lighting.scene': {
        lightingSceneId = event.value;
        applyScene(tracks, ctx.scenes.get(event.value), event.atMs, event.fadeMs);
        break;
      }
      case 'lighting.zone.set': {
        const track = tracks[event.target];
        if (!track) break;
        startTransition(
          track,
          event.atMs,
          { intensity: event.intensity, color: event.color, enabled: event.enabled },
          event.fadeMs ?? DEFAULT_FADE_MS,
        );
        break;
      }
      case 'clock.state': {
        const k =
          CLOCK_FADE_MS <= 0
            ? 1
            : Math.min(Math.max((event.atMs - clockStartMs) / CLOCK_FADE_MS, 0), 1);
        clockFrom = clockFrom + (clockTo - clockFrom) * k;
        clockTo = CLOCK_INTENSITY[event.value] ?? 0.9;
        clockStartMs = event.atMs;
        clockState = event.value;
        break;
      }
      case 'camera.switch':
        camera = event.value;
        break;
    }
  }

  for (const [screenId, anchor] of Object.entries(playAnchor)) {
    const cue = cues[screenId as ScreenId];
    if (!cue || !anchor) continue;
    cue.mediaTimeMs = anchor.fromMs + (t - anchor.atMs);
  }

  /* ── Salida de pantalla: cue + transporte + safe mode ─────────────────── */
  const screens = {} as Record<ScreenId, ScreenRuntimeState>;
  for (const surface of ctx.building.screens) {
    const cue = cues[surface.id];
    const src = sourceOf.get(surface.id);
    if (!cue || !src) continue; // ambos se poblaron arriba desde la misma lista
    screens[surface.id] = {
      id: surface.id,
      source: src.source,
      uv: src.uv,
      cue: cue.cue,
      output: deriveOutput(cue.cue, src.source, surface.enabled, transport, safeMode),
      mediaTimeMs: Math.max(0, cue.mediaTimeMs),
    };
  }

  /*
   * SAFE MODE pisa la iluminacion al final del fold, sin fade: el estado seguro
   * no se negocia con lo que el show venia haciendo.
   */
  if (safeMode) {
    lightingSceneId = safeSceneId;
    applyScene(tracks, ctx.scenes.get(safeSceneId), t, 0);
    for (const track of Object.values(tracks)) {
      track.enabled = true;
      track.enabledOffAtMs = null;
    }
  }

  /* ── Iluminacion muestreada en t ──────────────────────────────────────── */
  const zones = {} as Record<LightingZoneId, LightingZoneRuntimeState>;
  for (const [zoneId, track] of Object.entries(tracks)) {
    const sampled = sampleTrack(track, t);
    // El corte duro pendiente se hace efectivo recien al terminar el fade.
    const enabled =
      track.enabledOffAtMs !== null && t >= track.enabledOffAtMs ? false : track.enabled;
    zones[zoneId as LightingZoneId] = {
      id: zoneId as LightingZoneId,
      intensity: round(sampled.intensity),
      color: {
        r: round(sampled.color.r),
        g: round(sampled.color.g),
        b: round(sampled.color.b),
        w: round(sampled.color.w),
      },
      enabled,
    };
  }

  /* ── Reloj: todo funcion de t, nada de elapsedTime ────────────────────── */
  const clockK =
    CLOCK_FADE_MS <= 0 ? 1 : Math.min(Math.max((t - clockStartMs) / CLOCK_FADE_MS, 0), 1);
  const clockIntensity = safeMode
    ? (CLOCK_INTENSITY.normal ?? 0.9)
    : round2(clockFrom + (clockTo - clockFrom) * clockK);

  // La aguja avanza con la hora de pared si se la inyectan; si no, con el show.
  // En ambos casos es funcion pura de un numero, no del framerate.
  const clockSourceMs = opts.wallClockMs ?? t;
  const clockAngleDeg = round2(((clockSourceMs / 60000) % 60) * 6);

  return {
    timeMs: t,
    screens,
    zones,
    lightingSceneId,
    clockState: safeMode ? 'normal' : clockState,
    clockIntensity,
    clockAngleDeg,
    camera,
  };
}

/**
 * REVIEW-002 / P0-1 y P0-2. La tabla de verdad de la salida de pantalla.
 *
 * SAFE MODE gana sobre todo: negro, siempre. Dejar el 12% del ultimo frame de
 * una marca visible en un edificio en modo seguro es exactamente lo que SAFE
 * MODE existe para evitar.
 */
export function deriveOutput(
  cue: ScreenCue,
  source: string | null,
  surfaceEnabled: boolean,
  transport: NonNullable<ResolveOptions['transport']>,
  safeMode = false,
): ScreenOutput {
  if (safeMode) return 'black';
  if (!surfaceEnabled || !source) return 'black';

  /*
   * REVIEW-003 / P0-2. STOP global es BLACK, no HOLD.
   *
   * El transporte detenido significa que el show no esta al aire. Un show con
   * media.play en atMs 0 tiene cue=playing incluso en t=0, asi que sin esta
   * linea un STOP dejaba el primer frame del contenido colgado en la pantalla.
   * En el edificio eso es un frame publicitario visible fuera de pauta.
   *
   *   PAUSE global -> hold  (el operador congelo algo que esta al aire)
   *   STOP global  -> black (el show no esta al aire)
   */
  if (transport === 'stopped') return 'black';

  if (cue === 'stopped') return 'black';
  if (cue === 'paused') return 'hold';
  // cue === 'playing': solo es `live` si el show efectivamente corre.
  return transport === 'playing' ? 'live' : 'hold';
}

function round2(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** 6 decimales: mata el ruido de coma flotante sin perder resolucion util (DMX 16 bits ~ 1/65535). */
function round(v: number): number {
  return Math.round(Math.min(Math.max(v, 0), 1) * 1e6) / 1e6;
}

/** Eventos en la ventana (fromMs, toMs]. Para disparar side-effects al avanzar. */
export function eventsInWindow(show: ShowPackage, fromMs: number, toMs: number): ShowEvent[] {
  if (toMs <= fromMs) return [];
  return sortEvents(show.timeline).filter((e) => e.atMs > fromMs && e.atMs <= toMs);
}

/** RGBW a RGB aproximado, solo para el viewport. EDGE manda W por su canal real. */
export function rgbwToHex(color: Rgbw): string {
  const ch = (c: number) => {
    const v = Math.round(Math.min(1, c + color.w * 0.9) * 255);
    return v.toString(16).padStart(2, '0');
  };
  return `#${ch(color.r)}${ch(color.g)}${ch(color.b)}`;
}
