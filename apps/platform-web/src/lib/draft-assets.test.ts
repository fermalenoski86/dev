import { describe, expect, it } from 'vitest';
import { DRAFT_SLOTS, draftSlots, slotForAsset, withSlotAsset } from './draft-assets';

/** E3b · ranuras del draft: solo se toca `surfaces.<slot>`, con la misma tabla que el submit del servidor. */
describe('E3b · asignación de assets al draft', () => {
  it('cada formato de superficie tiene su ranura; solo un asset READY se asigna', () => {
    expect(slotForAsset({ status: 'READY', surfaceType: 'towers_ab' })).toBe('masterAssetId');
    expect(slotForAsset({ status: 'READY', surfaceType: 'screen_a' })).toBe('corrientesAssetId');
    expect(slotForAsset({ status: 'READY', surfaceType: 'screen_b' })).toBe('pellegriniAssetId');
    expect(slotForAsset({ status: 'READY', surfaceType: 'horizontal' })).toBe('horizontalAssetId');
    expect(slotForAsset({ status: 'REJECTED', surfaceType: 'horizontal' })).toBeNull();
    expect(slotForAsset({ status: 'VALIDATING', surfaceType: 'towers_ab' })).toBeNull();
    expect(slotForAsset({ status: 'READY', surfaceType: 'otra' })).toBeNull();
    expect(DRAFT_SLOTS).toHaveLength(4);
  });

  it('withSlotAsset cambia solo esa ranura y no muta el original', () => {
    const d = { name: 'x', moments: [{ id: 'm1' }], surfaces: { upperMode: 'master', masterAssetId: null, horizontalAssetId: 'viejo' } };
    const copia = JSON.parse(JSON.stringify(d));
    const n = withSlotAsset(d, 'masterAssetId', 'a1');
    expect(n).toEqual({ ...d, surfaces: { ...d.surfaces, masterAssetId: 'a1' } });
    expect(n.moments).toBe(d.moments);
    expect(d).toEqual(copia);
    expect(draftSlots(n)).toEqual({ masterAssetId: 'a1', corrientesAssetId: null, pellegriniAssetId: null, horizontalAssetId: 'viejo' });
  });

  it('un draft sin superficies no se inventa', () => {
    expect(() => withSlotAsset({ name: 'x' }, 'masterAssetId', 'a1')).toThrow(/Builder/);
    expect(() => withSlotAsset({ surfaces: [] }, 'masterAssetId', 'a1')).toThrow();
    expect(draftSlots({})).toEqual({ masterAssetId: null, corrientesAssetId: null, pellegriniAssetId: null, horizontalAssetId: null });
  });
});
