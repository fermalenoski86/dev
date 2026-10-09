import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mediaFixtures } from './fixtures';

/**
 * Regresión de la carrera del caché de fixtures (CI de #23: "fixture
 * inexistente: valid_horizontal_30.mp4"). Dos workers con el caché frío:
 * el que termina segundo NO puede borrar el directorio que el primero ya
 * publicó y está leyendo.
 */
let base: string;
afterEach(() => { if (base) rmSync(base, { recursive: true, force: true }); });

const escribir = (dir: string, quien: string) => {
  mkdirSync(dir, { recursive: true });
  for (const f of ['valid_towers_ab_25.mp4', 'valid_horizontal_30.mp4']) writeFileSync(path.join(dir, f), quien);
};

describe('mediaFixtures: caché compartido entre workers paralelos', () => {
  it('si otro worker publicó el directorio mientras éste generaba, se conserva el ajeno (nunca se borra)', () => {
    base = mkdtempSync(path.join(os.tmpdir(), 'trust-fx-race-'));
    const dir = path.join(base, 'fixtures');
    // worker A abre un fixture del directorio publicado por B y lo sigue leyendo
    const fx = mediaFixtures({
      dir,
      generate: (tmp) => {
        escribir(tmp, 'A');
        escribir(dir, 'B'); // B termina y publica mientras A todavía generaba
      },
    });
    const p = fx('valid_horizontal_30.mp4');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('B'); // el de B sigue ahí: no se borró ni se reemplazó
    expect(readdirSync(base)).toEqual(['fixtures']); // el tmp de A se descartó
  });

  it('caché frío sin competencia: publica lo generado; caché caliente: no regenera', () => {
    base = mkdtempSync(path.join(os.tmpdir(), 'trust-fx-race-'));
    const dir = path.join(base, 'fixtures');
    let generaciones = 0;
    const gen = (tmp: string) => { generaciones += 1; escribir(tmp, 'unico'); };
    expect(readFileSync(mediaFixtures({ dir, generate: gen })('valid_towers_ab_25.mp4'), 'utf8')).toBe('unico');
    mediaFixtures({ dir, generate: gen });
    expect(generaciones).toBe(1);
    expect(() => mediaFixtures({ dir, generate: gen })('no_existe.mp4')).toThrow(/fixture inexistente/);
    expect(readdirSync(base)).toEqual(['fixtures']);
  });
});
