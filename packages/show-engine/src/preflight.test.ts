import { describe, it, expect } from 'vitest';
import { parseShowPackage } from '@trust/shared-types';
import { preflightShow } from './preflight';
import { EL_TRUST, DEMO_SCENES } from './building';

const ctx = { building: EL_TRUST, scenes: DEMO_SCENES };

const base = {
  id: 'pf',
  name: 'Preflight',
  version: 1,
  durationMs: 10000,
  media: { screen_a: '/a.mp4' },
  initialState: { lightingScene: 'trust_normal', clockState: 'normal' },
  timeline: [],
};
const build = (patch: Record<string, unknown>) => parseShowPackage({ ...base, ...patch });
const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);

describe('preflightShow', () => {
  it('un show valido pasa', () => {
    const r = preflightShow(
      build({ timeline: [{ atMs: 1000, type: 'media.play', target: 'screen_a' }] }),
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('CRITERIO #4: rechaza escena inexistente', () => {
    const r = preflightShow(
      build({ timeline: [{ atMs: 1000, type: 'lighting.scene', value: 'no_existe' }] }),
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('SCENE_NOT_FOUND');
    expect(r.errors[0]!.message).toContain('no_existe');
    expect(r.errors[0]!.atMs).toBe(1000);
  });

  it('CRITERIO #4: rechaza evento despues del fin del show', () => {
    const r = preflightShow(
      build({ timeline: [{ atMs: 15000, type: 'clock.state', value: 'off' }] }),
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('EVENT_AFTER_DURATION');
  });

  it('rechaza escena inicial inexistente', () => {
    const r = preflightShow(
      build({ initialState: { lightingScene: 'fantasma', clockState: 'normal' } }),
      ctx,
    );
    expect(codes(r)).toContain('INITIAL_SCENE_NOT_FOUND');
  });

  it('rechaza reproducir una pantalla sin media declarado', () => {
    const r = preflightShow(
      build({ timeline: [{ atMs: 0, type: 'media.play', target: 'horizontal' }] }),
      ctx,
    );
    expect(codes(r)).toContain('PLAY_WITHOUT_MEDIA');
  });

  it('rechaza media apuntando a una pantalla inexistente', () => {
    // Zod ya frena los IDs del enum; esto cubre el caso de un building distinto.
    const show = build({});
    const r = preflightShow(show, {
      ...ctx,
      building: { ...EL_TRUST, screens: EL_TRUST.screens.filter((s) => s.id !== 'screen_a') },
    });
    expect(codes(r)).toContain('MEDIA_SCREEN_NOT_FOUND');
  });

  it('BLOQUEA si A y B se separan mas de un frame', () => {
    const r = preflightShow(
      build({
        media: { screen_a: '/a.mp4', screen_b: '/b.mp4' },
        timeline: [
          { atMs: 1000, type: 'media.play', target: 'screen_a' },
          { atMs: 1200, type: 'media.play', target: 'screen_b' },
        ],
      }),
      ctx,
    );
    // 200ms son 6 frames a 30fps: el anamorfico se abre. Error, no warning.
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('SCREENS_OUT_OF_SYNC');
  });

  it('detecta desincronia creada por un seek POSTERIOR, no solo por el primer play', () => {
    // REVIEW-002 / P1-7: esto es lo que el chequeo por nombre de evento no veia.
    const r = preflightShow(
      build({
        media: { screen_a: '/a.mp4', screen_b: '/b.mp4' },
        timeline: [
          { atMs: 1000, type: 'media.play', target: 'screen_a' },
          { atMs: 1000, type: 'media.play', target: 'screen_b' },
          { atMs: 5000, type: 'media.seek', target: 'screen_b', toMs: 9000 },
        ],
      }),
      ctx,
    );
    expect(codes(r)).toContain('SCREENS_OUT_OF_SYNC');
  });

  it('detecta desincronia creada por fromMs distintos', () => {
    const r = preflightShow(
      build({
        media: { screen_a: '/a.mp4', screen_b: '/b.mp4' },
        timeline: [
          { atMs: 1000, type: 'media.play', target: 'screen_a', fromMs: 0 },
          { atMs: 1000, type: 'media.play', target: 'screen_b', fromMs: 2000 },
        ],
      }),
      ctx,
    );
    expect(codes(r)).toContain('SCREENS_OUT_OF_SYNC');
  });

  it('avisa si A y B usan decoders separados', () => {
    const r = preflightShow(
      build({
        media: { screen_a: '/a.mp4', screen_b: '/b.mp4' },
        timeline: [
          { atMs: 1000, type: 'media.play', target: 'screen_a' },
          { atMs: 1000, type: 'media.play', target: 'screen_b' },
        ],
      }),
      ctx,
    );
    expect(r.warnings.map((w) => w.code)).toContain('SCREENS_SEPARATE_DECODERS');
  });

  it('un mediaGroup da frame-lock perfecto y no dispara nada', () => {
    const r = preflightShow(
      build({
        media: {},
        mediaGroups: {
          towers: {
            source: '/master.mp4',
            layout: {
              screen_a: { x: 0, y: 0.5, w: 1, h: 0.5 },
              screen_b: { x: 0, y: 0, w: 1, h: 0.5 },
            },
          },
        },
        timeline: [
          { atMs: 1000, type: 'media.play', target: 'screen_a' },
          { atMs: 1000, type: 'media.play', target: 'screen_b' },
        ],
      }),
      ctx,
    );
    expect(codes(r)).not.toContain('SCREENS_OUT_OF_SYNC');
    expect(r.warnings.map((w) => w.code)).not.toContain('SCREENS_SEPARATE_DECODERS');
  });

  it('detecta un zone.set que vuelve a pintar una zona de firma despues del cierre', () => {
    // El chequeo viejo miraba el ultimo lighting.scene y esto se le escapaba.
    const r = preflightShow(
      build({
        timeline: [
          { atMs: 5000, type: 'lighting.scene', value: 'mcd_red_gold' },
          { atMs: 7000, type: 'lighting.scene', value: 'trust_normal' },
          { atMs: 9000, type: 'lighting.zone.set', target: 'dome', color: { r: 1, g: 0, b: 0, w: 0 } },
        ],
      }),
      ctx,
    );
    expect(r.warnings.map((w) => w.code)).toContain('ENDS_IN_TAKEOVER');
  });

  it('no bloquea si A y B arrancan juntas', () => {
    const r = preflightShow(
      build({
        media: { screen_a: '/a.mp4', screen_b: '/b.mp4' },
        timeline: [
          { atMs: 1000, type: 'media.play', target: 'screen_a' },
          { atMs: 1000, type: 'media.play', target: 'screen_b' },
        ],
      }),
      ctx,
    );
    expect(r.warnings.map((w) => w.code)).not.toContain('SCREENS_OUT_OF_SYNC');
  });

  it('avisa si el show termina con la marca puesta', () => {
    const r = preflightShow(
      build({ timeline: [{ atMs: 5000, type: 'lighting.scene', value: 'mcd_red_gold' }] }),
      ctx,
    );
    expect(r.warnings.map((w) => w.code)).toContain('ENDS_IN_TAKEOVER');
  });

  it('avisa si una pantalla queda con frame congelado al cierre', () => {
    const r = preflightShow(
      build({
        timeline: [
          { atMs: 1000, type: 'media.play', target: 'screen_a' },
          { atMs: 5000, type: 'media.pause', target: 'screen_a' },
        ],
      }),
      ctx,
    );
    expect(r.warnings.map((w) => w.code)).toContain('ENDS_ON_FROZEN_FRAME');
  });

  it('REVIEW-003 P1-5: rechaza un uvRect que se sale de la fuente', () => {
    const uv = (r: Record<string, number>) => () =>
      build({
        mediaGroups: {
          towers: {
            source: '/m.mp4',
            layout: { screen_a: r, screen_b: { x: 0, y: 0, w: 1, h: 0.5 } },
          },
        },
      });
    expect(uv({ x: 0.8, y: 0, w: 0.5, h: 1 })).toThrow(); // x + w > 1
    expect(uv({ x: 0, y: 0.7, w: 1, h: 0.5 })).toThrow(); // y + h > 1
    expect(uv({ x: 0, y: 0, w: 0, h: 1 })).toThrow(); // ancho cero
    expect(uv({ x: 0, y: 0, w: 1, h: 0 })).toThrow(); // alto cero
    expect(uv({ x: 0, y: 0.5, w: 1, h: 0.5 })).not.toThrow(); // mitad superior, valido
    expect(uv({ x: 0, y: 0, w: 1, h: 1 })).not.toThrow(); // frame completo
  });

  it('junta varios errores en vez de frenar en el primero', () => {
    const r = preflightShow(
      build({
        timeline: [
          { atMs: 1000, type: 'lighting.scene', value: 'x' },
          { atMs: 2000, type: 'lighting.scene', value: 'y' },
          { atMs: 99000, type: 'clock.state', value: 'off' },
        ],
      }),
      ctx,
    );
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});
