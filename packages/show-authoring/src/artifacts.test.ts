import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EL_TRUST, DEMO_SCENES, preflightShow } from '@trust/show-engine';
import { parseShowPackage } from '@trust/shared-types';
import {
  PRESET_MCDONALDS_15S,
  compileTakeoverDraft,
  createRepoRegistry,
  validateDraft,
} from './index';

/**
 * Tests PUROS sobre los artefactos y el preset.
 *
 * M2C.1.2 / punto 1: ninguno escribe en disco. La generacion de
 * `docs/examples/` es `pnpm emit:examples`, aparte, justamente para que el
 * mutation check no deje artefactos escritos por un mutante.
 */

const registry = createRepoRegistry();
const ctx = { building: EL_TRUST, assets: registry, sceneIds: new Set(DEMO_SCENES.keys()) };
const preflightCtx = { building: EL_TRUST, scenes: DEMO_SCENES };

describe('preset McDonald\u2019s', () => {
  it('CRITERIO: compila, pasa schema y preflight sin errores', () => {
    const compiled = compileTakeoverDraft(PRESET_MCDONALDS_15S(), ctx);
    expect(compiled.ok).toBe(true);
    const pkg = parseShowPackage(compiled.showPackage);
    expect(pkg.durationMs).toBe(15000);
    const pre = preflightShow(pkg, preflightCtx);
    expect(pre.errors).toEqual([]);
  });

  it('CRITERIO: el draft queda READY', () => {
    const val = validateDraft(PRESET_MCDONALDS_15S(), { ...ctx, preflight: preflightCtx });
    expect(val.status).toBe('READY');
    expect(val.exportable).toBe(true);
  });

  it('CRITERIO: A+B en un mediaGroup con ambas reproduciendo NO da PLAY_WITHOUT_MEDIA', () => {
    /*
     * La regla mira la fuente RESUELTA, no el diccionario `media`: una pantalla
     * cuya fuente viene de un mediaGroup no declara nada en `media` y aun asi
     * tiene con que reproducir. Si preflight mirara solo `media`, todo takeover
     * con master A+B quedaria bloqueado por una fuente que si existe.
     */
    const pkg = parseShowPackage(compileTakeoverDraft(PRESET_MCDONALDS_15S(), ctx).showPackage);

    const grupo = pkg.mediaGroups.towers;
    expect(grupo).toBeDefined();
    expect(Object.keys(grupo!.layout).sort()).toEqual(['screen_a', 'screen_b']);
    expect(pkg.media.screen_a).toBeUndefined();
    expect(pkg.media.screen_b).toBeUndefined();

    const plays = pkg.timeline.filter((e) => e.type === 'media.play');
    expect(plays.some((e) => e.target === 'screen_a')).toBe(true);
    expect(plays.some((e) => e.target === 'screen_b')).toBe(true);

    const codigos = preflightShow(pkg, preflightCtx).errors.map((e) => e.code);
    expect(codigos).not.toContain('PLAY_WITHOUT_MEDIA');
  });
});

describe('assets del registry', () => {
  it('CRITERIO: todo asset existe en el servidor del builder', () => {
    // Un asset "autorizado" que no existe pasa todas las validaciones y falla
    // recien en pantalla, delante del cliente.
    const publicDir = resolve(__dirname, '../../../apps/control/public');
    for (const asset of registry.list()) {
      if (asset.unmanaged) continue;
      expect(existsSync(resolve(publicDir, `.${asset.source}`)), `${asset.id} → ${asset.source}`).toBe(true);
    }
  });
});

describe('artefactos entregados', () => {
  const dir = resolve(__dirname, '../../../docs/examples');
  const leer = (f: string) => JSON.parse(readFileSync(resolve(dir, f), 'utf8'));

  it('CRITERIO: el ShowPackage del repo coincide con el que compila el preset', () => {
    // Si alguien edita el JSON a mano, o un mutante lo reescribe, esto falla.
    const esperado = parseShowPackage(compileTakeoverDraft(PRESET_MCDONALDS_15S(), ctx).showPackage);
    expect(leer('mcdonalds_takeover_15s.show.json')).toEqual(esperado);
  });

  it('el README entregado dice READY y sin errores de preflight', () => {
    const readme = readFileSync(resolve(dir, 'README.md'), 'utf8');
    expect(readme).toContain('READY');
    expect(readme).toContain('| preflight errores | ninguno |');
  });
});
