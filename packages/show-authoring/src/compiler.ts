import {
  parseShowPackage,
  uvFromPixels,
  type BuildingConfig,
  type ScreenId,
  type ShowEvent,
  type ShowPackage,
} from '@trust/shared-types';
import type { AssetRegistry } from './asset-registry';
import {
  momentSpans,
  totalDurationMs,
  type ScreenDirective,
  type TakeoverDraft,
} from './draft-schema';

/**
 * COMPILADOR — TakeoverDraft → ShowPackage.
 *
 * Determinista: el mismo draft produce el mismo paquete, byte a byte. Es la
 * misma disciplina que ADR-001 en el motor, y acá importa por una razón
 * concreta: si compilar dos veces diera resultados distintos, el JSON que se
 * aprueba con un cliente no sería el que después se ejecuta.
 *
 * El compilador emite eventos y nada más. No tiene noción de UI, de selección,
 * de colores del editor ni de nada visual: eso se queda del lado del builder.
 */

/** Grupo que usa el compilador para las torres. Fijo: hay uno solo. */
export const TOWERS_GROUP = 'towers';

export interface CompileContext {
  building: BuildingConfig;
  assets: AssetRegistry;
  /** Escenas válidas. Se valida contra el catálogo real, no contra una copia. */
  sceneIds: ReadonlySet<string>;
}

export interface CompileIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** Moment que lo causó, si aplica. Permite marcarlo en el timeline. */
  momentId?: string;
  momentIndex?: number;
}

export interface CompileResult {
  ok: boolean;
  /** null si hubo errores: un paquete a medias es peor que ninguno. */
  showPackage: ShowPackage | null;
  errors: CompileIssue[];
  warnings: CompileIssue[];
}

/** Estado de una superficie mientras se recorre el timeline. */
interface SurfaceState {
  playing: boolean;
  /** Offset del asset en el instante en que arrancó. */
  anchorFromMs: number;
  anchorAtMs: number;
}

export function compileTakeoverDraft(draft: TakeoverDraft, ctx: CompileContext): CompileResult {
  const errors: CompileIssue[] = [];
  const warnings: CompileIssue[] = [];
  const err = (code: string, message: string, extra: Partial<CompileIssue> = {}) =>
    errors.push({ severity: 'error', code, message, ...extra });
  const warn = (code: string, message: string, extra: Partial<CompileIssue> = {}) =>
    warnings.push({ severity: 'warning', code, message, ...extra });

  /* ── Estructura ──────────────────────────────────────────────── */

  if (draft.moments.length === 0) {
    err('NO_MOMENTS', 'La campaña no tiene ningún moment: no hay nada que compilar.');
  }
  if (!ctx.sceneIds.has(draft.closingSceneId)) {
    err('CLOSING_SCENE_NOT_FOUND', `La escena de cierre "${draft.closingSceneId}" no existe.`);
  }

  const vistos = new Set<string>();
  for (const m of draft.moments) {
    if (vistos.has(m.id)) err('DUPLICATE_MOMENT_ID', `Hay dos moments con el id "${m.id}".`);
    vistos.add(m.id);
  }

  /* ── Assets de la campaña ────────────────────────────────────── */

  const { surfaces } = draft;
  const master = ctx.assets.get(surfaces.masterAssetId);
  const corrientes = ctx.assets.get(surfaces.corrientesAssetId);
  const pellegrini = ctx.assets.get(surfaces.pellegriniAssetId);
  const horizontal = ctx.assets.get(surfaces.horizontalAssetId);

  const usaTorres = draft.moments.some((m) =>
    surfaces.upperMode === 'master'
      ? m.screens.upper.mode !== 'hold'
      : m.screens.corrientes.mode !== 'hold' || m.screens.pellegrini.mode !== 'hold',
  );
  const usaHorizontal = draft.moments.some((m) => m.screens.horizontal.mode !== 'hold');

  if (surfaces.upperMode === 'master') {
    if (usaTorres && !master) {
      err('MASTER_ASSET_MISSING', 'Modo A+B Master sin asset de master asignado.');
    }
    if (master?.unmanaged) {
      err('ASSET_UNMANAGED', `"${master.name}" es un archivo local sin registrar: no se puede exportar.`);
    }
  } else {
    if (usaTorres && !corrientes) err('ASSET_MISSING', 'Falta el asset de Corrientes.');
    if (usaTorres && !pellegrini) err('ASSET_MISSING', 'Falta el asset de Pellegrini.');
    for (const a of [corrientes, pellegrini]) {
      if (a?.unmanaged) err('ASSET_UNMANAGED', `"${a.name}" no está registrado: no se puede exportar.`);
    }
  }
  if (usaHorizontal && !horizontal) err('ASSET_MISSING', 'Falta el asset de la pantalla horizontal.');
  if (horizontal?.unmanaged) {
    err('ASSET_UNMANAGED', `"${horizontal.name}" no está registrado: no se puede exportar.`);
  }

  /*
   * La horizontal en el grupo de frame-lock depende de que comparta procesador
   * y reloj con A y B, y eso NO está confirmado. Se permite como preview
   * conceptual, nunca como capacidad afirmada.
   */
  if (surfaces.includeHorizontalInMaster) {
    warn(
      'SYNC_HARDWARE_NOT_VERIFIED',
      'SYNC HARDWARE NOT VERIFIED — que la horizontal comparta decoder con A+B no está confirmado con el integrador. Sirve para mostrar la idea, no para venderla como frame-lock.',
    );
    if (surfaces.upperMode !== 'master') {
      err(
        'HORIZONTAL_GROUP_REQUIRES_MASTER',
        'Para incluir la horizontal en el grupo hace falta que las torres estén en modo A+B Master.',
      );
    }
  }

  /* ── Eventos ─────────────────────────────────────────────────── */

  const timeline: ShowEvent[] = [];
  const estadoDe = (id: ScreenId): SurfaceState => estado[id] ?? { playing: false, anchorFromMs: 0, anchorAtMs: 0 };
  const estado: Record<ScreenId, SurfaceState> = {
    screen_a: { playing: false, anchorFromMs: 0, anchorAtMs: 0 },
    screen_b: { playing: false, anchorFromMs: 0, anchorAtMs: 0 },
    horizontal: { playing: false, anchorFromMs: 0, anchorAtMs: 0 },
  };
  let escenaActual: string | null = null;
  let relojActual: string | null = null;
  /** Ms máximos de cada asset que la campaña llega a consumir. */
  const consumoMs: Partial<Record<ScreenId, number>> = {};

  const aplicarPantalla = (
    screenId: ScreenId,
    directive: ScreenDirective,
    atMs: number,
    span: { momentId: string; index: number },
  ) => {
    const s = estadoDe(screenId);
    switch (directive.mode) {
      case 'hold':
        // Nada. La ausencia de evento ES la continuidad: el motor conserva el
        // estado anterior por construcción (ADR-001).
        break;
      case 'black':
        if (s.playing) {
          timeline.push({ atMs, type: 'media.stop', target: screenId });
          s.playing = false;
        } else if (atMs === 0) {
          // A los 0 ms nada está reproduciendo: `black` ya es el estado.
        }
        break;
      case 'play': {
        timeline.push({ atMs, type: 'media.play', target: screenId, fromMs: directive.fromMs });
        s.playing = true;
        s.anchorFromMs = directive.fromMs;
        s.anchorAtMs = atMs;
        void span;
        break;
      }
    }
  };

  const spans = momentSpans(draft);

  for (const { moment, index, startMs, endMs } of spans) {
    const ref = { momentId: moment.id, index };

    if (surfaces.upperMode === 'master') {
      // Ambas torres reciben EXACTAMENTE el mismo cue: comparten decoder, y
      // cues distintos las separarían rompiendo el frame-lock.
      aplicarPantalla('screen_a', moment.screens.upper, startMs, ref);
      aplicarPantalla('screen_b', moment.screens.upper, startMs, ref);
    } else {
      aplicarPantalla('screen_a', moment.screens.corrientes, startMs, ref);
      aplicarPantalla('screen_b', moment.screens.pellegrini, startMs, ref);
    }
    aplicarPantalla('horizontal', moment.screens.horizontal, startMs, ref);

    if (moment.lighting.mode === 'scene') {
      const { sceneId, fadeMs } = moment.lighting;
      if (!ctx.sceneIds.has(sceneId)) {
        err('SCENE_NOT_FOUND', `La escena "${sceneId}" no existe en el catálogo.`, ref);
      } else if (sceneId !== escenaActual) {
        timeline.push(
          fadeMs === undefined
            ? { atMs: startMs, type: 'lighting.scene', value: sceneId }
            : { atMs: startMs, type: 'lighting.scene', value: sceneId, fadeMs },
        );
        escenaActual = sceneId;
      }
      if (fadeMs !== undefined && fadeMs > moment.durationMs) {
        warn(
          'FADE_LONGER_THAN_MOMENT',
          `El fade de "${moment.name}" (${fadeMs} ms) es más largo que el moment (${moment.durationMs} ms): no llega a completarse.`,
          ref,
        );
      }
    }

    if (moment.clock.mode === 'state' && moment.clock.value !== relojActual) {
      timeline.push({ atMs: startMs, type: 'clock.state', value: moment.clock.value });
      relojActual = moment.clock.value;
    }

    // Cuánto del asset se consume: para avisar si el clip es más corto.
    for (const id of ['screen_a', 'screen_b', 'horizontal'] as ScreenId[]) {
      const s = estadoDe(id);
      if (s.playing) {
        const usado = s.anchorFromMs + (endMs - s.anchorAtMs);
        consumoMs[id] = Math.max(consumoMs[id] ?? 0, usado);
      }
    }
  }

  const durationMs = totalDurationMs(draft);

  /* ── Cierre ──────────────────────────────────────────────────── */

  if (durationMs > 0) {
    // El edificio vuelve a su identidad al terminar. Sin esto queda con la
    // iluminación de la marca puesta fuera de pauta (preflight lo marca).
    if (escenaActual !== draft.closingSceneId) {
      /*
       * `fadeMs: 0` a proposito. Un evento en el ULTIMO ms no tiene tiempo de
       * fundir: con el fade propio de la escena, en `durationMs` el progreso es
       * 0 y el edificio queda mostrando la escena de marca. Preflight lo marca
       * como ENDS_IN_TAKEOVER, con razon.
       *
       * Si la campania quiere una vuelta suave, tiene que declararla como un
       * moment de salida. Esto es la red de seguridad, no la transicion.
       */
      timeline.push({ atMs: durationMs, type: 'lighting.scene', value: draft.closingSceneId, fadeMs: 0 });
    }
    if (relojActual !== null && relojActual !== 'normal') {
      timeline.push({ atMs: durationMs, type: 'clock.state', value: 'normal' });
    }
    // Y ninguna pantalla queda con contenido colgado.
    for (const id of ['screen_a', 'screen_b', 'horizontal'] as ScreenId[]) {
      if (estadoDe(id).playing) timeline.push({ atMs: durationMs, type: 'media.stop', target: id });
    }
  }

  /* ── Avisos de duración de clip ──────────────────────────────── */

  const assetDe = (id: ScreenId) =>
    surfaces.upperMode === 'master' && id !== 'horizontal'
      ? master
      : id === 'screen_a'
        ? corrientes
        : id === 'screen_b'
          ? pellegrini
          : horizontal;

  for (const [id, usado] of Object.entries(consumoMs)) {
    const asset = assetDe(id as ScreenId);
    if (asset?.durationMs !== undefined && usado > asset.durationMs) {
      warn(
        'ASSET_TOO_SHORT',
        `La campaña usa "${asset.name}" hasta ${(usado / 1000).toFixed(1)} s pero el clip dura ${(asset.durationMs / 1000).toFixed(1)} s.`,
      );
    }
  }

  if (errors.length > 0) return { ok: false, showPackage: null, errors, warnings };

  /* ── Media y grupos ──────────────────────────────────────────── */

  const media: Record<string, string> = {};
  const mediaGroups: Record<string, unknown> = {};

  if (surfaces.upperMode === 'master' && master) {
    const canvas = { width: master.width, height: master.height };
    const a = ctx.building.screens.find((s) => s.id === 'screen_a');
    const b = ctx.building.screens.find((s) => s.id === 'screen_b');
    const h = ctx.building.screens.find((s) => s.id === 'horizontal');
    if (!a || !b) {
      err('BUILDING_SCREENS_MISSING', 'La configuración del edificio no declara las torres.');
      return { ok: false, showPackage: null, errors, warnings };
    }

    // El reparto sale de los píxeles REALES de cada superficie, no de una
    // fracción inventada: así el aspecto de cada recorte coincide con el
    // físico y preflight no lo rechaza.
    const layout: Record<string, ReturnType<typeof uvFromPixels>> = {
      screen_a: uvFromPixels(canvas, { x: 0, y: 0, width: a.pixelWidth, height: a.pixelHeight }),
      screen_b: uvFromPixels(canvas, {
        x: a.pixelWidth,
        y: 0,
        width: b.pixelWidth,
        height: b.pixelHeight,
      }),
    };
    if (surfaces.includeHorizontalInMaster && h) {
      layout.horizontal = uvFromPixels(canvas, {
        x: 0,
        y: a.pixelHeight,
        width: h.pixelWidth,
        height: h.pixelHeight,
      });
    }
    mediaGroups[TOWERS_GROUP] = { source: master.source, canvas, layout };
  } else {
    if (corrientes) media.screen_a = corrientes.source;
    if (pellegrini) media.screen_b = pellegrini.source;
  }

  if (horizontal && !(surfaces.includeHorizontalInMaster && surfaces.upperMode === 'master')) {
    media.horizontal = horizontal.source;
  }

  /* ── Paquete ─────────────────────────────────────────────────── */

  const raw = {
    id: draft.id,
    name: draft.campaignName || draft.name,
    version: 1,
    durationMs: Math.max(1, durationMs),
    media,
    mediaGroups,
    initialState: {
      lightingScene: firstScene(draft) ?? draft.closingSceneId,
      clockState: 'normal',
      camera: 'hero_obelisco',
    },
    // Orden estable: por tiempo y, a igual tiempo, por orden de emisión.
    timeline,
  };

  const parsed = parseShowPackageSafe(raw);
  if (!parsed.ok) {
    err('SHOW_PACKAGE_INVALID', parsed.message);
    return { ok: false, showPackage: null, errors, warnings };
  }

  return { ok: true, showPackage: parsed.value, errors, warnings };
}

/** Escena del primer moment que la declara, para el initialState. */
function firstScene(draft: TakeoverDraft): string | null {
  for (const m of draft.moments) {
    if (m.lighting.mode === 'scene') return m.lighting.sceneId;
  }
  return null;
}

function parseShowPackageSafe(
  raw: unknown,
): { ok: true; value: ShowPackage } | { ok: false; message: string } {
  try {
    return { ok: true, value: parseShowPackage(raw) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
