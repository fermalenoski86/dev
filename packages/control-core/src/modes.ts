import type { LightingScene, ShowRuntimeState } from '@trust/shared-types';
import { BUILDING_MODES, type BuildingMode } from './system';

/**
 * Modos del edificio → estado de preview — M2A.1 / punto 3.
 *
 * El problema que resuelve: antes el modo era una etiqueta suelta. La UI podía
 * decir `MODE = TAKEOVER` mientras el `showState` mostraba `trust_normal`,
 * porque nada conectaba una cosa con la otra. Un panel que afirma un estado
 * que su propia vista contradice es peor que un panel sin esa etiqueta.
 *
 * La solución NO es que el modo comande nada: sigue sin tocar hardware. Es
 * separar dos conceptos y mostrarlos por separado cuando difieren:
 *
 *   requestedMode        lo que el operador pidió.
 *   effectivePreviewMode lo que el estado simulado está mostrando de verdad,
 *                        derivado del propio estado, no de la intención.
 *
 * Cuando coinciden, la UI muestra uno. Cuando no, muestra los dos y el motivo.
 * Es la misma disciplina que `cue` vs `output` en el show-engine (ADR-009):
 * lo pedido y lo efectivo son cosas distintas y conviene no confundirlas.
 */

export type ModeDivergenceReason =
  | 'NONE'
  | 'SAFE_MODE'
  | 'SHOW_TIMELINE'
  | 'MANUAL_SCENE'
  | 'NO_SHOW';

export interface EffectiveMode {
  requested: BuildingMode;
  /** null si el estado actual no corresponde a ningún modo conocido. */
  effective: BuildingMode | null;
  /** Escena que el estado está mostrando realmente. */
  activeSceneId: string | null;
  matches: boolean;
  reason: ModeDivergenceReason;
  /** Texto para la UI cuando hay divergencia. Vacío si coinciden. */
  explanation: string;
}

/** Escena → modo. Si dos modos compartieran escena, gana el primero declarado. */
const SCENE_TO_MODE = new Map<string, BuildingMode>(
  (Object.keys(BUILDING_MODES) as BuildingMode[])
    .map((m) => [BUILDING_MODES[m].lightingSceneId, m] as const)
    .reverse(),
);

export interface ResolveModeInput {
  requested: BuildingMode;
  state: ShowRuntimeState | null;
  safeMode: boolean;
}

/**
 * Deriva el modo efectivo del estado real. No modifica nada: observa.
 */
export function resolveEffectiveMode(input: ResolveModeInput): EffectiveMode {
  const { requested, state, safeMode } = input;

  if (safeMode) {
    return {
      requested,
      effective: null,
      activeSceneId: state?.lightingSceneId ?? null,
      matches: false,
      reason: 'SAFE_MODE',
      explanation:
        'SAFE MODE está activo: el estado seguro pisa cualquier modo hasta que se salga explícitamente.',
    };
  }

  if (!state) {
    return {
      requested,
      effective: null,
      activeSceneId: null,
      matches: false,
      reason: 'NO_SHOW',
      explanation: 'No hay show cargado, así que el modo no tiene un estado sobre el cual aplicarse.',
    };
  }

  const activeSceneId = state.lightingSceneId;
  const effective = SCENE_TO_MODE.get(activeSceneId) ?? null;

  if (effective === requested) {
    return { requested, effective, activeSceneId, matches: true, reason: 'NONE', explanation: '' };
  }

  if (effective === null) {
    return {
      requested,
      effective: null,
      activeSceneId,
      matches: false,
      reason: 'MANUAL_SCENE',
      explanation: `La escena activa ("${activeSceneId}") no corresponde a ningún modo del edificio.`,
    };
  }

  return {
    requested,
    effective,
    activeSceneId,
    matches: false,
    reason: 'SHOW_TIMELINE',
    explanation: `El timeline del show cambió la escena a "${activeSceneId}", que corresponde al modo ${effective}. El modo pedido vuelve a aplicarse al terminar el show o al reseleccionarlo.`,
  };
}

/**
 * ── M2A.2 / punto 1 ──────────────────────────────────────────────
 *
 * El bug: `applyModeToState` se llamaba en CADA tick sobre
 * `engine.getState()`, asi que la escena del modo pisaba permanentemente lo
 * que el timeline del show estaba haciendo. La respiracion de la cupula en
 * `trust_signature_001` quedaba anulada por el modo NORMAL; un
 * `lighting.scene: mcd_red_gold` del timeline no se veia nunca.
 *
 * Es decir: CONTROL mostraba un edificio distinto del que el motor resolvia.
 * Un panel de supervision que contradice al motor no sirve para supervisar.
 *
 * Ahora hay tres cosas separadas y explicitas:
 *
 *   engineState    verdad inmutable del ShowEngine. Nunca se toca.
 *   requestedMode  lo que el operador eligio en el panel.
 *   previewState   lo que se muestra: engineState, salvo que el override
 *                  manual este habilitado Y el show no este manejando la
 *                  iluminacion.
 *
 * Regla dura: **el timeline siempre gana**. Si el show tiene eventos de
 * iluminacion, el override no se aplica y la divergencia de modo se muestra
 * como informacion (`SHOW_TIMELINE`), no se resuelve pisando al motor.
 */
export interface PreviewStateInput {
  /** Estado del motor, tal cual. */
  engineState: ShowRuntimeState | null;
  requestedMode: BuildingMode;
  scenes: ReadonlyMap<string, LightingScene>;
  safeMode: boolean;
  /**
   * True si el show cargado maneja iluminacion por timeline. En ese caso el
   * override manual NO se aplica: la fuente de verdad es el motor.
   */
  showDrivesLighting: boolean;
  /** El operador pidio explicitamente previsualizar el modo. */
  overrideEnabled: boolean;
}

export type PreviewSource = 'ENGINE' | 'MANUAL_OVERRIDE';

export interface PreviewResult {
  /** Lo que la UI pinta. Puede ser identico a engineState. */
  state: ShowRuntimeState | null;
  source: PreviewSource;
  /** Por que no se aplico el override, si correspondia. */
  overrideBlockedReason: 'NONE' | 'SAFE_MODE' | 'SHOW_TIMELINE' | 'DISABLED' | 'NO_STATE';
}

/**
 * Decide que estado se muestra. Pura.
 *
 * Devuelve el MISMO objeto `engineState` (no una copia) cuando no hay
 * override: asi una comparacion por identidad basta para verificar que el
 * motor no fue tocado.
 */
export function resolvePreviewState(input: PreviewStateInput): PreviewResult {
  const { engineState, requestedMode, scenes, safeMode, showDrivesLighting, overrideEnabled } = input;

  if (!engineState) return { state: null, source: 'ENGINE', overrideBlockedReason: 'NO_STATE' };
  if (safeMode) return { state: engineState, source: 'ENGINE', overrideBlockedReason: 'SAFE_MODE' };
  if (!overrideEnabled) return { state: engineState, source: 'ENGINE', overrideBlockedReason: 'DISABLED' };
  // El timeline manda: si el show ilumina, el override no pisa nada.
  if (showDrivesLighting) {
    return { state: engineState, source: 'ENGINE', overrideBlockedReason: 'SHOW_TIMELINE' };
  }

  return {
    state: applyModeToState(engineState, requestedMode, scenes, safeMode),
    source: 'MANUAL_OVERRIDE',
    overrideBlockedReason: 'NONE',
  };
}

/** True si el show package contiene eventos que manejan iluminacion. */
export function showDrivesLighting(show: { timeline: ReadonlyArray<{ type: string }> } | null): boolean {
  if (!show) return false;
  return show.timeline.some((e) => e.type === 'lighting.scene' || e.type === 'lighting.zone.set');
}

/**
 * Aplica el modo al estado resuelto: es un override de preview, no un comando.
 *
 * Deliberadamente NO toca el show package ni el motor. El motor sigue siendo
 * la fuente de verdad del show; esto es una capa de visualización por encima,
 * exactamente como los overrides manuales de zona en PREVIS.
 *
 * Se aplica sin fade: es una selección del operador en un panel, no una
 * transición programada. El fade pertenece al show.
 */
export function applyModeToState(
  state: ShowRuntimeState,
  mode: BuildingMode,
  scenes: ReadonlyMap<string, LightingScene>,
  safeMode: boolean,
): ShowRuntimeState {
  // SAFE MODE no se negocia con un selector de modo.
  if (safeMode) return state;

  const spec = BUILDING_MODES[mode];
  const scene = scenes.get(spec.lightingSceneId);
  if (!scene) return state;

  const zones = { ...state.zones };
  for (const [zoneId, patch] of Object.entries(scene.zones)) {
    const actual = zones[zoneId as keyof typeof zones];
    if (!actual || !patch) continue;
    zones[zoneId as keyof typeof zones] = {
      ...actual,
      intensity: patch.intensity,
      color: { ...patch.color },
      enabled: patch.enabled ?? actual.enabled,
    };
  }

  return { ...state, zones, lightingSceneId: scene.id };
}
