import { describe, it, expect } from 'vitest';
import { parseShowPackage, type ShowPackage } from '@trust/shared-types';
import { ManualClock } from '@trust/timeline';
import { resolveStateAt, deriveOutput } from './resolve';
import { EL_TRUST, DEMO_SCENES } from './building';
import { ShowEngine } from './engine';

const ctx = { building: EL_TRUST, scenes: DEMO_SCENES };

const SHOW: ShowPackage = parseShowPackage({
  id: 'playback',
  name: 'Playback',
  version: 1,
  durationMs: 30000,
  media: { horizontal: '/demo/test_horizontal.mp4' },
  mediaGroups: {
    towers: {
      source: '/demo/test_towers_master.mp4',
      layout: {
        screen_a: { x: 0, y: 0.5, w: 1, h: 0.5 },
        screen_b: { x: 0, y: 0, w: 1, h: 0.5 },
      },
    },
  },
  initialState: { lightingScene: 'trust_normal', clockState: 'normal' },
  timeline: [
    { atMs: 1000, type: 'media.play', target: 'screen_a' },
    { atMs: 1000, type: 'media.play', target: 'screen_b' },
    { atMs: 1000, type: 'media.play', target: 'horizontal' },
    { atMs: 8000, type: 'media.pause', target: 'horizontal' },
    { atMs: 22000, type: 'media.stop', target: 'horizontal' },
  ],
});

describe('REVIEW-002 P0-1: pause global congela de verdad', () => {
  it('CRITERIO: pausar en 10000ms deja el media clavado ahi', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: clock.now });
    engine.play();
    clock.advance(10000);
    expect(engine.getState().screens.screen_a.output).toBe('live');

    engine.pause();
    const alPausar = engine.getState();
    expect(alPausar.screens.screen_a.mediaTimeMs).toBe(9000);
    expect(alPausar.screens.screen_a.output).toBe('hold');

    // Muchos ticks despues, con el reloj de pared corriendo, nada se movio.
    for (let i = 0; i < 40; i++) {
      clock.advance(250);
      const s = engine.getState();
      expect(s.screens.screen_a.mediaTimeMs).toBe(9000);
      expect(s.screens.screen_a.output).toBe('hold');
      expect(s.timeMs).toBe(10000);
    }
  });

  it('el cue sobrevive a la pausa: al reanudar sigue, no reinicia', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: clock.now });
    engine.play();
    clock.advance(5000);
    engine.pause();
    expect(engine.getState().screens.screen_a.cue).toBe('playing');
    clock.advance(99000);
    engine.play();
    clock.advance(1000);
    expect(engine.getState().screens.screen_a.mediaTimeMs).toBe(5000);
    expect(engine.getState().screens.screen_a.output).toBe('live');
  });
});

describe('REVIEW-002 P0-2: pause, stop y SAFE MODE se ven distinto', () => {
  it('media.pause congela el frame (hold), no lo apaga', () => {
    const s = resolveStateAt(SHOW, ctx, 12000, { transport: 'playing' });
    expect(s.screens.horizontal.cue).toBe('paused');
    expect(s.screens.horizontal.output).toBe('hold');
    expect(s.screens.horizontal.mediaTimeMs).toBe(7000);
  });

  it('media.stop va a negro y resetea', () => {
    const s = resolveStateAt(SHOW, ctx, 25000, { transport: 'playing' });
    expect(s.screens.horizontal.output).toBe('black');
    expect(s.screens.horizontal.mediaTimeMs).toBe(0);
  });

  it('SAFE MODE pone TODAS las pantallas en negro, sin excepcion', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: clock.now });
    engine.play();
    clock.advance(12000);
    engine.enterSafeMode();
    const s = engine.getState();
    for (const screen of Object.values(s.screens)) {
      expect(screen.output).toBe('black');
    }
    expect(s.lightingSceneId).toBe('safe_mode');
  });

  it('SAFE MODE gana incluso sobre una pantalla en hold', () => {
    // La horizontal esta pausada en 12000: sin SAFE MODE seria `hold`.
    expect(resolveStateAt(SHOW, ctx, 12000, { transport: 'playing' }).screens.horizontal.output).toBe('hold');
    expect(
      resolveStateAt(SHOW, ctx, 12000, { transport: 'playing', safeMode: true }).screens.horizontal
        .output,
    ).toBe('black');
  });

  it('la tabla de verdad completa', () => {
    const t = (cue: 'playing' | 'paused' | 'stopped', tr: 'playing' | 'paused' | 'ended' | 'stopped', safe = false) =>
      deriveOutput(cue, '/x.mp4', true, tr, safe);
    expect(t('playing', 'playing')).toBe('live');
    expect(t('playing', 'paused')).toBe('hold');
    expect(t('playing', 'ended')).toBe('hold');
    // REVIEW-003 / P0-2: STOP global es negro. La linea anterior decia 'hold'
    // y consagraba el bug: un test verde sobre una semantica equivocada.
    expect(t('playing', 'stopped')).toBe('black');
    expect(t('paused', 'stopped')).toBe('black');
    expect(t('stopped', 'stopped')).toBe('black');
    expect(t('paused', 'playing')).toBe('hold');
    expect(t('stopped', 'playing')).toBe('black');
    expect(t('playing', 'playing', true)).toBe('black');
    expect(deriveOutput('playing', null, true, 'playing')).toBe('black');
    expect(deriveOutput('playing', '/x.mp4', false, 'playing')).toBe('black');
  });
});

describe('REVIEW-002 P1-5: frame-lock A+B', () => {
  it('A y B comparten UNA fuente: un solo decoder', () => {
    const s = resolveStateAt(SHOW, ctx, 9000);
    expect(s.screens.screen_a.source).toBe('/demo/test_towers_master.mp4');
    expect(s.screens.screen_b.source).toBe(s.screens.screen_a.source);
  });

  it('cada una recorta su mitad del master', () => {
    const s = resolveStateAt(SHOW, ctx, 9000);
    expect(s.screens.screen_a.uv).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
    expect(s.screens.screen_b.uv).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(s.screens.horizontal.uv).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('deriva cero en todo el show, no solo al arrancar', () => {
    for (let t = 0; t <= SHOW.durationMs; t += 137) {
      const s = resolveStateAt(SHOW, ctx, t);
      expect(s.screens.screen_a.mediaTimeMs).toBe(s.screens.screen_b.mediaTimeMs);
      expect(s.screens.screen_a.output).toBe(s.screens.screen_b.output);
    }
  });
});

describe('REVIEW-002 P1-8: fin de show', () => {
  it('el transporte pasa a `ended`, no se queda en playing', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: clock.now });
    engine.play();
    clock.advance(31000);
    expect(engine.getStatus()).toBe('ended');
    expect(engine.getTimeMs()).toBe(30000);
  });

  it('con el show terminado el media no sigue live', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: clock.now });
    engine.play();
    clock.advance(31000);
    const s = engine.getState();
    // screen_a sigue con cue playing (nadie la detuvo) pero no esta live.
    expect(s.screens.screen_a.cue).toBe('playing');
    expect(s.screens.screen_a.output).toBe('hold');
  });

  it('el tiempo no se mueve despues del final aunque el reloj corra', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: clock.now });
    engine.play();
    clock.advance(31000);
    clock.advance(60000);
    expect(engine.getTimeMs()).toBe(30000);
  });

  it('seekear hacia atras desde el final lo saca de ended', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: clock.now });
    engine.play();
    clock.advance(31000);
    engine.seek(5000);
    expect(engine.getStatus()).toBe('paused');
    expect(engine.getTimeMs()).toBe(5000);
  });
});

describe('REVIEW-002 P1-3: reloj determinista', () => {
  it('el brillo hace fade y es funcion de t', () => {
    const show = parseShowPackage({
      ...SHOW,
      id: 'clk',
      timeline: [{ atMs: 5000, type: 'clock.state', value: 'accent' }],
    });
    const antes = resolveStateAt(show, ctx, 4999).clockIntensity;
    const alDisparar = resolveStateAt(show, ctx, 5000).clockIntensity;
    const aMitad = resolveStateAt(show, ctx, 5600).clockIntensity;
    const completo = resolveStateAt(show, ctx, 7000).clockIntensity;
    expect(antes).toBeCloseTo(0.9, 3);
    expect(alDisparar).toBeCloseTo(0.9, 3);
    expect(aMitad).toBeGreaterThan(0.9);
    expect(aMitad).toBeLessThan(1.6);
    expect(completo).toBeCloseTo(1.6, 3);
  });

  it('CRITERIO: seek y reproduccion dan el mismo reloj', () => {
    const show = parseShowPackage({
      ...SHOW,
      id: 'clk2',
      timeline: [
        { atMs: 2000, type: 'clock.state', value: 'accent' },
        { atMs: 9000, type: 'clock.state', value: 'off' },
      ],
    });
    for (const t of [2400, 2600, 5000, 9300, 9800, 11000]) {
      const clock = new ManualClock(0);
      const repro = new ShowEngine({ show, context: ctx, now: clock.now });
      repro.play();
      clock.advance(t);
      const salto = new ShowEngine({ show, context: ctx, now: new ManualClock(42).now });
      salto.seek(t);
      expect(salto.getState().clockIntensity).toBe(repro.getState().clockIntensity);
      expect(salto.getState().clockAngleDeg).toBe(repro.getState().clockAngleDeg);
    }
  });

  it('la aguja es funcion del tiempo, nunca del framerate', () => {
    expect(resolveStateAt(SHOW, ctx, 0).clockAngleDeg).toBe(0);
    expect(resolveStateAt(SHOW, ctx, 30000).clockAngleDeg).toBeCloseTo(3, 3);
  });

  it('con hora de pared inyectada la aguja la sigue a ella', () => {
    const s = resolveStateAt(SHOW, ctx, 1000, { wallClockMs: 30000 });
    expect(s.clockAngleDeg).toBeCloseTo(3, 3);
  });
});

describe('REVIEW-002 P2-9: enabled respeta el fade de salida', () => {
  it('apagar con fade baja primero y corta al final', () => {
    const show = parseShowPackage({
      ...SHOW,
      id: 'gate',
      timeline: [
        {
          atMs: 1000,
          type: 'lighting.zone.set',
          target: 'dome',
          intensity: 0,
          enabled: false,
          fadeMs: 4000,
        },
      ],
    });
    // Durante el fade la zona sigue habilitada: la luz baja, no se corta.
    expect(resolveStateAt(show, ctx, 3000).zones.dome.enabled).toBe(true);
    expect(resolveStateAt(show, ctx, 3000).zones.dome.intensity).toBeGreaterThan(0);
    // Al terminar, el corte duro.
    expect(resolveStateAt(show, ctx, 5000).zones.dome.enabled).toBe(false);
  });

  it('encender es inmediato: primero el rele, despues la subida', () => {
    const show = parseShowPackage({
      ...SHOW,
      id: 'gate2',
      timeline: [
        { atMs: 0, type: 'lighting.zone.set', target: 'dome', intensity: 0, enabled: false },
        {
          atMs: 2000,
          type: 'lighting.zone.set',
          target: 'dome',
          intensity: 1,
          enabled: true,
          fadeMs: 3000,
        },
      ],
    });
    expect(resolveStateAt(show, ctx, 2000).zones.dome.enabled).toBe(true);
  });
});


describe('REVIEW-003 P0-2: STOP global = BLACK', () => {
  const DESDE_CERO: ShowPackage = parseShowPackage({
    ...SHOW,
    id: 'stop_cero',
    // El caso que la review pidio: media.play en el ms 0.
    timeline: [
      { atMs: 0, type: 'media.play', target: 'screen_a' },
      { atMs: 0, type: 'media.play', target: 'screen_b' },
      { atMs: 0, type: 'media.play', target: 'horizontal' },
    ],
  });

  it('CRITERIO: stop con media.play en 0ms deja las tres en negro', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: DESDE_CERO, context: ctx, now: clock.now });
    engine.play();
    clock.advance(9000);
    for (const s of Object.values(engine.getState().screens)) expect(s.output).toBe('live');

    engine.stop();
    const parado = engine.getState();
    expect(parado.timeMs).toBe(0);
    for (const s of Object.values(parado.screens)) {
      // El cue sigue siendo playing en t=0: por eso antes quedaba en `hold`
      // y el primer frame del contenido se veia con el show detenido.
      expect(s.cue).toBe('playing');
      expect(s.output).toBe('black');
    }
  });

  it('stop antes de haber reproducido nunca: igual negro', () => {
    const engine = new ShowEngine({ show: DESDE_CERO, context: ctx, now: new ManualClock(0).now });
    for (const s of Object.values(engine.getState().screens)) expect(s.output).toBe('black');
  });

  it('pause y stop se distinguen en el mismo instante', () => {
    const clock = new ManualClock(0);
    const a = new ShowEngine({ show: DESDE_CERO, context: ctx, now: clock.now });
    a.play();
    clock.advance(5000);
    a.pause();
    expect(a.getState().screens.screen_a.output).toBe('hold');

    const clock2 = new ManualClock(0);
    const b = new ShowEngine({ show: DESDE_CERO, context: ctx, now: clock2.now });
    b.play();
    clock2.advance(5000);
    b.stop();
    expect(b.getState().screens.screen_a.output).toBe('black');
  });

  it('despues de stop, play vuelve a poner en live', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: DESDE_CERO, context: ctx, now: clock.now });
    engine.play();
    clock.advance(5000);
    engine.stop();
    engine.play();
    clock.advance(100);
    expect(engine.getState().screens.screen_a.output).toBe('live');
  });
});

describe('REVIEW-003: Transport.snapshot() nunca reporta status viejo', () => {
  it('snapshot en el instante en que el show termina dice ended', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: clock.now });
    engine.play();
    clock.advance(30000);
    // Sin settle() al inicio de snapshot, esto devolvia 'playing'.
    expect(engine.getStatus()).toBe('ended');
  });
});
