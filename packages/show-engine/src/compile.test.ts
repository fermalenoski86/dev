import { describe, it, expect } from 'vitest';
import { parseShowPackage } from '@trust/shared-types';
import { ManualClock } from '@trust/timeline';
import { compileShow, hasDeadTail } from './compile';
import { resolveStateAt } from './resolve';
import { EL_TRUST, DEMO_SCENES } from './building';
import { ShowEngine } from './engine';

const ctx = { building: EL_TRUST, scenes: DEMO_SCENES };

const SHOW = parseShowPackage({
  id: 'c',
  name: 'Compile',
  version: 1,
  durationMs: 20000,
  media: { horizontal: '/h.mp4' },
  initialState: { lightingScene: 'trust_normal', clockState: 'normal' },
  timeline: [
    { atMs: 9000, type: 'clock.state', value: 'off' },
    { atMs: 2000, type: 'media.play', target: 'horizontal' },
    { atMs: 2000, type: 'lighting.zone.set', target: 'dome', intensity: 0.4, fadeMs: 3000 },
  ],
});

describe('compileShow', () => {
  it('ordena el timeline una sola vez', () => {
    const c = compileShow(SHOW);
    expect(c.events.map((e) => e.atMs)).toEqual([2000, 2000, 9000]);
    // Orden estable: a igual atMs manda el orden de declaracion.
    expect(c.events[0]!.type).toBe('media.play');
  });

  it('no muta el show original', () => {
    const antes = [...SHOW.timeline];
    compileShow(SHOW);
    expect(SHOW.timeline).toEqual(antes);
  });

  it('expone las discontinuidades, incluido el fin de fade', () => {
    const c = compileShow(SHOW);
    expect(c.discontinuities).toContain(2000);
    expect(c.discontinuities).toContain(5000); // 2000 + fade 3000
    expect(c.discontinuities).toContain(20000);
  });

  it('detecta cola muerta: duracion declarada muy mayor al ultimo evento', () => {
    expect(compileShow(SHOW).lastEventMs).toBe(9000);
    expect(hasDeadTail(compileShow(SHOW))).toBe(true);
    const ajustado = parseShowPackage({ ...SHOW, id: 'c2', durationMs: 9500 });
    expect(hasDeadTail(compileShow(ajustado))).toBe(false);
  });

  it('CRITERIO: compilado y sin compilar dan exactamente el mismo estado', () => {
    const c = compileShow(SHOW);
    for (let t = 0; t <= SHOW.durationMs; t += 173) {
      expect(resolveStateAt(SHOW, ctx, t, { events: c.events })).toEqual(
        resolveStateAt(SHOW, ctx, t),
      );
    }
  });

  it('el motor compila al construir y al cargar otro show', () => {
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: new ManualClock(0).now });
    expect(engine.getCompiled().events).toHaveLength(3);
    engine.loadShow(parseShowPackage({ ...SHOW, id: 'otro', timeline: [] }));
    expect(engine.getCompiled().events).toHaveLength(0);
  });

  it('un show vacio compila sin romper', () => {
    const c = compileShow(parseShowPackage({ ...SHOW, id: 'v', timeline: [] }));
    expect(c.events).toHaveLength(0);
    expect(c.lastEventMs).toBe(0);
  });
});
