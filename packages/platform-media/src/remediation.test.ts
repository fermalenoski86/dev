import { AssetRejectionCodeSchema, deriveSurfaceFormats } from '@trust/platform-contracts';
import { EL_TRUST } from '@trust/show-engine';
import { describe, expect, it } from 'vitest';
import { INPUT_PLACEHOLDER, OUTPUT_PLACEHOLDER, remediationFor, targetFps } from './remediation';

describe('CRITERIO: BL-03 — remediación derivada de la autoridad', () => {
  it('los 12 códigos tienen remediación con texto', () => {
    for (const code of AssetRejectionCodeSchema.options) {
      const r = remediationFor({ code }, 'horizontal');
      expect(r.summary.length, code).toBeGreaterThan(10);
    }
  });

  it('los argumentos son estructurados: marcadores, nunca nombres de archivo', () => {
    const r = remediationFor({ code: 'ASSET_BAD_CODEC', details: { actual: '$(rm -rf ~).mov' } }, 'horizontal');
    expect(r.ffmpeg?.args).toContain(INPUT_PLACEHOLDER);
    expect(r.ffmpeg?.args.at(-1)).toBe(OUTPUT_PLACEHOLDER);
    expect(JSON.stringify(r)).not.toContain('rm -rf');
  });

  it('la resolución de la receta sale de EL_TRUST (y cambia si cambia el modelo)', () => {
    const real = deriveSurfaceFormats(EL_TRUST).horizontal;
    const r = remediationFor({ code: 'ASSET_BAD_RESOLUTION' }, 'horizontal');
    expect(r.ffmpeg?.args.join(' ')).toContain(`scale=${real.width}:${real.height}`);
    const otro = structuredClone(EL_TRUST);
    const h = otro.screens.find((s) => s.id === 'horizontal');
    if (!h) throw new Error('modelo sin horizontal');
    h.pixelWidth = 2048;
    h.pixelHeight = 440;
    const r2 = remediationFor({ code: 'ASSET_BAD_RESOLUTION' }, 'horizontal', deriveSurfaceFormats(otro));
    expect(r2.ffmpeg?.args.join(' ')).toContain('scale=2048:440');
    expect(r2.summary).toContain('2048×440');
  });

  it('fps objetivo: el aceptado más cercano al detectado', () => {
    expect(targetFps('30000/1001')).toBe(30);
    expect(targetFps('24000/1001')).toBe(25);
    expect(targetFps('50/1')).toBe(30);
    expect(targetFps(undefined)).toBe(25);
  });

  it('códigos que no se arreglan transcodificando no traen comando', () => {
    for (const code of ['ASSET_TOO_SHORT', 'ASSET_EMPTY', 'ASSET_CORRUPT', 'ASSET_NO_VIDEO', 'ASSET_STORAGE_ERROR'] as const) {
      expect(remediationFor({ code }, 'horizontal').ffmpeg).toBeUndefined();
    }
  });
});
