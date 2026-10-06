import { EL_TRUST } from '@trust/show-engine';
import type { BuildingConfig, ScreenId } from '@trust/shared-types';

/**
 * Capacidades del edificio — revisión de arquitectura M3A.1, punto 5.
 *
 * Los formatos de video NO se escriben de nuevo acá ni en la base: se DERIVAN
 * del modelo del edificio que ya usa el runtime (EL_TRUST). El lienzo A+B es
 * la suma de los anchos de las dos torres, que tienen que tener el mismo alto.
 * Si mañana cambia una pantalla en el modelo, cambia el formato que exige el
 * backend, sin tocar nada más.
 */
export type SurfaceFormatId = 'towers_ab' | 'screen_a' | 'screen_b' | 'horizontal';

export interface SurfaceFormat {
  id: SurfaceFormatId;
  width: number;
  height: number;
  /** Pantallas físicas que cubre este formato. */
  screens: readonly ScreenId[];
}

export function deriveSurfaceFormats(building: BuildingConfig = EL_TRUST): Readonly<Record<SurfaceFormatId, SurfaceFormat>> {
  const pantalla = (id: ScreenId) => {
    const s = building.screens.find((x) => x.id === id);
    if (!s) throw new Error(`el modelo del edificio no tiene la pantalla ${id}`);
    return s;
  };
  const a = pantalla('screen_a');
  const b = pantalla('screen_b');
  const h = pantalla('horizontal');
  if (a.pixelHeight !== b.pixelHeight) {
    throw new Error(`A y B tienen alturas distintas (${a.pixelHeight} vs ${b.pixelHeight}): no hay lienzo A+B`);
  }
  return {
    towers_ab: { id: 'towers_ab', width: a.pixelWidth + b.pixelWidth, height: a.pixelHeight, screens: ['screen_a', 'screen_b'] },
    screen_a: { id: 'screen_a', width: a.pixelWidth, height: a.pixelHeight, screens: ['screen_a'] },
    screen_b: { id: 'screen_b', width: b.pixelWidth, height: b.pixelHeight, screens: ['screen_b'] },
    horizontal: { id: 'horizontal', width: h.pixelWidth, height: h.pixelHeight, screens: ['horizontal'] },
  };
}

/** Las superficies contratables son las pantallas del modelo, no una lista propia. */
export function buildingSurfaceIds(building: BuildingConfig = EL_TRUST): readonly ScreenId[] {
  return building.screens.map((s) => s.id);
}
