import { EL_TRUST } from '@trust/show-engine';
import { describe, expect, it } from 'vitest';
import { buildingSurfaceIds, deriveSurfaceFormats } from './index';

describe('CRITERIO: formatos derivados del modelo del edificio, no reescritos', () => {
  it('los cuatro formatos salen de EL_TRUST', () => {
    const f = deriveSurfaceFormats();
    expect([f.towers_ab.width, f.towers_ab.height]).toEqual([2592, 576]);
    expect([f.screen_a.width, f.screen_a.height]).toEqual([1152, 576]);
    expect([f.screen_b.width, f.screen_b.height]).toEqual([1440, 576]);
    expect([f.horizontal.width, f.horizontal.height]).toEqual([1920, 412]);
  });

  it('si el modelo cambia, el formato exigido cambia con él', () => {
    const otro = structuredClone(EL_TRUST);
    otro.screens.find((s) => s.id === 'screen_b')!.pixelWidth = 1600;
    expect(deriveSurfaceFormats(otro).towers_ab.width).toBe(1152 + 1600);
  });

  it('A y B con alturas distintas: no hay lienzo A+B, y se dice', () => {
    const otro = structuredClone(EL_TRUST);
    otro.screens.find((s) => s.id === 'screen_a')!.pixelHeight = 600;
    expect(() => deriveSurfaceFormats(otro)).toThrow(/alturas distintas/);
  });

  it('las superficies contratables son las pantallas del modelo', () => {
    expect(buildingSurfaceIds()).toEqual(['screen_a', 'screen_b', 'horizontal']);
  });
});
