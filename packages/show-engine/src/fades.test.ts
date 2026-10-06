import { describe, it, expect } from 'vitest';
import { parseShowPackage, type ShowPackage } from '@trust/shared-types';
import { ManualClock } from '@trust/timeline';
import { resolveStateAt } from './resolve';
import { EL_TRUST, DEMO_SCENES } from './building';
import { ShowEngine } from './engine';

const ctx = { building: EL_TRUST, scenes: DEMO_SCENES };

/**
 * REVIEW-001 / P0. Criterio de cierre #1:
 * "Un show con fade produce exactamente el mismo estado visual al reproducir
 *  y al seekear al mismo ms."
 */

const FADE: ShowPackage = parseShowPackage({
  id: 'fade_test',
  name: 'Fade',
  version: 1,
  durationMs: 20000,
  media: {},
  initialState: { lightingScene: 'trust_normal', clockState: 'normal' },
  timeline: [
    { atMs: 2000, type: 'lighting.zone.set', target: 'dome', intensity: 0, fadeMs: 8000 },
    { atMs: 12000, type: 'lighting.zone.set', target: 'dome', intensity: 1, fadeMs: 4000 },
  ],
});

describe('fades como parte del estado', () => {
  it('interpola linealmente durante el fade', () => {
    const inicio = resolveStateAt(FADE, ctx, 2000).zones.dome.intensity;
    expect(inicio).toBeCloseTo(0.85, 5); // trust_normal

    // 8000ms de fade desde 0.85 hasta 0. A mitad, 0.425.
    expect(resolveStateAt(FADE, ctx, 6000).zones.dome.intensity).toBeCloseTo(0.425, 4);
    expect(resolveStateAt(FADE, ctx, 4000).zones.dome.intensity).toBeCloseTo(0.6375, 4);
    expect(resolveStateAt(FADE, ctx, 10000).zones.dome.intensity).toBeCloseTo(0, 5);
  });

  it('el valor queda fijo despues de terminar el fade', () => {
    expect(resolveStateAt(FADE, ctx, 10000).zones.dome.intensity).toBeCloseTo(0, 5);
    expect(resolveStateAt(FADE, ctx, 11999).zones.dome.intensity).toBeCloseTo(0, 5);
  });

  it('un fade nuevo arranca desde el valor actual, no desde el destino anterior', () => {
    const show = parseShowPackage({
      ...FADE,
      id: 'interrupt',
      timeline: [
        { atMs: 0, type: 'lighting.zone.set', target: 'dome', intensity: 0, fadeMs: 10000 },
        // Interrumpe a mitad: la zona esta en 0.425, no en 0 ni en 0.85.
        { atMs: 5000, type: 'lighting.zone.set', target: 'dome', intensity: 1, fadeMs: 5000 },
      ],
    });
    expect(resolveStateAt(show, ctx, 5000).zones.dome.intensity).toBeCloseTo(0.425, 4);
    // De 0.425 a 1 en 5000ms: a mitad, 0.7125.
    expect(resolveStateAt(show, ctx, 7500).zones.dome.intensity).toBeCloseTo(0.7125, 4);
    expect(resolveStateAt(show, ctx, 10000).zones.dome.intensity).toBeCloseTo(1, 5);
  });

  it('CRITERIO #1: seek y reproduccion dan el mismo estado a mitad de fade', () => {
    for (const t of [2500, 4000, 5999, 6000, 9999, 13000, 15500]) {
      const clock = new ManualClock(0);
      const reproduciendo = new ShowEngine({ show: FADE, context: ctx, now: clock.now });
      reproduciendo.play();
      clock.advance(t);

      const saltando = new ShowEngine({ show: FADE, context: ctx, now: new ManualClock(777).now });
      saltando.seek(t);

      expect(saltando.getState()).toEqual(reproduciendo.getState());
    }
  });

  it('CRITERIO #1: llegar por pasos o de un salto da lo mismo', () => {
    const clock = new ManualClock(0);
    const porPasos = new ShowEngine({ show: FADE, context: ctx, now: clock.now });
    porPasos.play();
    for (let i = 0; i < 70; i++) clock.advance(100); // 70 frames de 100ms

    const deUnSalto = new ShowEngine({ show: FADE, context: ctx, now: new ManualClock(0).now });
    deUnSalto.seek(7000);

    expect(porPasos.getState().zones).toEqual(deUnSalto.getState().zones);
  });

  it('ir, volver y volver a ir no acumula error', () => {
    const engine = new ShowEngine({ show: FADE, context: ctx, now: new ManualClock(0).now });
    engine.seek(5000);
    const primera = engine.getState().zones.dome.intensity;
    for (const t of [19000, 0, 12345, 1, 5000]) engine.seek(t);
    expect(engine.getState().zones.dome.intensity).toBe(primera);
  });

  it('fadeMs=0 es un salto instantaneo', () => {
    const show = parseShowPackage({
      ...FADE,
      id: 'cut',
      timeline: [{ atMs: 5000, type: 'lighting.zone.set', target: 'dome', intensity: 0.1 }],
    });
    expect(resolveStateAt(show, ctx, 4999).zones.dome.intensity).toBeCloseTo(0.85, 4);
    expect(resolveStateAt(show, ctx, 5000).zones.dome.intensity).toBeCloseTo(0.1, 5);
  });

  it('una escena aplica su fadeMs a todas sus zonas', () => {
    const show = parseShowPackage({
      ...FADE,
      id: 'scene_fade',
      timeline: [{ atMs: 1000, type: 'lighting.scene', value: 'mcd_red_gold' }],
    });
    // mcd_red_gold declara fadeMs 2500. A mitad la torre esta entre ambos valores.
    const mitad = resolveStateAt(show, ctx, 2250).zones.tower_upper;
    const final = resolveStateAt(show, ctx, 3500).zones.tower_upper;
    expect(mitad.color.r).toBeGreaterThan(0);
    expect(mitad.color.g).toBeGreaterThan(final.color.g); // todavia viene del calido
    expect(final.color.g).toBeCloseTo(0.1, 4);
  });

  it('el evento puede pisar el fadeMs de la escena', () => {
    const show = parseShowPackage({
      ...FADE,
      id: 'override',
      timeline: [{ atMs: 1000, type: 'lighting.scene', value: 'mcd_red_gold', fadeMs: 0 }],
    });
    expect(resolveStateAt(show, ctx, 1000).zones.tower_upper.color.g).toBeCloseTo(0.1, 4);
  });

  it('el estado inicial no hace fade: el show arranca ya en su base', () => {
    expect(resolveStateAt(FADE, ctx, 0).zones.dome.intensity).toBeCloseTo(0.85, 5);
  });

  it('las intensidades nunca salen de 0..1 durante un fade', () => {
    for (let t = 0; t <= FADE.durationMs; t += 97) {
      for (const zone of Object.values(resolveStateAt(FADE, ctx, t).zones)) {
        expect(zone.intensity).toBeGreaterThanOrEqual(0);
        expect(zone.intensity).toBeLessThanOrEqual(1);
      }
    }
  });
});
