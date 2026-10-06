import { describe, it, expect } from 'vitest';
import { parseShowPackage, type ShowPackage } from '@trust/shared-types';
import { ManualClock } from '@trust/timeline';
import { resolveStateAt, eventsInWindow, sortEvents } from './resolve';
import { EL_TRUST, DEMO_SCENES, MCD_RED_GOLD, TRUST_NORMAL } from './building';
import { ShowEngine } from './engine';

const ctx = { building: EL_TRUST, scenes: DEMO_SCENES };

const SHOW: ShowPackage = parseShowPackage({
  id: 'mcdonalds_takeover_001',
  name: "McDonald's Takeover Demo",
  version: 1,
  durationMs: 30000,
  media: {
    screen_a: '/demo/mcd_a.mp4',
    screen_b: '/demo/mcd_b.mp4',
    horizontal: '/demo/mcd_horizontal.mp4',
  },
  initialState: { lightingScene: 'trust_normal', clockState: 'normal', camera: 'hero_obelisco' },
  timeline: [
    { atMs: 3000, type: 'media.play', target: 'horizontal' },
    { atMs: 5000, type: 'media.play', target: 'screen_a' },
    { atMs: 5000, type: 'media.play', target: 'screen_b' },
    { atMs: 7000, type: 'lighting.scene', value: 'mcd_red_gold' },
    { atMs: 12000, type: 'clock.state', value: 'accent' },
    { atMs: 18000, type: 'camera.switch', value: 'hero_3d' },
    { atMs: 25000, type: 'lighting.scene', value: 'trust_normal' },
    { atMs: 28000, type: 'media.stop', target: 'screen_a' },
  ],
});

describe('resolveStateAt — determinismo', () => {
  it('la misma t siempre da el mismo estado', () => {
    for (const t of [0, 1, 2999, 5000, 7000, 13333, 24999, 25000, 30000]) {
      expect(resolveStateAt(SHOW, ctx, t)).toEqual(resolveStateAt(SHOW, ctx, t));
    }
  });

  it('llegar a t por seek o reproduciendo da el mismo estado de show', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: clock.now });
    engine.play();
    clock.advance(26000);
    const reproduciendo = engine.getState();

    const otro = new ShowEngine({ show: SHOW, context: ctx, now: new ManualClock(5000).now });
    otro.seek(26000);
    const saltando = otro.getState();

    // Cues, tiempos de clip e iluminacion: identicos.
    expect(saltando.zones).toEqual(reproduciendo.zones);
    expect(saltando.clockIntensity).toBe(reproduciendo.clockIntensity);
    for (const id of ['screen_a', 'screen_b', 'horizontal'] as const) {
      expect(saltando.screens[id].cue).toBe(reproduciendo.screens[id].cue);
      expect(saltando.screens[id].mediaTimeMs).toBe(reproduciendo.screens[id].mediaTimeMs);
    }
  });

  it('el output SI depende del transporte, y eso es deliberado', () => {
    // REVIEW-002 / P0-1: un show pausado en t no se ve igual que uno corriendo
    // en t. Mismo cue, distinta salida. Si fueran iguales, el pause global no
    // pausaria los videos, que es justo el bug que se corrigio.
    const corriendo = resolveStateAt(SHOW, ctx, 9000, { transport: 'playing' });
    const pausado = resolveStateAt(SHOW, ctx, 9000, { transport: 'paused' });
    expect(corriendo.screens.horizontal.cue).toBe(pausado.screens.horizontal.cue);
    expect(corriendo.screens.horizontal.output).toBe('live');
    expect(pausado.screens.horizontal.output).toBe('hold');
  });

  it('ir y volver deja exactamente el mismo estado', () => {
    const antes = resolveStateAt(SHOW, ctx, 8000);
    resolveStateAt(SHOW, ctx, 29000);
    const despues = resolveStateAt(SHOW, ctx, 8000);
    expect(despues).toEqual(antes);
  });

  it('clampea fuera de rango', () => {
    expect(resolveStateAt(SHOW, ctx, -9999).timeMs).toBe(0);
    expect(resolveStateAt(SHOW, ctx, 999999).timeMs).toBe(SHOW.durationMs);
  });
});

describe('media', () => {
  it('antes de su evento la pantalla no reproduce', () => {
    const s = resolveStateAt(SHOW, ctx, 2999);
    expect(s.screens.horizontal.cue).toBe('stopped');
    expect(s.screens.horizontal.output).toBe('black');
    expect(s.screens.screen_a.cue).toBe('stopped');
  });

  it('el evento se aplica exactamente en atMs, no en atMs+1', () => {
    expect(resolveStateAt(SHOW, ctx, 3000).screens.horizontal.cue).toBe('playing');
    expect(resolveStateAt(SHOW, ctx, 3000).screens.horizontal.output).toBe('live');
  });

  it('mediaTimeMs avanza con el show', () => {
    const s = resolveStateAt(SHOW, ctx, 9000);
    expect(s.screens.horizontal.mediaTimeMs).toBe(6000); // arrancó en 3000
    expect(s.screens.screen_a.mediaTimeMs).toBe(4000); // arrancó en 5000
  });

  it('A y B arrancan en el mismo ms y quedan sincronizadas — requisito anamórfico', () => {
    for (const t of [5000, 9000, 15500, 24000]) {
      const s = resolveStateAt(SHOW, ctx, t);
      expect(s.screens.screen_a.mediaTimeMs).toBe(s.screens.screen_b.mediaTimeMs);
    }
  });

  it('media.stop resetea el clip y no sigue corriendo', () => {
    const s = resolveStateAt(SHOW, ctx, 29500);
    expect(s.screens.screen_a.cue).toBe('stopped');
    expect(s.screens.screen_a.output).toBe('black'); // stop = negro, no frame al 12%
    expect(s.screens.screen_a.mediaTimeMs).toBe(0);
    expect(s.screens.screen_b.cue).toBe('playing'); // B no fue detenida
  });

  it('pause congela el clip donde estaba', () => {
    const show = parseShowPackage({
      ...SHOW,
      id: 'p',
      timeline: [
        { atMs: 1000, type: 'media.play', target: 'screen_a' },
        { atMs: 4000, type: 'media.pause', target: 'screen_a' },
      ],
    });
    const s = resolveStateAt(show, ctx, 20000);
    expect(s.screens.screen_a.cue).toBe('paused');
    expect(s.screens.screen_a.output).toBe('hold'); // pause = frame congelado
    expect(s.screens.screen_a.mediaTimeMs).toBe(3000);
  });

  it('media.seek reposiciona el clip y sigue desde ahí', () => {
    const show = parseShowPackage({
      ...SHOW,
      id: 's',
      timeline: [
        { atMs: 0, type: 'media.play', target: 'screen_a' },
        { atMs: 5000, type: 'media.seek', target: 'screen_a', toMs: 60000 },
      ],
    });
    const s = resolveStateAt(show, ctx, 8000);
    expect(s.screens.screen_a.mediaTimeMs).toBe(63000);
  });

  it('media.play con fromMs arranca desde un offset del clip', () => {
    const show = parseShowPackage({
      ...SHOW,
      id: 'f',
      timeline: [{ atMs: 2000, type: 'media.play', target: 'screen_b', fromMs: 10000 }],
    });
    expect(resolveStateAt(show, ctx, 5000).screens.screen_b.mediaTimeMs).toBe(13000);
  });
});

describe('iluminación', () => {
  it('el initialState aplica la escena antes de cualquier evento', () => {
    const s = resolveStateAt(SHOW, ctx, 0);
    expect(s.lightingSceneId).toBe('trust_normal');
    expect(s.zones.dome.intensity).toBe(TRUST_NORMAL.zones.dome!.intensity);
  });

  it('lighting.scene cambia todas las zonas, respetando su fade', () => {
    // El evento esta en 7000 y mcd_red_gold declara fadeMs 2500.
    // En 7000 el cambio ya esta "comandado" pero la luz todavia no se movio.
    const alDisparar = resolveStateAt(SHOW, ctx, 7000);
    expect(alDisparar.lightingSceneId).toBe('mcd_red_gold');
    expect(alDisparar.zones.tower_upper.color.g).toBeCloseTo(0.78, 3); // todavia calido

    // Pasado el fade, llego al destino.
    const completo = resolveStateAt(SHOW, ctx, 9500);
    expect(completo.zones.tower_upper.color).toEqual(MCD_RED_GOLD.zones.tower_upper!.color);
  });

  it('volver a trust_normal restaura el estado base una vez completado el fade', () => {
    const inicial = resolveStateAt(SHOW, ctx, 0);
    // trust_normal declara fadeMs 3000 y el evento esta en 25000.
    expect(resolveStateAt(SHOW, ctx, 25000).zones).not.toEqual(inicial.zones);
    expect(resolveStateAt(SHOW, ctx, 28000).zones).toEqual(inicial.zones);
  });

  it('lighting.zone.set es parcial: no toca lo que no menciona', () => {
    const show = parseShowPackage({
      ...SHOW,
      id: 'z',
      timeline: [{ atMs: 1000, type: 'lighting.zone.set', target: 'dome', intensity: 0.2 }],
    });
    const s = resolveStateAt(show, ctx, 2000);
    expect(s.zones.dome.intensity).toBe(0.2);
    expect(s.zones.dome.color).toEqual(TRUST_NORMAL.zones.dome!.color);
    expect(s.zones.clock.intensity).toBe(TRUST_NORMAL.zones.clock!.intensity);
  });

  it('una escena desconocida no rompe el motor en vivo (pero preflight la rechaza antes)', () => {
    const show = parseShowPackage({
      ...SHOW,
      id: 'x',
      timeline: [{ atMs: 1000, type: 'lighting.scene', value: 'escena_que_no_existe' }],
    });
    const s = resolveStateAt(show, ctx, 2000);
    expect(s.zones.dome.intensity).toBe(TRUST_NORMAL.zones.dome!.intensity);
  });
});

describe('eventos simultáneos', () => {
  it('con el mismo atMs gana el último declarado (orden estable)', () => {
    const show = parseShowPackage({
      ...SHOW,
      id: 'sim',
      timeline: [
        { atMs: 5000, type: 'lighting.zone.set', target: 'dome', intensity: 0.1 },
        { atMs: 5000, type: 'lighting.zone.set', target: 'dome', intensity: 0.9 },
      ],
    });
    expect(resolveStateAt(show, ctx, 5000).zones.dome.intensity).toBe(0.9);
  });

  it('el orden de declaración manda aunque el array venga desordenado por tiempo', () => {
    const show = parseShowPackage({
      ...SHOW,
      id: 'ord',
      timeline: [
        { atMs: 9000, type: 'clock.state', value: 'off' },
        { atMs: 2000, type: 'clock.state', value: 'accent' },
      ],
    });
    expect(resolveStateAt(show, ctx, 5000).clockState).toBe('accent');
    expect(resolveStateAt(show, ctx, 9000).clockState).toBe('off');
  });

  it('sortEvents no muta el timeline original', () => {
    const copia = [...SHOW.timeline];
    sortEvents(SHOW.timeline);
    expect(SHOW.timeline).toEqual(copia);
  });
});

describe('eventsInWindow', () => {
  it('devuelve solo los eventos de (from, to]', () => {
    const e = eventsInWindow(SHOW, 3000, 7000);
    expect(e.map((x) => x.atMs)).toEqual([5000, 5000, 7000]);
  });
  it('ventana vacía o invertida devuelve nada', () => {
    expect(eventsInWindow(SHOW, 5000, 5000)).toHaveLength(0);
    expect(eventsInWindow(SHOW, 9000, 1000)).toHaveLength(0);
  });
});

describe('ShowEngine', () => {
  it('SAFE MODE apaga las pantallas y fuerza luz cálida', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: clock.now });
    engine.play();
    clock.advance(10000);
    expect(engine.getState().screens.horizontal.output).toBe('live');

    engine.enterSafeMode();
    const s = engine.getState();
    expect(s.lightingSceneId).toBe('safe_mode');
    // Las tres en negro, sin excepcion. Ningun frame de marca sobrevive.
    for (const screen of Object.values(s.screens)) expect(screen.output).toBe('black');
    expect(s.clockState).toBe('normal');
  });

  it('en SAFE MODE el play no reanuda nada', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: clock.now });
    engine.enterSafeMode();
    engine.play();
    expect(engine.getStatus()).not.toBe('playing');
  });

  it('salir de SAFE MODE devuelve el control al show', () => {
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: clock.now });
    engine.seek(10000);
    engine.enterSafeMode();
    engine.exitSafeMode();
    expect(engine.getState().lightingSceneId).toBe('mcd_red_gold');
  });

  it('cargar otro show resetea el transporte', () => {
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: new ManualClock(0).now });
    engine.seek(20000);
    engine.loadShow(parseShowPackage({ ...SHOW, id: 'otro', durationMs: 10000, timeline: [] }));
    expect(engine.getTimeMs()).toBe(0);
    expect(engine.getDurationMs()).toBe(10000);
  });

  it('getStateAt no mueve el transporte', () => {
    const engine = new ShowEngine({ show: SHOW, context: ctx, now: new ManualClock(0).now });
    engine.seek(4000);
    engine.getStateAt(28000);
    expect(engine.getTimeMs()).toBe(4000);
  });
});

describe('contrato del show package', () => {
  it('rechaza un show sin duración', () => {
    expect(() => parseShowPackage({ ...SHOW, durationMs: 0 })).toThrow();
  });
  it('rechaza un tipo de evento no implementado todavía', () => {
    expect(() =>
      parseShowPackage({ ...SHOW, timeline: [{ atMs: 0, type: 'artnet.scene', value: 'x' }] }),
    ).toThrow();
  });
  it('rechaza un target de pantalla inexistente', () => {
    expect(() =>
      parseShowPackage({ ...SHOW, timeline: [{ atMs: 0, type: 'media.play', target: 'screen_z' }] }),
    ).toThrow();
  });
  it('rechaza intensidad fuera de 0..1', () => {
    expect(() =>
      parseShowPackage({
        ...SHOW,
        timeline: [{ atMs: 0, type: 'lighting.zone.set', target: 'dome', intensity: 4 }],
      }),
    ).toThrow();
  });
});
