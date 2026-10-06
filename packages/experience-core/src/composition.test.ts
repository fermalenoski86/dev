import { describe, it, expect } from 'vitest';
import { EL_TRUST, DEMO_SCENES, resolveStateAt } from '@trust/show-engine';
import { parseShowPackage } from '@trust/shared-types';
import {
  compileTakeoverDraft,
  createRepoRegistry,
  presetById,
} from '@trust/show-authoring';
import {
  BACKUP_VIDEO,
  BRAND_MOMENTS,
  DEMO_CHECKS,
  EXPERIENCE_VIEWS,
  VIEW_GEOMETRY,
  activeSources,
  brandMomentAction,
  clockPlan,
  demoCheckReport,
  lightPlan,
  quadBounds,
  quadToMatrix3d,
  surfacePlan,
  type DemoCheckResult,
} from './index';

const ctx = { building: EL_TRUST, assets: createRepoRegistry(), sceneIds: new Set(DEMO_SCENES.keys()) };
const preflightCtx = { building: EL_TRUST, scenes: DEMO_SCENES };

const SHOW = parseShowPackage(
  compileTakeoverDraft(presetById('MCDONALDS_15S')!.build(), ctx).showPackage,
);
const at = (t: number, transport: 'playing' | 'paused' | 'stopped' = 'playing') =>
  resolveStateAt(SHOW, preflightCtx, t, { transport });

/* ════════════════════════════════════════════════════════════════
 * M2C.2.1 / 2 — media real en las superficies
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1 punto 2: el renderer recibe media real', () => {
  it('CRITERIO: con output LIVE hay una fuente concreta, no un degradado', () => {
    const plan = surfacePlan(at(8000), 'HERO_CORNER');
    const vivas = plan.filter((p) => p.output === 'live');
    expect(vivas.length).toBeGreaterThan(0);
    for (const p of vivas) {
      expect(p.source, p.id).toBeTruthy();
      expect(p.source!.endsWith('.mp4')).toBe(true);
    }
  });

  it('CRITERIO: A+B usan el MISMO master con uvRect distintos', () => {
    const plan = surfacePlan(at(8000), 'HERO_CORNER');
    const a = plan.find((p) => p.id === 'screen_a')!;
    const b = plan.find((p) => p.id === 'screen_b')!;
    expect(a.source).toBe(b.source);
    expect(a.uv).not.toEqual(b.uv);
    // Un solo decoder para las dos: es lo que garantiza el frame-lock.
    expect(activeSources(plan.filter((p) => p.id !== 'horizontal'))).toHaveLength(1);
  });

  it('CRITERIO: BLACK no expone media visible', () => {
    const plan = surfacePlan(at(0, 'stopped'), 'HERO_CORNER');
    for (const p of plan) {
      expect(p.output, p.id).toBe('black');
      expect(p.source, p.id).toBeNull();
    }
  });

  it('el tiempo de clip viaja al renderer para que pueda sincronizar', () => {
    const plan = surfacePlan(at(9000), 'HERO_CORNER');
    const a = plan.find((p) => p.id === 'screen_a')!;
    expect(a.mediaTimeMs).toBeGreaterThan(0);
    expect(a.mediaTimeMs).toBe(at(9000).screens.screen_a.mediaTimeMs);
  });

  it('cada vista planifica solo sus superficies', () => {
    const ids = (v: 'CORRIENTES' | 'PELLEGRINI') => [...new Set(surfacePlan(at(8000), v).map((p) => p.id))].sort();
    expect(ids('CORRIENTES')).toEqual(['horizontal', 'screen_a']);
    expect(ids('PELLEGRINI')).toEqual(['horizontal', 'screen_b']);
  });

  it('sin estado no se inventa nada', () => {
    for (const p of surfacePlan(null, 'HERO_CORNER')) {
      expect(p.output).toBe('black');
      expect(p.source).toBeNull();
    }
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2C.2.1 / 3 — perspectiva por cuadriláteros
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1 punto 3: homografía', () => {
  it('un trapecio de lados paralelos es afín: sin perspectiva, y está bien', () => {
    // Si los dos bordes verticales son paralelos, la proyección correcta ES
    // afín. Que el término de perspectiva dé 0 acá no es un bug.
    const m = quadToMatrix3d(
      { tl: { x: 0.1, y: 0.2 }, tr: { x: 0.9, y: 0.1 }, br: { x: 0.9, y: 0.5 }, bl: { x: 0.1, y: 0.6 } },
      1000,
      600,
    );
    const v = m.replace('matrix3d(', '').replace(')', '').split(',').map(Number);
    expect(v[3] ?? 0).toBeCloseTo(0, 9);
    expect(v[7] ?? 0).toBeCloseTo(0, 9);
  });

  it('un quad que es el cuadrado unidad da una transformación sin deformación', () => {
    const m = quadToMatrix3d(
      { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } },
      100,
      100,
    );
    const v = m.replace('matrix3d(', '').replace(')', '').split(',').map(Number);
    expect(v[0] ?? 0).toBeCloseTo(100, 6); // escala x
    expect(v[5] ?? 0).toBeCloseTo(100, 6); // escala y
    expect(v[3] ?? 0).toBeCloseTo(0, 9); // sin perspectiva
    expect(v[7] ?? 0).toBeCloseTo(0, 9);
  });

  it('CRITERIO: un trapecio produce perspectiva real, no un skew', () => {
    // Los lados NO son paralelos: el borde derecho es más alto que el
    // izquierdo, como una pantalla vista de costado. Con skewY los términos de
    // perspectiva serían 0 y el contenido se deslizaría respecto del edificio.
    const m = quadToMatrix3d(
      { tl: { x: 0.2, y: 0.25 }, tr: { x: 0.8, y: 0.15 }, br: { x: 0.85, y: 0.55 }, bl: { x: 0.15, y: 0.6 } },
      1000,
      600,
    );
    const v = m.replace('matrix3d(', '').replace(')', '').split(',').map(Number);
    expect(Math.abs(v[3] ?? 0) + Math.abs(v[7] ?? 0)).toBeGreaterThan(0);
    expect(v.every((n) => Number.isFinite(n))).toBe(true);
  });

  it('un quad degenerado no emite NaN', () => {
    const m = quadToMatrix3d(
      { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } },
      100,
      100,
    );
    expect(m).not.toContain('NaN');
  });

  it('cada vista con pantallas declara un quad por cada una', () => {
    for (const view of Object.values(EXPERIENCE_VIEWS)) {
      const geo = VIEW_GEOMETRY[view.id];
      // OBELISCO_WIDE no dibuja pantallas a propósito: a esa distancia serían
      // rectángulos de dos píxeles sobre una foto nocturna.
      if (Object.keys(geo.surfaces).length === 0) continue;
      for (const s of view.surfaces) {
        expect(geo.surfaces[s], `${view.id}/${s}`).toBeDefined();
      }
    }
  });

  it('todos los quads caen dentro del master', () => {
    for (const geo of Object.values(VIEW_GEOMETRY)) {
      for (const valor of Object.values(geo.surfaces)) {
        for (const quad of Array.isArray(valor) ? valor : [valor!]) {
        const b = quadBounds(quad);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(1);
        expect(b.y + b.h).toBeLessThanOrEqual(1);
        expect(b.w).toBeGreaterThan(0);
        expect(b.h).toBeGreaterThan(0);
        }
      }
    }
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2C.2.1 / 4 y 5 — luz y reloj
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1 puntos 4 y 5: luz por capas y reloj', () => {
  it('CRITERIO: en takeover la cúpula NO toma el color de la fachada', () => {
    // mcd_red_gold deja cúpula y reloj dorados y tiñe la torre. Con un solo
    // círculo borroso eso era invisible.
    const t = 9000;
    const capas = lightPlan(at(t), 'HERO_CORNER');
    const dome = capas.find((c) => c.label === 'dome')!;
    const facade = capas.find((c) => c.label === 'facade')!;
    expect(dome.color).not.toBe(facade.color);
    expect(dome.intensity).toBeGreaterThan(0);
  });

  it('cada capa se alimenta de zonas que existen en el edificio', () => {
    const zonas = new Set(EL_TRUST.lightingZones.map((z) => z.id));
    for (const geo of Object.values(VIEW_GEOMETRY)) {
      for (const capa of geo.lights) {
        for (const z of capa.zones) expect(zonas.has(z as never), z).toBe(true);
      }
    }
  });

  it('sin estado las capas quedan apagadas', () => {
    for (const c of lightPlan(null, 'HERO_CORNER')) expect(c.intensity).toBe(0);
  });

  it('el reloj refleja el estado del motor y nada más', () => {
    const p = clockPlan(at(9000), 'HERO_CORNER')!;
    expect(['normal', 'off', 'accent', 'countdown']).toContain(p.state);
    expect(p.intensity).toBe(at(9000).clockIntensity);
    expect(p.angleDeg).toBe(at(9000).clockAngleDeg);
  });

  it('la vista general no dibuja reloj: a esa distancia no se lee', () => {
    expect(clockPlan(at(9000), 'OBELISCO_WIDE')).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2C.2.1 / 7 — Brand Moments con seek
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1 punto 7: SIGNATURE usa seekToMs', () => {
  it('CRITERIO: SIGNATURE pide saltar a 12 s y quedar pausado', () => {
    const a = brandMomentAction('SIGNATURE');
    expect(a.presetId).toBe('MCDONALDS_15S');
    expect(a.seekToMs).toBe(12_000);
    expect(a.pauseAfterSeek).toBe(true);
  });

  it('los momentos sin seek arrancan desde cero y no pausan', () => {
    for (const m of ['NORMAL', 'LAUNCH', 'EVENT', 'TAKEOVER'] as const) {
      const a = brandMomentAction(m);
      expect(a.seekToMs, m).toBeNull();
      expect(a.pauseAfterSeek, m).toBe(false);
    }
  });

  it('CRITERIO: a los 12 s el estado NO es el de Normal', () => {
    const normal = at(1000);
    const signature = at(12_000);
    expect(signature.lightingSceneId).not.toBe(normal.lightingSceneId);
  });

  it('cada brand moment apunta a un preset que existe', () => {
    for (const spec of Object.values(BRAND_MOMENTS)) {
      expect(presetById(spec.presetId), spec.id).toBeDefined();
    }
  });

  it('el seek cae dentro de la duración del show', () => {
    for (const spec of Object.values(BRAND_MOMENTS)) {
      if (spec.seekToMs === null) continue;
      const pkg = parseShowPackage(compileTakeoverDraft(presetById(spec.presetId)!.build(), ctx).showPackage);
      expect(spec.seekToMs).toBeLessThan(pkg.durationMs);
    }
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2C.2.1 / 11 y 12 — demo check y respaldo
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1 puntos 11 y 12: warm-up y respaldo', () => {
  const todoOk = (): DemoCheckResult[] => DEMO_CHECKS.map((c) => ({ id: c.id, ok: true, detail: 'ok' }));

  it('CRITERIO: con todo en orden queda PRESENTATION READY', () => {
    const r = demoCheckReport(todoOk());
    expect(r.status).toBe('PRESENTATION READY');
    expect(r.failures).toEqual([]);
  });

  it('CRITERIO: una falla requerida lo impide y la nombra', () => {
    const r = demoCheckReport(
      todoOk().map((x) => (x.id === 'hero_master' ? { ...x, ok: false, detail: '404' } : x)),
    );
    expect(r.status).toBe('NOT READY');
    expect(r.failures.map((f) => f.id)).toEqual(['hero_master']);
  });

  it('una falla NO requerida no bloquea, pero se avisa', () => {
    const r = demoCheckReport(
      todoOk().map((x) => (x.id === 'fonts' ? { ...x, ok: false, detail: 'sin fuente local' } : x)),
    );
    expect(r.status).toBe('PRESENTATION READY');
    expect(r.warnings.map((w) => w.id)).toEqual(['fonts']);
  });

  it('un check que no se ejecutó cuenta como no pasado', () => {
    const r = demoCheckReport([]);
    expect(r.status).toBe('NOT READY');
    expect(r.results).toHaveLength(DEMO_CHECKS.length);
    expect(r.results.every((x) => !x.ok)).toBe(true);
  });

  it('CRITERIO: el video de respaldo es local', () => {
    expect(BACKUP_VIDEO.startsWith('/')).toBe(true);
    expect(/^https?:/i.test(BACKUP_VIDEO)).toBe(false);
  });
});
