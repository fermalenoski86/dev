import type { Asset } from './api';

/**
 * E3b · asignar un asset de plataforma a una ranura del draft.
 *
 * El Builder (apps/control, congelado) trabaja con su registro local de
 * assets y no puede elegir un asset subido a la plataforma. Para que el
 * submit de §41 tenga contenido real, `platform-web` escribe SOLO la ranura
 * `surfaces.<slot>` del draft, con `expectedRevision` (un 409 no pisa nada).
 * Los moments, la duración y el resto del draft siguen siendo del Builder.
 *
 * Ranura ↔ formato: la misma tabla que usa el submit del servidor
 * (`SLOT_SURFACE` en @trust/platform-approval). El servidor valida igual.
 */
export const SLOT_SURFACE = {
  masterAssetId: 'towers_ab',
  corrientesAssetId: 'screen_a',
  pellegriniAssetId: 'screen_b',
  horizontalAssetId: 'horizontal',
} as const;
export type DraftSlot = keyof typeof SLOT_SURFACE;
export const DRAFT_SLOTS = Object.keys(SLOT_SURFACE) as DraftSlot[];

export const SLOT_LABEL: Record<DraftSlot, string> = {
  masterAssetId: 'Master A+B (torres)',
  corrientesAssetId: 'Torre A (Corrientes)',
  pellegriniAssetId: 'Torre B (Pellegrini)',
  horizontalAssetId: 'Horizontal',
};

export const SURFACE_TYPES = ['towers_ab', 'screen_a', 'screen_b', 'horizontal'] as const;

/** La ranura que corresponde a un asset, o null si no está listo o su formato no tiene ranura. */
export function slotForAsset(a: Pick<Asset, 'status' | 'surfaceType'>): DraftSlot | null {
  if (a.status !== 'READY') return null;
  return DRAFT_SLOTS.find((s) => SLOT_SURFACE[s] === a.surfaceType) ?? null;
}

/** Lo que el draft tiene hoy en cada ranura (id del asset o null). */
export function draftSlots(takeoverDraft: Record<string, unknown>): Record<DraftSlot, string | null> {
  const surfaces = (takeoverDraft.surfaces ?? {}) as Record<string, unknown>;
  const out = {} as Record<DraftSlot, string | null>;
  for (const s of DRAFT_SLOTS) out[s] = typeof surfaces[s] === 'string' ? (surfaces[s] as string) : null;
  return out;
}

/**
 * Nuevo draft con SOLO `surfaces[slot]` cambiado. No muta el original. Falla
 * si el draft no tiene `surfaces` (no se inventa estructura: eso es del Builder).
 */
export function withSlotAsset(takeoverDraft: Record<string, unknown>, slot: DraftSlot, assetId: string): Record<string, unknown> {
  const surfaces = takeoverDraft.surfaces;
  if (!surfaces || typeof surfaces !== 'object' || Array.isArray(surfaces)) throw new Error('El draft no tiene superficies: abrilo primero en el Builder.');
  return { ...takeoverDraft, surfaces: { ...(surfaces as Record<string, unknown>), [slot]: assetId } };
}
