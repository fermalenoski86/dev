import { describe, it, expect } from 'vitest';
import {
  parseShowPackage,
  uvFromPixels,
  UvRectSchema,
  type BuildingConfig,
} from '@trust/shared-types';
import { resolveStateAt } from './resolve';
import { preflightShow, isLocalMediaPath } from './preflight';
import { EL_TRUST, DEMO_SCENES } from './building';

/**
 * Gate V3.1 — punto 6: mediaGroups definidos por show.
 *
 * Lienzo superior real (P6.67):
 *   Corrientes 7,68 x 3,84 m -> 1152 x 576 px
 *   Pellegrini 9,60 x 3,84 m -> 1440 x 576 px
 *   total                    -> 2592 x 576 px
 */

const ctx = { building: EL_TRUST, scenes: DEMO_SCENES };
const CANVAS = { width: 2592, height: 576 };
const A = uvFromPixels(CANVAS, { x: 0, y: 0, width: 1152, height: 576 });
const B = uvFromPixels(CANVAS, { x: 1152, y: 0, width: 1440, height: 576 });

const base = {
  id: 'g',
  name: 'Grupos',
  version: 1,
  durationMs: 10000,
  media: { horizontal: '/demo/h.mp4' },
  initialState: { lightingScene: 'trust_normal', clockState: 'normal' },
  timeline: [
    { atMs: 1000, type: 'media.play', target: 'screen_a' },
    { atMs: 1000, type: 'media.play', target: 'screen_b' },
    { atMs: 1000, type: 'media.play', target: 'horizontal' },
    { atMs: 9000, type: 'media.stop', target: 'screen_a' },
    { atMs: 9000, type: 'media.stop', target: 'screen_b' },
    { atMs: 9000, type: 'media.stop', target: 'horizontal' },
  ],
};
const show = (mediaGroups: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  parseShowPackage({ ...base, mediaGroups, ...extra });
const errores = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);

describe('lienzo superior real 2592 x 576', () => {
  it('uvFromPixels reparte el lienzo exacto entre Corrientes y Pellegrini', () => {
    expect(A.x).toBe(0);
    expect(A.w).toBeCloseTo(1152 / 2592, 12);
    expect(B.x).toBeCloseTo(1152 / 2592, 12);
    expect(B.w).toBeCloseTo(1440 / 2592, 12);
    expect(A.x + A.w).toBeCloseTo(B.x, 12); // contiguos, sin hueco ni solape
    expect(B.x + B.w).toBeCloseTo(1, 12); // llega justo al borde
    expect(A.h).toBe(1);
    expect(B.h).toBe(1);
  });

  it('los recortes pasan la validacion geometrica pese a la coma flotante', () => {
    expect(UvRectSchema.safeParse(A).success).toBe(true);
    expect(UvRectSchema.safeParse(B).success).toBe(true);
  });

  it('uvFromPixels invierte Y: arriba en el lienzo es y alto en UV', () => {
    const arriba = uvFromPixels({ width: 100, height: 200 }, { x: 0, y: 0, width: 100, height: 100 });
    const abajo = uvFromPixels({ width: 100, height: 200 }, { x: 0, y: 100, width: 100, height: 100 });
    expect(arriba.y).toBe(0.5);
    expect(abajo.y).toBe(0);
  });

  it('el edificio tiene las medidas confirmadas', () => {
    const a = EL_TRUST.screens.find((s) => s.id === 'screen_a')!;
    const b = EL_TRUST.screens.find((s) => s.id === 'screen_b')!;
    expect([a.physicalWidthM, a.physicalHeightM, a.pixelWidth, a.pixelHeight]).toEqual([7.68, 3.84, 1152, 576]);
    expect([b.physicalWidthM, b.physicalHeightM, b.pixelWidth, b.pixelHeight]).toEqual([9.6, 3.84, 1440, 576]);
    expect(a.pixelWidth + b.pixelWidth).toBe(2592);
  });
});

describe('membresia definida por el show', () => {
  it('A+B en un grupo: misma fuente, recortes distintos, horizontal aparte', () => {
    const s = show({ towers: { source: '/demo/m.mp4', canvas: CANVAS, layout: { screen_a: A, screen_b: B } } });
    const st = resolveStateAt(s, ctx, 5000);
    expect(st.screens.screen_a.source).toBe('/demo/m.mp4');
    expect(st.screens.screen_b.source).toBe('/demo/m.mp4');
    expect(st.screens.horizontal.source).toBe('/demo/h.mp4');
    expect(st.screens.screen_a.uv).toEqual(A);
    expect(st.screens.screen_b.uv).toEqual(B);
    expect(preflightShow(s, ctx).ok).toBe(true);
  });

  it('A+B+horizontal en un solo grupo, sin tocar el motor ni el edificio', () => {
    const lienzo = { width: 2592, height: 988 }; // 576 arriba + 412 abajo
    const s = show({
      all: {
        source: '/demo/tres.mp4',
        canvas: lienzo,
        layout: {
          screen_a: uvFromPixels(lienzo, { x: 0, y: 0, width: 1152, height: 576 }),
          screen_b: uvFromPixels(lienzo, { x: 1152, y: 0, width: 1440, height: 576 }),
          horizontal: uvFromPixels(lienzo, { x: 0, y: 576, width: 1920, height: 412 }),
        },
      },
    });
    const st = resolveStateAt(s, ctx, 5000);
    const fuentes = new Set(Object.values(st.screens).map((x) => x.source));
    expect(fuentes).toEqual(new Set(['/demo/tres.mp4'])); // un decoder para las tres
    for (const t of [1000, 3333, 8999]) {
      const r = resolveStateAt(s, ctx, t);
      expect(r.screens.screen_a.mediaTimeMs).toBe(r.screens.horizontal.mediaTimeMs);
      expect(r.screens.screen_b.mediaTimeMs).toBe(r.screens.horizontal.mediaTimeMs);
    }
    const pre = preflightShow(s, ctx);
    expect(pre.errors).toEqual([]);
  });

  it('dos campanias distintas agrupan distinto con el MISMO edificio', () => {
    const soloTorres = show({ t: { source: '/demo/m.mp4', layout: { screen_a: A, screen_b: B } } });
    const sinGrupos = parseShowPackage({ ...base, media: { screen_a: '/demo/a.mp4', screen_b: '/demo/b.mp4', horizontal: '/demo/h.mp4' } });
    expect(resolveStateAt(soloTorres, ctx, 5000).screens.screen_a.source).toBe('/demo/m.mp4');
    expect(resolveStateAt(sinGrupos, ctx, 5000).screens.screen_a.source).toBe('/demo/a.mp4');
    expect(resolveStateAt(sinGrupos, ctx, 5000).screens.screen_a.uv).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('el grupo tiene prioridad sobre `media` para sus miembros', () => {
    const s = show(
      { t: { source: '/demo/m.mp4', layout: { screen_a: A, screen_b: B } } },
      { media: { screen_a: '/demo/ignorado.mp4', horizontal: '/demo/h.mp4' } },
    );
    expect(resolveStateAt(s, ctx, 5000).screens.screen_a.source).toBe('/demo/m.mp4');
  });
});

describe('capacidad del edificio vs membresia del show', () => {
  it('BLOQUEA un grupo entre pantallas que el edificio no puede sincronizar', () => {
    const sinCapacidad: BuildingConfig = {
      ...EL_TRUST,
      screens: EL_TRUST.screens.map((s) => ({ ...s, syncCapableWith: [] })),
    };
    const s = show({ t: { source: '/demo/m.mp4', layout: { screen_a: A, screen_b: B } } });
    const r = preflightShow(s, { ...ctx, building: sinCapacidad });
    expect(errores(r)).toContain('GROUP_NOT_SYNC_CAPABLE');
  });

  it('la capacidad tiene que ser mutua para cada par del grupo', () => {
    const asimetrico: BuildingConfig = {
      ...EL_TRUST,
      screens: EL_TRUST.screens.map((s) =>
        s.id === 'horizontal' ? { ...s, syncCapableWith: ['screen_a'] } : s,
      ),
    };
    const lienzo = { width: 2592, height: 988 };
    const s = show({
      all: {
        source: '/demo/tres.mp4',
        layout: {
          screen_a: uvFromPixels(lienzo, { x: 0, y: 0, width: 1152, height: 576 }),
          screen_b: uvFromPixels(lienzo, { x: 1152, y: 0, width: 1440, height: 576 }),
          horizontal: uvFromPixels(lienzo, { x: 0, y: 576, width: 1920, height: 412 }),
        },
      },
    });
    expect(errores(preflightShow(s, { ...ctx, building: asimetrico }))).toContain('GROUP_NOT_SYNC_CAPABLE');
  });

  it('BLOQUEA una pantalla en dos grupos: tiene un solo decoder', () => {
    const s = show({
      uno: { source: '/demo/1.mp4', layout: { screen_a: A, screen_b: B } },
      dos: { source: '/demo/2.mp4', layout: { screen_b: B, horizontal: { x: 0, y: 0, w: 1, h: 1 } } },
    });
    expect(errores(preflightShow(s, ctx))).toContain('SCREEN_IN_MULTIPLE_GROUPS');
  });

  it('aun con doble membresia, resolve es determinista (primer grupo por id)', () => {
    const s = show({
      zeta: { source: '/demo/z.mp4', layout: { screen_a: A, screen_b: B } },
      alfa: { source: '/demo/a.mp4', layout: { screen_a: A, screen_b: B } },
    });
    expect(resolveStateAt(s, ctx, 5000).screens.screen_a.source).toBe('/demo/a.mp4');
  });

  it('BLOQUEA un recorte con otro aspecto que la pantalla fisica', () => {
    // Repartir el lienzo 50/50 estira Corrientes y aplasta Pellegrini.
    const s = show({
      t: {
        source: '/demo/m.mp4',
        canvas: CANVAS,
        layout: { screen_a: { x: 0, y: 0, w: 0.5, h: 1 }, screen_b: { x: 0.5, y: 0, w: 0.5, h: 1 } },
      },
    });
    expect(errores(preflightShow(s, ctx))).toContain('GROUP_ASPECT_MISMATCH');
  });

  it('avisa si un grupo tiene una sola pantalla', () => {
    const s = show({ t: { source: '/demo/m.mp4', layout: { screen_a: A } } });
    expect(preflightShow(s, ctx).warnings.map((w) => w.code)).toContain('GROUP_SINGLE_MEMBER');
  });
});

describe('Gate V3.1 punto 3: limites de uvRect', () => {
  const ok = (r: Record<string, number>) => UvRectSchema.safeParse(r).success;

  it('acepta los bordes exactos', () => {
    expect(ok({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(ok({ x: 0.75, y: 0, w: 0.25, h: 1 })).toBe(true); // x + w = 1 exacto
    expect(ok({ x: 0, y: 0.5, w: 1, h: 0.5 })).toBe(true); // y + h = 1 exacto
    expect(ok({ x: 0.999, y: 0.999, w: 0.001, h: 0.001 })).toBe(true); // minimo en la esquina
  });

  it('rechaza origen negativo', () => {
    expect(ok({ x: -0.01, y: 0, w: 0.5, h: 1 })).toBe(false);
    expect(ok({ x: 0, y: -0.01, w: 1, h: 0.5 })).toBe(false);
  });

  it('rechaza ancho o alto cero o negativo', () => {
    expect(ok({ x: 0, y: 0, w: 0, h: 1 })).toBe(false);
    expect(ok({ x: 0, y: 0, w: 1, h: 0 })).toBe(false);
    expect(ok({ x: 0, y: 0, w: -0.5, h: 1 })).toBe(false);
  });

  it('rechaza salirse por la derecha o por arriba', () => {
    expect(ok({ x: 0.8, y: 0, w: 0.5, h: 1 })).toBe(false);
    expect(ok({ x: 0, y: 0.7, w: 1, h: 0.5 })).toBe(false);
    expect(ok({ x: 0.5, y: 0, w: 0.5000001, h: 1 })).toBe(false); // por encima del epsilon
  });

  it('rechaza componentes mayores a 1', () => {
    expect(ok({ x: 0, y: 0, w: 1.2, h: 1 })).toBe(false);
    expect(ok({ x: 1.1, y: 0, w: 0.1, h: 1 })).toBe(false);
  });

  it('rechaza valores no numericos', () => {
    expect(UvRectSchema.safeParse({ x: '0', y: 0, w: 1, h: 1 }).success).toBe(false);
    expect(UvRectSchema.safeParse({ x: Number.NaN, y: 0, w: 1, h: 1 }).success).toBe(false);
  });
});

describe('Gate V3.1 punto 7: guard interino de fuentes (ADR-014)', () => {
  it('acepta rutas locales', () => {
    expect(isLocalMediaPath('/demo/test_towers_master.mp4')).toBe(true);
    expect(isLocalMediaPath('/assets/campania/clip.mp4')).toBe(true);
  });

  it('rechaza URLs, hosts, esquemas y escapes', () => {
    for (const mala of [
      'https://cdn.agencia.com/clip.mp4',
      'http://192.168.1.20/admin',
      '//evil.example/clip.mp4',
      'file:///etc/passwd',
      'data:video/mp4;base64,AAAA',
      'blob:https://x/1',
      'javascript:alert(1)',
      'demo/relativa.mp4',
      '/demo/../../secretos.mp4',
      '/demo\\..\\x.mp4', // barra invertida (Windows-style)
      '/demo/clip\u0000.mp4',
      '/demo/\nclip.mp4',
      '',
    ]) {
      expect(isLocalMediaPath(mala), mala).toBe(false);
    }
  });

  it('preflight bloquea un show que apunta afuera, en media y en mediaGroups', () => {
    const s = parseShowPackage({
      ...base,
      media: { horizontal: 'https://cdn.agencia.com/h.mp4' },
      mediaGroups: { t: { source: 'http://10.0.0.5/m.mp4', layout: { screen_a: A, screen_b: B } } },
    });
    const r = preflightShow(s, ctx);
    expect(r.ok).toBe(false);
    expect(r.errors.filter((e) => e.code === 'MEDIA_SOURCE_NOT_LOCAL')).toHaveLength(2);
  });
});
