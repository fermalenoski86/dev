import { describe, it, expect } from 'vitest';
import { EL_TRUST, DEMO_SCENES, preflightShow, ShowEngine } from '@trust/show-engine';
import { parseShowPackage } from '@trust/shared-types';
import { ManualClock } from '@trust/timeline';
import {
  blockingAssets,
  fallbackAssets,
  isAssetSatisfied,
  markFailed,
  markLoaded,
} from './index';
import {
  compileTakeoverDraft,
  createRepoRegistry,
  presetById,
  validateDraft,
  momentAt,
} from '@trust/show-authoring';
import {
  BRAND_MOMENTS,
  DEFAULT_VIEW,
  DEMO_PRESET_ID,
  END_CARD_BLOCKS,
  EXPERIENCE_VIEWS,
  INITIAL_EXPERIENCE,
  TRANSPARENCY_TECHNICAL,
  HOME_HEADLINE,
  WHY_BLOCKS,
  canPlay,
  demoReset,
  enterCinema,
  exitCinema,
  isLocalExperienceAsset,
  isReadyToPresent,
  loadProgress,
  nonLocalAssets,
  requiredAssets,
  setComparison,
  setView,
  shortcutFor,
  SHOW_LATERAL_VIEWS,
  viewList,
  type ExperienceState,
} from './index';

const registry = createRepoRegistry();
const ctx = { building: EL_TRUST, assets: registry, sceneIds: new Set(DEMO_SCENES.keys()) };
const preflightCtx = { building: EL_TRUST, scenes: DEMO_SCENES };

/** Estado con todo precargado, como queda tras el preload de la página. */
const cargado = (): ExperienceState => ({ ...INITIAL_EXPERIENCE, loaded: requiredAssets(), phase: 'READY' });

/* ════════════════════════════════════════════════════════════════
 * El motor sigue siendo la única autoridad
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2: ShowEngine sigue siendo la unica verdad', () => {
  it('CRITERIO: la experiencia carga el preset McDonald\u2019s y compila READY', () => {
    const preset = presetById(DEMO_PRESET_ID);
    expect(preset).toBeDefined();
    const draft = preset!.build();
    const compiled = compileTakeoverDraft(draft, ctx);
    expect(compiled.ok).toBe(true);
    const pkg = parseShowPackage(compiled.showPackage);
    expect(pkg.durationMs).toBe(15000);
    expect(preflightShow(pkg, preflightCtx).errors).toEqual([]);
    expect(validateDraft(draft, { ...ctx, preflight: preflightCtx }).status).toBe('READY');
  });

  it('CRITERIO: el nucleo de experiencia NO resuelve shows', async () => {
    /*
     * La garantia es estructural: el modulo no exporta nada que calcule
     * estado del edificio. Si alguna vez apareciera, la presentacion dejaria
     * de mostrar el producto y pasaria a mostrar una animacion parecida.
     */
    const api = await import('./index');
    for (const prohibido of ['resolveStateAt', 'ShowEngine', 'compileShow', 'sampleTelemetry']) {
      expect(Object.keys(api)).not.toContain(prohibido);
    }

    // Y el fuente no importa el motor: ni siquiera de forma indirecta.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const fuente = readFileSync(resolve(__dirname, 'experience.ts'), 'utf8');
    expect(fuente).not.toContain('@trust/show-engine');
  });

  it('los brand moments apuntan a presets existentes, no a estados nuevos', () => {
    for (const spec of Object.values(BRAND_MOMENTS)) {
      expect(presetById(spec.presetId), spec.id).toBeDefined();
    }
  });

  it('cada brand moment compila contra el motor real', () => {
    for (const spec of Object.values(BRAND_MOMENTS)) {
      const draft = presetById(spec.presetId)!.build();
      const compiled = compileTakeoverDraft(draft, ctx);
      expect(compiled.ok, spec.id).toBe(true);
      expect(preflightShow(parseShowPackage(compiled.showPackage), preflightCtx).errors).toEqual([]);
    }
  });

  it('SIGNATURE apunta a un instante que existe dentro del show', () => {
    const spec = BRAND_MOMENTS.SIGNATURE;
    const draft = presetById(spec.presetId)!.build();
    const total = draft.moments.reduce((a, m) => a + m.durationMs, 0);
    expect(spec.seekToMs).not.toBeNull();
    expect(spec.seekToMs!).toBeLessThan(total);
    expect(momentAt(draft, spec.seekToMs!)?.moment.name.toLowerCase()).toContain('signature');
  });
});

/* ════════════════════════════════════════════════════════════════
 * Vistas
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2: vistas', () => {
  it('existen las cuatro vistas pedidas', () => {
    expect(Object.keys(EXPERIENCE_VIEWS).sort()).toEqual(
      ['CORRIENTES', 'HERO_CORNER', 'OBELISCO_WIDE', 'PELLEGRINI'].sort(),
    );
  });

  it('la vista por defecto es HERO CORNER', () => {
    expect(DEFAULT_VIEW).toBe('HERO_CORNER');
    expect(INITIAL_EXPERIENCE.view).toBe('HERO_CORNER');
  });

  it('con las laterales habilitadas, la barra principal muestra tres vistas', () => {
    expect(viewList(true, true).map((v) => v.id)).toEqual(['HERO_CORNER', 'CORRIENTES', 'PELLEGRINI']);
    expect(EXPERIENCE_VIEWS.OBELISCO_WIDE.primary).toBe(false);
  });

  it('CRITERIO: por defecto el selector ejecutivo muestra solo HERO CORNER', () => {
    // Corrientes y Pellegrini son recortes del mismo plano de la esquina.
    expect(SHOW_LATERAL_VIEWS).toBe(false);
    expect(viewList(true).map((v) => v.id)).toEqual(['HERO_CORNER']);
    expect(EXPERIENCE_VIEWS.CORRIENTES).toBeDefined();
  });

  it('CRITERIO: cambiar de vista no toca nada del show', () => {
    // Es lo que hace util la comparacion entre frentes: el cliente ve el MISMO
    // instante desde otro angulo. Si reiniciara, compararia dos momentos
    // distintos y por lo tanto nada.
    const antes = { ...cargado(), phase: 'PLAYING' as const };
    const despues = setView(antes, 'PELLEGRINI');
    expect(despues.view).toBe('PELLEGRINI');
    expect({ ...despues, view: antes.view }).toEqual(antes);
  });

  it('CRITERIO: cambiar de vista con el motor corriendo no altera timeMs ni estado', () => {
    const preset = presetById(DEMO_PRESET_ID)!;
    const pkg = parseShowPackage(compileTakeoverDraft(preset.build(), ctx).showPackage);
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: pkg, context: preflightCtx, now: clock.now });
    engine.play();
    clock.advance(7000);

    const t = engine.getTimeMs();
    const estado = engine.getState();

    // Toda la operacion de vista ocurre en el estado de presentacion: el
    // motor ni se entera de que hubo un cambio de camara.
    const final = setView(setView(cargado(), 'CORRIENTES'), 'PELLEGRINI');
    expect(final.view).toBe('PELLEGRINI');

    expect(engine.getTimeMs()).toBe(t);
    expect(engine.getState()).toEqual(estado);
    expect(engine.getStatus()).toBe('playing');
  });

  it('cada vista declara qué superficies se ven desde ahí', () => {
    expect(EXPERIENCE_VIEWS.HERO_CORNER.surfaces).toHaveLength(3);
    expect(EXPERIENCE_VIEWS.CORRIENTES.surfaces).toContain('screen_a');
    expect(EXPERIENCE_VIEWS.CORRIENTES.surfaces).not.toContain('screen_b');
    expect(EXPERIENCE_VIEWS.PELLEGRINI.surfaces).toContain('screen_b');
  });
});

/* ════════════════════════════════════════════════════════════════
 * Offline
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2: la presentacion corre sin internet', () => {
  it('CRITERIO: ningun asset de la experiencia usa http/https', () => {
    // Una presentacion no puede depender del wifi del cliente: un asset que no
    // carga delante de una direccion de marketing arruina la reunion, y no hay
    // segunda oportunidad para esa demo.
    expect(nonLocalAssets()).toEqual([]);
    for (const a of requiredAssets()) {
      expect(a.startsWith('/'), a).toBe(true);
      expect(/^https?:/i.test(a), a).toBe(false);
    }
  });

  it('rechaza esquemas, hosts y rutas relativas', () => {
    for (const malo of [
      'https://cdn.marca.com/hero.jpg',
      'http://10.0.0.5/v.mp4',
      '//cdn/x.jpg',
      'data:image/png;base64,AAA',
      'experience/hero.jpg',
      '/experience/../../etc/passwd',
    ]) {
      expect(isLocalExperienceAsset(malo), malo).toBe(false);
    }
    expect(isLocalExperienceAsset('/experience/hero-corner.jpg')).toBe(true);
  });

  it('los fondos de las cuatro vistas estan en la lista de precarga', () => {
    const req = requiredAssets();
    for (const v of Object.values(EXPERIENCE_VIEWS)) expect(req).toContain(v.background);
  });

  it('los fondos existen en el servidor de la experiencia', async () => {
    // Un fondo declarado que no existe da un cuadro negro en la reunion.
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const publicDir = resolve(__dirname, '../../../apps/control/public');
    for (const a of requiredAssets()) {
      expect(existsSync(resolve(publicDir, `.${a}`)), a).toBe(true);
    }
  });
});

/* ════════════════════════════════════════════════════════════════
 * Precarga y PLAY
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2: precarga', () => {
  it('CRITERIO: PLAY no se habilita hasta tener todo en memoria', () => {
    const parcial: ExperienceState = { ...INITIAL_EXPERIENCE, loaded: requiredAssets().slice(0, 2) };
    expect(isReadyToPresent(parcial)).toBe(false);
    expect(canPlay(parcial)).toBe(false);
    expect(canPlay(cargado())).toBe(true);
  });

  it('falta UN asset y sigue sin estar listo', () => {
    const casi: ExperienceState = {
      ...INITIAL_EXPERIENCE,
      phase: 'READY',
      loaded: requiredAssets().slice(0, -1),
    };
    expect(isReadyToPresent(casi)).toBe(false);
    expect(canPlay(casi)).toBe(false);
  });

  it('el progreso va de 0 a 1', () => {
    expect(loadProgress(pre({ loaded: [] }))).toBe(0);
    expect(loadProgress(pre({ loaded: requiredAssets() }))).toBe(1);
    expect(loadProgress(pre({ loaded: requiredAssets().slice(0, 3) }))).toBeCloseTo(3 / requiredAssets().length, 6);
  });

  it('assets ajenos no cuentan para el progreso', () => {
    expect(loadProgress(pre({ loaded: ['/otro.png', '/mas.png'] }))).toBe(0);
  });
});

/** Completa el estado de precarga: los tests viejos solo pasaban `loaded`. */
function pre(p: { loaded: string[]; failed?: string[]; fallbacks?: Record<string, string> }) {
  return { loaded: p.loaded, failed: p.failed ?? [], fallbacks: p.fallbacks ?? {} };
}

/* ════════════════════════════════════════════════════════════════
 * M2C.2.1 / punto 6 — un asset que falla NO cuenta como cargado
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1: precarga con fallos', () => {
  const hero = '/experience/hero-corner.jpg';

  it('CRITERIO: un error de carga no cuenta como loaded', () => {
    const s = markFailed(pre({ loaded: [] }), hero);
    expect(s.loaded).not.toContain(hero);
    expect(s.failed).toContain(hero);
    expect(isAssetSatisfied(s, hero)).toBe(false);
  });

  it('CRITERIO: si falta el Hero Corner NO hay READY', () => {
    const todos = requiredAssets();
    const sinHero = pre({ loaded: todos.filter((a) => a !== hero), failed: [hero] });
    expect(isReadyToPresent(sinHero)).toBe(false);
    expect(canPlay({ ...INITIAL_EXPERIENCE, ...sinHero, phase: 'READY' })).toBe(false);
    expect(blockingAssets(sinHero)).toEqual([hero]);
  });

  it('CRITERIO: un fallback local verificado habilita READY', () => {
    const todos = requiredAssets();
    const conFallback = pre({
      loaded: [...todos.filter((a) => a !== hero), '/experience/hero-corner-fallback.jpg'],
      failed: [hero],
      fallbacks: { [hero]: '/experience/hero-corner-fallback.jpg' },
    });
    expect(isReadyToPresent(conFallback)).toBe(true);
    expect(blockingAssets(conFallback)).toEqual([]);
    // Se sabe que anda por reemplazo: eso se muestra en modo operador, no al cliente.
    expect(fallbackAssets(conFallback)).toEqual([hero]);
  });

  it('un fallback declarado pero NO cargado no alcanza', () => {
    const todos = requiredAssets();
    const s = pre({
      loaded: todos.filter((a) => a !== hero),
      failed: [hero],
      fallbacks: { [hero]: '/experience/no-existe.jpg' },
    });
    expect(isReadyToPresent(s)).toBe(false);
  });

  it('reintentar con éxito saca el asset de failed', () => {
    const s = markLoaded(markFailed(pre({ loaded: [] }), hero), hero);
    expect(s.loaded).toContain(hero);
    expect(s.failed).not.toContain(hero);
  });

  it('el progreso cuenta los fallbacks satisfechos', () => {
    const todos = requiredAssets();
    const s = pre({
      loaded: [...todos.filter((a) => a !== hero), '/fb.jpg'],
      failed: [hero],
      fallbacks: { [hero]: '/fb.jpg' },
    });
    expect(loadProgress(s)).toBe(1);
  });
});

/* ════════════════════════════════════════════════════════════════
 * Cinema, reset y atajos
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2: cinema mode y demo reset', () => {
  it('cinema entra y sale sin tocar nada mas', () => {
    const base = cargado();
    const cine = enterCinema(base);
    expect(cine.cinema).toBe(true);
    expect({ ...cine, cinema: false }).toEqual(base);
    expect(exitCinema(cine)).toEqual(base);
  });

  it('CRITERIO: demo reset vuelve a un estado conocido', () => {
    const revuelto: ExperienceState = {
      ...cargado(),
      view: 'OBELISCO_WIDE',
      brandMoment: 'EVENT',
      comparison: 'BEFORE',
      cinema: true,
      audioEnabled: true,
      phase: 'ENDED',
    };
    const limpio = demoReset(revuelto);
    expect(limpio.view).toBe('HERO_CORNER');
    expect(limpio.brandMoment).toBe('TAKEOVER');
    expect(limpio.comparison).toBe('TAKEOVER');
    expect(limpio.cinema).toBe(false);
    expect(limpio.audioEnabled).toBe(false);
    expect(limpio.phase).toBe('READY');
  });

  it('CRITERIO: el reset NO vuelve a descargar los assets', () => {
    // Volver a LOADING obligaria a esperar la precarga otra vez delante del
    // cliente, que es justo lo que el boton existe para evitar.
    const limpio = demoReset(cargado());
    expect(limpio.loaded).toEqual(requiredAssets());
    expect(canPlay(limpio)).toBe(true);
  });

  it('reset sin precarga completa queda en LOADING, no finge estar listo', () => {
    const parcial: ExperienceState = { ...INITIAL_EXPERIENCE, loaded: [requiredAssets()[0]!] };
    expect(demoReset(parcial).phase).toBe('LOADING');
  });

  it('atajos: R, espacio y ESC', () => {
    expect(shortcutFor('r')).toBe('reset');
    expect(shortcutFor('R')).toBe('reset');
    expect(shortcutFor(' ')).toBe('playPause');
    expect(shortcutFor('Escape')).toBe('exitCinema');
    expect(shortcutFor('k')).toBeNull();
  });

  it('BEFORE/TAKEOVER es puramente visual', () => {
    const base = cargado();
    const antes = setComparison(base, 'BEFORE');
    expect(antes.comparison).toBe('BEFORE');
    // No toca fase, vista ni nada del show.
    expect({ ...antes, comparison: 'TAKEOVER' }).toEqual(base);
  });

  it('audio arranca en silencio', () => {
    expect(INITIAL_EXPERIENCE.audioEnabled).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════
 * Transparencia
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2: transparencia', () => {
  it('CRITERIO: MEASUREMENT marca Audience Analytics como capacidad futura', () => {
    const m = END_CARD_BLOCKS.find((b) => b.title === 'MEASUREMENT');
    expect(m).toBeDefined();
    expect(m!.body).toContain('future capability');
    expect(m!.planned).toBe(true);
  });

  it('la end card tiene los tres bloques pedidos', () => {
    expect(END_CARD_BLOCKS.map((b) => b.title)).toEqual(['BRAND DOMINANCE', 'REAL-TIME MOMENTS', 'MEASUREMENT']);
  });

  it('CRITERIO: el panel WHY tiene exactamente LOCATION, IMPACT y PLATFORM', () => {
    expect(WHY_BLOCKS.map((b) => b.title)).toEqual(['LOCATION', 'IMPACT', 'PLATFORM']);
  });

  it('CRITERIO: el copy del cliente no vende iluminación ni reloj como instalados', () => {
    // Capacidad de HOY: tres superficies digitales y un momento sincronizado.
    // Iluminación y reloj van en HOW IT WORKS como next phase.
    const copy = [
      ...WHY_BLOCKS.map((b) => `${b.title} ${b.body}`),
      ...Object.values(BRAND_MOMENTS).map((m) => m.pitch),
      HOME_HEADLINE,
    ].join(' ').toLowerCase();
    expect(copy).not.toMatch(/iluminaci|reloj|lighting|clock/);
    expect(HOME_HEADLINE).toBe('3 superficies digitales · 1 momento sincronizado');
  });

  it('CRITERIO: no se afirma que haya hardware conectado', () => {
    const texto = [
      ...END_CARD_BLOCKS.map((b) => `${b.title} ${b.body}`),
      ...WHY_BLOCKS.map((b) => `${b.title} ${b.body}`),
      TRANSPARENCY_TECHNICAL,
    ]
      .join(' ')
      .toLowerCase();
    for (const afirmacion of ['hardware conectado', 'en vivo', 'live hardware', 'conectado al edificio']) {
      expect(texto, afirmacion).not.toContain(afirmacion);
    }
    expect(TRANSPARENCY_TECHNICAL).toContain('etapa de implementación');
  });
});
