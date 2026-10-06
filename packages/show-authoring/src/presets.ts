import {
  TakeoverDraftSchema,
  type ScreenDirective,
  type TakeoverDraft,
  type TakeoverMoment,
} from './draft-schema';

/**
 * PRESETS DE DRAFT.
 *
 * Son puntos de partida de AUTORÍA, no modos del ShowEngine. Un preset es un
 * draft ya armado que el usuario después edita; no agrega ninguna capacidad
 * nueva al motor.
 *
 * Fecha fija en `createdAt`/`updatedAt`: un preset tiene que ser idéntico cada
 * vez que se carga, si no dos personas que abren el mismo preset obtienen
 * drafts distintos y el diff contra el guardado es ruido.
 */

const EPOCH = Date.UTC(2026, 0, 1);

const play = (fromMs = 0): ScreenDirective => ({ mode: 'play', fromMs });
const hold: ScreenDirective = { mode: 'hold' };
const black: ScreenDirective = { mode: 'black' };

interface MomentSpec {
  id: string;
  name: string;
  durationMs: number;
  upper?: ScreenDirective;
  corrientes?: ScreenDirective;
  pellegrini?: ScreenDirective;
  horizontal?: ScreenDirective;
  scene?: string;
  fadeMs?: number;
  clock?: 'normal' | 'off' | 'accent' | 'countdown';
  notes?: string;
}

function moment(spec: MomentSpec): TakeoverMoment {
  return {
    id: spec.id,
    name: spec.name,
    durationMs: spec.durationMs,
    screens: {
      upper: spec.upper ?? hold,
      corrientes: spec.corrientes ?? spec.upper ?? hold,
      pellegrini: spec.pellegrini ?? spec.upper ?? hold,
      horizontal: spec.horizontal ?? hold,
    },
    lighting: spec.scene
      ? spec.fadeMs === undefined
        ? { mode: 'scene', sceneId: spec.scene }
        : { mode: 'scene', sceneId: spec.scene, fadeMs: spec.fadeMs }
      : { mode: 'inherit' },
    clock: spec.clock ? { mode: 'state', value: spec.clock } : { mode: 'inherit' },
    ...(spec.notes ? { notes: spec.notes } : {}),
  };
}

function draft(input: {
  id: string;
  name: string;
  client?: string;
  campaign?: string;
  upperMode?: 'independent' | 'master';
  masterAssetId?: string | null;
  horizontalAssetId?: string | null;
  corrientesAssetId?: string | null;
  pellegriniAssetId?: string | null;
  moments: MomentSpec[];
  notes?: string;
}): TakeoverDraft {
  return TakeoverDraftSchema.parse({
    takeoverDraftVersion: 1,
    id: input.id,
    name: input.name,
    clientName: input.client ?? '',
    campaignName: input.campaign ?? input.name,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    surfaces: {
      upperMode: input.upperMode ?? 'master',
      masterAssetId: input.masterAssetId ?? null,
      corrientesAssetId: input.corrientesAssetId ?? null,
      pellegriniAssetId: input.pellegriniAssetId ?? null,
      horizontalAssetId: input.horizontalAssetId ?? null,
      includeHorizontalInMaster: false,
    },
    moments: input.moments.map(moment),
    closingSceneId: 'trust_normal',
    ...(input.notes ? { notes: input.notes } : {}),
  });
}

/* ────────────────────────────────────────────────────────────────
 * Presets
 * ──────────────────────────────────────────────────────────────── */

export const PRESET_EMPTY = (): TakeoverDraft =>
  draft({
    id: 'draft_empty',
    name: 'Campaña vacía',
    moments: [{ id: 'normal', name: 'Normal', durationMs: 3000, scene: 'trust_normal' }],
  });

export const PRESET_BRAND_REVEAL_15S = (): TakeoverDraft =>
  draft({
    id: 'draft_brand_reveal_15s',
    name: 'Brand Reveal 15 s',
    masterAssetId: 'test_towers_master',
    horizontalAssetId: 'test_horizontal',
    moments: [
      { id: 'normal', name: 'Normal', durationMs: 4000, scene: 'trust_normal', clock: 'normal' },
      {
        id: 'reveal',
        name: 'Brand reveal',
        durationMs: 5000,
        upper: play(0),
        horizontal: play(0),
        scene: 'brand_accent',
        fadeMs: 2000,
      },
      { id: 'sostener', name: 'Sostener', durationMs: 4000 },
      { id: 'exit', name: 'Exit', durationMs: 2000, upper: black, horizontal: black, scene: 'trust_normal', fadeMs: 1500 },
    ],
  });

export const PRESET_TAKEOVER_15S = (): TakeoverDraft =>
  draft({
    id: 'draft_takeover_15s',
    name: 'Takeover 15 s',
    masterAssetId: 'test_towers_master',
    horizontalAssetId: 'test_horizontal',
    moments: [
      { id: 'normal', name: 'Normal', durationMs: 3000, scene: 'trust_normal', clock: 'normal' },
      { id: 'reveal', name: 'Brand reveal', durationMs: 3000, upper: play(0), horizontal: play(0), scene: 'brand_accent', fadeMs: 1500 },
      { id: 'takeover', name: 'Full takeover', durationMs: 6000, scene: 'mcd_red_gold', fadeMs: 2000, clock: 'accent' },
      { id: 'firma', name: 'Signature', durationMs: 2000, scene: 'iconic_signature', fadeMs: 1200, clock: 'normal' },
      { id: 'exit', name: 'Exit', durationMs: 1000, upper: black, horizontal: black, scene: 'trust_normal', fadeMs: 800 },
    ],
  });

export const PRESET_EVENT_30S = (): TakeoverDraft =>
  draft({
    id: 'draft_event_30s',
    name: 'Evento 30 s',
    masterAssetId: 'test_towers_master',
    horizontalAssetId: 'test_horizontal',
    moments: [
      { id: 'apertura', name: 'Apertura', durationMs: 6000, scene: 'event_bright', fadeMs: 3000, clock: 'accent' },
      { id: 'contenido', name: 'Contenido', durationMs: 12000, upper: play(0), horizontal: play(0) },
      { id: 'cuenta', name: 'Cuenta regresiva', durationMs: 6000, clock: 'countdown', scene: 'iconic_signature', fadeMs: 2500 },
      { id: 'cierre', name: 'Cierre', durationMs: 6000, upper: black, horizontal: black, scene: 'trust_normal', fadeMs: 4000, clock: 'normal' },
    ],
  });

/**
 * ICONIC: el edificio solo, sin marca. Es el modo que construye el activo — y
 * el que justifica después cobrar caro un takeover.
 */
export const PRESET_ICONIC_15S = (): TakeoverDraft =>
  draft({
    id: 'draft_iconic_15s',
    name: 'Iconic 15 s',
    moments: [
      { id: 'respiracion', name: 'Respiración', durationMs: 6000, scene: 'trust_normal', fadeMs: 4000 },
      { id: 'firma', name: 'Firma', durationMs: 7000, scene: 'iconic_signature', fadeMs: 5000, clock: 'accent' },
      { id: 'vuelta', name: 'Vuelta a normal', durationMs: 2000, scene: 'trust_normal', fadeMs: 1800, clock: 'normal' },
    ],
    notes: 'Sin contenido de marca: solo iluminación arquitectónica.',
  });

/**
 * MCDONALDS_TAKEOVER_15S — estructura de 15 s del pedido.
 *
 * ⚠️ **Los assets son PLACEHOLDERS.** No hay material de McDonald's en el
 * repositorio. No lo descargué —sería traer IP de un tercero a un repo— ni lo
 * generé —sería fabricar una pieza publicitaria de una marca que no nos la
 * encargó—. Usa los patrones de prueba con timecode que sí existen.
 *
 * La escena `mcd_red_gold` sí es real y está en el catálogo. La estructura
 * temporal es la pedida, así que sirve para mostrar el flujo en una reunión;
 * lo que se ve en las pantallas es un patrón de test, no la campaña.
 */
export const PRESET_MCDONALDS_15S = (): TakeoverDraft =>
  draft({
    id: 'mcdonalds_takeover_15s',
    name: "McDonald's Takeover 15 s",
    client: "McDonald's",
    campaign: 'Takeover Obelisco 15 s',
    masterAssetId: 'test_towers_master',
    horizontalAssetId: 'test_horizontal',
    notes:
      'DEMO. Los assets son patrones de prueba: no hay material de McDonald\u0027s en el repositorio. La escena mcd_red_gold sí es real.',
    moments: [
      {
        id: 'normal',
        name: 'Normal',
        durationMs: 3000,
        scene: 'trust_normal',
        clock: 'normal',
        notes: 'El edificio en su identidad, antes de ceder nada.',
      },
      {
        id: 'reveal',
        name: 'Brand reveal',
        durationMs: 3000,
        upper: play(0),
        horizontal: play(0),
        scene: 'brand_accent',
        fadeMs: 1500,
        notes: 'Aparece el contenido; la iluminación todavía es del edificio.',
      },
      {
        id: 'takeover',
        name: 'Full takeover',
        durationMs: 6000,
        scene: 'mcd_red_gold',
        fadeMs: 2000,
        clock: 'accent',
        notes: 'Rojo de marca en la torre. Cúpula y reloj siguen dorados: la firma no se alquila.',
      },
      {
        id: 'firma',
        name: 'Signature',
        durationMs: 2000,
        scene: 'iconic_signature',
        fadeMs: 1200,
        clock: 'normal',
        notes: 'El edificio se recupera a sí mismo antes de terminar.',
      },
      {
        id: 'exit',
        name: 'Exit',
        durationMs: 1000,
        upper: black,
        horizontal: black,
        scene: 'trust_normal',
        fadeMs: 800,
      },
    ],
  });

export interface PresetEntry {
  id: string;
  label: string;
  description: string;
  build: () => TakeoverDraft;
}

export const DRAFT_PRESETS: PresetEntry[] = [
  { id: 'EMPTY', label: 'Vacío', description: 'Un moment en identidad, para empezar de cero.', build: PRESET_EMPTY },
  { id: 'BRAND_REVEAL_15S', label: 'Brand Reveal 15 s', description: 'Aparición de marca sin ceder la iluminación.', build: PRESET_BRAND_REVEAL_15S },
  { id: 'TAKEOVER_15S', label: 'Takeover 15 s', description: 'Campaña completa con retorno a identidad.', build: PRESET_TAKEOVER_15S },
  { id: 'EVENT_30S', label: 'Evento 30 s', description: 'Apertura, contenido y cuenta regresiva.', build: PRESET_EVENT_30S },
  { id: 'ICONIC_15S', label: 'Iconic 15 s', description: 'Solo el edificio. Sin marca.', build: PRESET_ICONIC_15S },
  { id: 'MCDONALDS_15S', label: "McDonald's 15 s (demo)", description: 'Estructura del pedido, con assets de prueba.', build: PRESET_MCDONALDS_15S },
];

export function presetById(id: string): PresetEntry | undefined {
  return DRAFT_PRESETS.find((p) => p.id === id);
}
