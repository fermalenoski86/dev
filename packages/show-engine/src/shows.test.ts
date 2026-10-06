import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseShowPackage } from '@trust/shared-types';
import { resolveStateAt } from './resolve';
import { EL_TRUST, DEMO_SCENES } from './building';
import { preflightShow, formatIssue } from './preflight';

const dir = resolve(__dirname, '../../../shows');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const ctx = { building: EL_TRUST, scenes: DEMO_SCENES };

describe('show packages en disco', () => {
  it('hay al menos un show demo', () => expect(files.length).toBeGreaterThan(0));

  for (const file of files) {
    it(`${file} cumple el contrato v1`, () => {
      const show = parseShowPackage(JSON.parse(readFileSync(resolve(dir, file), 'utf8')));
      // Ningún evento puede caer fuera de la duración declarada.
      for (const e of show.timeline) expect(e.atMs).toBeLessThanOrEqual(show.durationMs);
    });

    it(`${file} pasa preflight sin errores`, () => {
      const show = parseShowPackage(JSON.parse(readFileSync(resolve(dir, file), 'utf8')));
      const result = preflightShow(show, ctx);
      // Si algun show demo falla preflight, el mensaje dice exactamente cual y por que.
      expect(result.errors.map(formatIssue)).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it(`${file} se resuelve en cualquier t sin romper`, () => {
      const show = parseShowPackage(JSON.parse(readFileSync(resolve(dir, file), 'utf8')));
      for (let t = 0; t <= show.durationMs; t += 250) {
        const s = resolveStateAt(show, ctx, t);
        expect(s.timeMs).toBe(t);
        for (const zone of Object.values(s.zones)) {
          expect(zone.intensity).toBeGreaterThanOrEqual(0);
          expect(zone.intensity).toBeLessThanOrEqual(1);
        }
        for (const screen of Object.values(s.screens)) {
          expect(screen.mediaTimeMs).toBeGreaterThanOrEqual(0);
        }
      }
    });
  }
});
