import { z } from 'zod';
import { ClockStateSchema } from '@trust/shared-types';

/**
 * TAKEOVER DRAFT — modelo de AUTORÍA.
 *
 * ── Principio ────────────────────────────────────────────────────
 *
 * El draft es lo que una persona edita; el SHOW PACKAGE es lo que el motor
 * ejecuta. Son modelos distintos a propósito: uno está optimizado para que un
 * comercial arme una campaña en diez minutos, el otro para que un edificio la
 * reproduzca con precisión de frame.
 *
 * `compileTakeoverDraft()` traduce de uno al otro. El editor NUNCA reimplementa
 * semántica del ShowEngine.
 *
 * ── La restricción que define este modelo ────────────────────────
 *
 * SHOW PACKAGE v1 declara `media: Record<ScreenId, string>`: **una fuente por
 * pantalla para todo el show**. El evento `media.play` no lleva source. Y
 * `mediaGroups` asocia un grupo a **una** fuente única.
 *
 * Por lo tanto un moment NO puede cambiar de asset. Y como `show-engine` está
 * cerrado en esta etapa, el modelo de autoría se adapta al contrato, no al
 * revés.
 *
 * Consecuencia: el asset se asigna **por superficie a nivel campaña**, y cada
 * moment controla la REPRODUCCIÓN — arrancar desde un punto, sostener lo que
 * venía, o ir a negro. Es, además, como se produce un takeover real: un master
 * por superficie, segmentado. Ver ADR-030.
 */

export const TAKEOVER_DRAFT_VERSION = 1;

/* ────────────────────────────────────────────────────────────────
 * Directivas de pantalla
 * ──────────────────────────────────────────────────────────────── */

/**
 * Qué hace una superficie durante un moment.
 *
 * - `hold`  mantiene lo que venía (el compilador no emite evento).
 * - `black` apaga (media.stop).
 * - `play`  arranca desde `fromMs` del asset de esa superficie.
 */
export const ScreenDirectiveSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('hold') }),
  z.object({ mode: z.literal('black') }),
  z.object({
    mode: z.literal('play'),
    /** Offset dentro del asset de la campaña, en ms. */
    fromMs: z.number().int().min(0).default(0),
  }),
]);
export type ScreenDirective = z.infer<typeof ScreenDirectiveSchema>;

export const HOLD: ScreenDirective = { mode: 'hold' };
export const BLACK: ScreenDirective = { mode: 'black' };

/* ────────────────────────────────────────────────────────────────
 * Iluminación y reloj
 * ──────────────────────────────────────────────────────────────── */

export const LightingDirectiveSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inherit') }),
  z.object({
    mode: z.literal('scene'),
    /** Id de una escena REAL del catálogo. Se valida contra DEMO_SCENES. */
    sceneId: z.string().min(1),
    /** Si se omite, manda el fade propio de la escena. */
    fadeMs: z.number().int().min(0).optional(),
  }),
]);
export type LightingDirective = z.infer<typeof LightingDirectiveSchema>;

/**
 * Reloj. Solo los estados que el contrato soporta HOY:
 * `normal | off | accent | countdown`.
 *
 * La UI puede mostrar BRAND y EVENT como capacidades futuras, pero el draft no
 * las admite: inventar un estado que el motor no resuelve produciría un show
 * que compila y no se ve como el editor prometió.
 */
export const ClockDirectiveSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inherit') }),
  z.object({ mode: z.literal('state'), value: ClockStateSchema }),
]);
export type ClockDirective = z.infer<typeof ClockDirectiveSchema>;

/* ────────────────────────────────────────────────────────────────
 * Moment
 * ──────────────────────────────────────────────────────────────── */

/** Duración mínima. Un moment de 0 ms no existe en el tiempo. */
export const MIN_MOMENT_MS = 100;

export const MomentScreensSchema = z.object({
  /**
   * Torres. En modo `master` ambas comparten decoder y por lo tanto comparten
   * directiva: emitir cues distintos las separaría y rompería el frame-lock.
   */
  upper: ScreenDirectiveSchema,
  /** Solo se usa en modo `independent`. */
  corrientes: ScreenDirectiveSchema,
  pellegrini: ScreenDirectiveSchema,
  horizontal: ScreenDirectiveSchema,
});
export type MomentScreens = z.infer<typeof MomentScreensSchema>;

export const TakeoverMomentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  durationMs: z.number().int().min(MIN_MOMENT_MS),
  screens: MomentScreensSchema,
  lighting: LightingDirectiveSchema,
  clock: ClockDirectiveSchema,
  notes: z.string().optional(),
});
export type TakeoverMoment = z.infer<typeof TakeoverMomentSchema>;

/* ────────────────────────────────────────────────────────────────
 * Superficies de la campaña
 * ──────────────────────────────────────────────────────────────── */

/**
 * `independent` — cada torre con su propio archivo y su propio decoder.
 * `master`      — un lienzo único 2592×576 repartido con uvRect. Frame-lock
 *                 por construcción (ADR-010).
 *
 * Es una decisión de CAMPAÑA, no de moment: `mediaGroups` es global en el show
 * package y una pantalla no puede estar en dos grupos. Mezclar los dos modos
 * dentro de una campaña no es representable en el contrato v1.
 */
export const UpperModeSchema = z.enum(['independent', 'master']);
export type UpperMode = z.infer<typeof UpperModeSchema>;

export const CampaignSurfacesSchema = z.object({
  upperMode: UpperModeSchema,
  /** Asset del master A+B. Requerido si upperMode === 'master'. */
  masterAssetId: z.string().nullable().default(null),
  /** Assets por torre. Requeridos si upperMode === 'independent'. */
  corrientesAssetId: z.string().nullable().default(null),
  pellegriniAssetId: z.string().nullable().default(null),
  horizontalAssetId: z.string().nullable().default(null),
  /**
   * Incluir la horizontal en el grupo de frame-lock junto a A+B.
   *
   * La capacidad física NO está confirmada (ver `syncCapableWith` en
   * building.ts). Si se activa, el draft se marca y la UI muestra
   * "SYNC HARDWARE NOT VERIFIED". Nunca se exporta como capacidad confirmada.
   */
  includeHorizontalInMaster: z.boolean().default(false),
});
export type CampaignSurfaces = z.infer<typeof CampaignSurfacesSchema>;

/* ────────────────────────────────────────────────────────────────
 * Draft
 * ──────────────────────────────────────────────────────────────── */

export const TakeoverDraftSchema = z.object({
  takeoverDraftVersion: z.literal(TAKEOVER_DRAFT_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  clientName: z.string().default(''),
  campaignName: z.string().default(''),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  surfaces: CampaignSurfacesSchema,
  moments: z.array(TakeoverMomentSchema),
  /** Escena a la que vuelve el edificio al terminar. Identidad por defecto. */
  closingSceneId: z.string().min(1).default('trust_normal'),
  notes: z.string().optional(),
});
export type TakeoverDraft = z.infer<typeof TakeoverDraftSchema>;

/** Único punto de entrada de drafts externos. Nada de JSON sin validar. */
export function parseTakeoverDraft(input: unknown): TakeoverDraft {
  return TakeoverDraftSchema.parse(input);
}

export function safeParseTakeoverDraft(input: unknown) {
  return TakeoverDraftSchema.safeParse(input);
}

/* ────────────────────────────────────────────────────────────────
 * Utilidades de edición
 * ──────────────────────────────────────────────────────────────── */

export const totalDurationMs = (draft: TakeoverDraft): number =>
  draft.moments.reduce((a, m) => a + m.durationMs, 0);

export interface MomentSpan {
  moment: TakeoverMoment;
  index: number;
  startMs: number;
  endMs: number;
}

/** Tiempos absolutos de cada moment. El usuario nunca los escribe. */
export function momentSpans(draft: TakeoverDraft): MomentSpan[] {
  let cursor = 0;
  return draft.moments.map((moment, index) => {
    const startMs = cursor;
    cursor += moment.durationMs;
    return { moment, index, startMs, endMs: cursor };
  });
}

export function momentAt(draft: TakeoverDraft, timeMs: number): MomentSpan | null {
  return momentSpans(draft).find((s) => timeMs >= s.startMs && timeMs < s.endMs) ?? null;
}

/**
 * IDs de moment.
 *
 * Deterministas por contador, no aleatorios: un draft exportado dos veces desde
 * el mismo estado tiene que dar el mismo archivo, si no el diff contra el draft
 * guardado es ruido puro.
 */
export function nextMomentId(draft: TakeoverDraft, hint = 'moment'): string {
  const base = hint
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'moment';
  const usados = new Set(draft.moments.map((m) => m.id));
  if (!usados.has(base)) return base;
  for (let i = 2; ; i++) {
    const cand = `${base}_${i}`;
    if (!usados.has(cand)) return cand;
  }
}

export function emptyMoment(id: string, name: string, durationMs = 3000): TakeoverMoment {
  return TakeoverMomentSchema.parse({
    id,
    name,
    durationMs,
    screens: { upper: HOLD, corrientes: HOLD, pellegrini: HOLD, horizontal: HOLD },
    lighting: { mode: 'inherit' },
    clock: { mode: 'inherit' },
  });
}

export function addMoment(draft: TakeoverDraft, name = 'Nuevo moment', durationMs = 3000): TakeoverDraft {
  const moment = emptyMoment(nextMomentId(draft, name), name, durationMs);
  return { ...draft, moments: [...draft.moments, moment] };
}

/** Duplica conservando el contenido pero con id propio. */
export function duplicateMoment(draft: TakeoverDraft, id: string): TakeoverDraft {
  const index = draft.moments.findIndex((m) => m.id === id);
  const original = index < 0 ? undefined : draft.moments[index];
  if (!original) return draft;
  const copia: TakeoverMoment = {
    ...structuredCloneish(original),
    id: nextMomentId(draft, `${original.id}_copy`),
    name: `${original.name} (copia)`,
  };
  const moments = [...draft.moments];
  moments.splice(index + 1, 0, copia);
  return { ...draft, moments };
}

export function removeMoment(draft: TakeoverDraft, id: string): TakeoverDraft {
  return { ...draft, moments: draft.moments.filter((m) => m.id !== id) };
}

/** Mueve un moment. El contenido no cambia: solo el orden. */
export function reorderMoments(draft: TakeoverDraft, from: number, to: number): TakeoverDraft {
  if (from === to || from < 0 || to < 0 || from >= draft.moments.length || to >= draft.moments.length) {
    return draft;
  }
  const moments = [...draft.moments];
  const [movido] = moments.splice(from, 1);
  if (!movido) return draft;
  moments.splice(to, 0, movido);
  return { ...draft, moments };
}

export function updateMoment(
  draft: TakeoverDraft,
  id: string,
  patch: Partial<TakeoverMoment>,
): TakeoverDraft {
  return {
    ...draft,
    moments: draft.moments.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  };
}

function structuredCloneish<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
