import { describe, it, expect } from 'vitest';
import { ShowPackageSchema } from '@trust/shared-types';
import { DEMO_SCENES, EL_TRUST, ShowEngine, preflightShow } from '@trust/show-engine';
import { ManualClock } from '@trust/timeline';
import {
  AssetRegistry,
  DRAFT_PRESETS,
  MIN_MOMENT_MS,
  PRESET_MCDONALDS_15S,
  PRESET_TAKEOVER_15S,
  REPO_ASSETS,
  TOWERS_GROUP,
  addMoment,
  compileTakeoverDraft,
  createRepoRegistry,
  duplicateMoment,
  momentSpans,
  parseTakeoverDraft,
  presetById,
  reorderMoments,
  safeParseTakeoverDraft,
  totalDurationMs,
  updateMoment,
  validateAsset,
  validateDraft,
  type TakeoverDraft,
} from './index';

const sceneIds = new Set(DEMO_SCENES.keys());
const ctx = () => ({ building: EL_TRUST, assets: createRepoRegistry(), sceneIds });
const preflightCtx = { building: EL_TRUST, scenes: DEMO_SCENES };
const full = () => ({ ...ctx(), preflight: preflightCtx });

/* ════════════════════════════════════════════════════════════════
 * Schema
 * ════════════════════════════════════════════════════════════════ */

describe('draft schema', () => {
  it('un preset valido parsea', () => {
    expect(() => parseTakeoverDraft(PRESET_TAKEOVER_15S())).not.toThrow();
  });

  it('CRITERIO: rechaza duracion 0 o negativa', () => {
    const d = PRESET_TAKEOVER_15S();
    for (const bad of [0, -1, MIN_MOMENT_MS - 1]) {
      const roto = { ...d, moments: [{ ...d.moments[0]!, durationMs: bad }] };
      expect(safeParseTakeoverDraft(roto).success, String(bad)).toBe(false);
    }
  });

  it('CRITERIO: rechaza un draft importado malicioso', () => {
    const d = PRESET_TAKEOVER_15S();
    const ataques: unknown[] = [
      { ...d, takeoverDraftVersion: 99 },
      { ...d, moments: 'no soy un array' },
      { ...d, moments: [{ ...d.moments[0]!, clock: { mode: 'state', value: 'discoteca' } }] },
      { ...d, moments: [{ ...d.moments[0]!, screens: { upper: { mode: 'ejecutar' } } }] },
      { ...d, surfaces: { ...d.surfaces, upperMode: 'holograma' } },
      { ...d, id: '' },
      null,
      'string suelto',
      42,
    ];
    for (const a of ataques) expect(safeParseTakeoverDraft(a).success).toBe(false);
  });

  it('el reloj solo admite estados que el contrato resuelve', () => {
    const d = PRESET_TAKEOVER_15S();
    for (const v of ['normal', 'off', 'accent', 'countdown']) {
      const ok = { ...d, moments: [{ ...d.moments[0]!, clock: { mode: 'state', value: v } }] };
      expect(safeParseTakeoverDraft(ok).success, v).toBe(true);
    }
    // BRAND y EVENT son capacidades futuras, no estados actuales.
    for (const v of ['brand', 'event']) {
      const no = { ...d, moments: [{ ...d.moments[0]!, clock: { mode: 'state', value: v } }] };
      expect(safeParseTakeoverDraft(no).success, v).toBe(false);
    }
  });

  it('la duracion total es la suma de los moments', () => {
    const d = PRESET_TAKEOVER_15S();
    expect(totalDurationMs(d)).toBe(d.moments.reduce((a, m) => a + m.durationMs, 0));
    expect(totalDurationMs(d)).toBe(15000);
  });

  it('CRITERIO: los atMs acumulados son consecutivos y sin huecos', () => {
    const spans = momentSpans(PRESET_TAKEOVER_15S());
    expect(spans[0]!.startMs).toBe(0);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.startMs).toBe(spans[i - 1]!.endMs);
    }
    expect(spans[spans.length - 1]!.endMs).toBe(15000);
  });
});

/* ════════════════════════════════════════════════════════════════
 * Edicion
 * ════════════════════════════════════════════════════════════════ */

describe('edicion de moments', () => {
  it('CRITERIO: duplicar genera un id nuevo y conserva el contenido', () => {
    const d = PRESET_TAKEOVER_15S();
    const original = d.moments[2]!;
    const dup = duplicateMoment(d, original.id);

    expect(dup.moments).toHaveLength(d.moments.length + 1);
    const copia = dup.moments[3]!;
    expect(copia.id).not.toBe(original.id);
    expect(new Set(dup.moments.map((m) => m.id)).size).toBe(dup.moments.length);
    expect(copia.screens).toEqual(original.screens);
    expect(copia.lighting).toEqual(original.lighting);
    expect(copia.durationMs).toBe(original.durationMs);
  });

  it('la copia es independiente del original', () => {
    const d = duplicateMoment(PRESET_TAKEOVER_15S(), 'takeover');
    const copiaId = d.moments[3]!.id;
    const editado = updateMoment(d, copiaId, { durationMs: 9999 });
    expect(editado.moments.find((m) => m.id === 'takeover')!.durationMs).toBe(6000);
  });

  it('agregar no pisa ids existentes', () => {
    let d = PRESET_TAKEOVER_15S();
    for (let i = 0; i < 5; i++) d = addMoment(d, 'Normal');
    expect(new Set(d.moments.map((m) => m.id)).size).toBe(d.moments.length);
  });

  it('CRITERIO: reordenar conserva el determinismo del compilado', () => {
    const d = PRESET_TAKEOVER_15S();
    const movido = reorderMoments(d, 1, 3);

    // El contenido es el mismo conjunto, en otro orden.
    expect(new Set(movido.moments.map((m) => m.id))).toEqual(new Set(d.moments.map((m) => m.id)));
    expect(totalDurationMs(movido)).toBe(totalDurationMs(d));

    // Y compilar el resultado sigue siendo determinista.
    const a = compileTakeoverDraft(movido, ctx());
    const b = compileTakeoverDraft(movido, ctx());
    expect(a.showPackage).toEqual(b.showPackage);

    // Reordenar de vuelta devuelve exactamente el original.
    expect(reorderMoments(movido, 3, 1)).toEqual(d);
  });

  it('reordenar fuera de rango no rompe nada', () => {
    const d = PRESET_TAKEOVER_15S();
    expect(reorderMoments(d, 0, 99)).toEqual(d);
    expect(reorderMoments(d, -1, 0)).toEqual(d);
    expect(reorderMoments(d, 2, 2)).toEqual(d);
  });
});

/* ════════════════════════════════════════════════════════════════
 * Compilador
 * ════════════════════════════════════════════════════════════════ */

describe('compilador', () => {
  it('CRITERIO: el mismo draft produce el mismo ShowPackage', () => {
    const d = PRESET_TAKEOVER_15S();
    const a = compileTakeoverDraft(d, ctx());
    const b = compileTakeoverDraft(d, ctx());
    expect(a.showPackage).toEqual(b.showPackage);
    expect(JSON.stringify(a.showPackage)).toBe(JSON.stringify(b.showPackage));
  });

  it('CRITERIO: la duracion del paquete es la suma de los moments', () => {
    const d = PRESET_TAKEOVER_15S();
    const r = compileTakeoverDraft(d, ctx());
    expect(r.showPackage!.durationMs).toBe(totalDurationMs(d));
  });

  it('CRITERIO: los atMs de los eventos caen en el moment correcto', () => {
    const d = PRESET_TAKEOVER_15S();
    const r = compileTakeoverDraft(d, ctx());
    const spans = momentSpans(d);

    const escenas = r.showPackage!.timeline.filter((e) => e.type === 'lighting.scene');
    for (const e of escenas) {
      if (e.atMs === r.showPackage!.durationMs) continue; // cierre
      const span = spans.find((s) => s.startMs === e.atMs);
      expect(span, `evento en ${e.atMs}`).toBeDefined();
      expect(span!.moment.lighting.mode).toBe('scene');
    }
  });

  it('CRITERIO: el compilado pasa el schema de ShowPackage', () => {
    for (const preset of DRAFT_PRESETS) {
      const r = compileTakeoverDraft(preset.build(), ctx());
      expect(r.ok, preset.id).toBe(true);
      expect(ShowPackageSchema.safeParse(r.showPackage).success, preset.id).toBe(true);
    }
  });

  it('CRITERIO: el compilado pasa preflight sin errores', () => {
    for (const preset of DRAFT_PRESETS) {
      const r = compileTakeoverDraft(preset.build(), ctx());
      const pre = preflightShow(r.showPackage!, preflightCtx);
      expect(pre.errors.map((e) => e.code), preset.id).toEqual([]);
    }
  });

  it('CRITERIO: modo A+B master genera un mediaGroup valido', () => {
    const r = compileTakeoverDraft(PRESET_TAKEOVER_15S(), ctx());
    const g = r.showPackage!.mediaGroups[TOWERS_GROUP]!;

    expect(g.source).toBe('/demo/test_towers_master.mp4');
    expect(g.canvas).toEqual({ width: 2592, height: 576 });
    // El reparto sale de los pixeles reales: 1152 y 1440 sobre 2592.
    expect(g.layout.screen_a!.w).toBeCloseTo(1152 / 2592, 9);
    expect(g.layout.screen_b!.x).toBeCloseTo(1152 / 2592, 9);
    expect(g.layout.screen_b!.w).toBeCloseTo(1440 / 2592, 9);
    // Y no quedan fuentes sueltas para las torres.
    expect(r.showPackage!.media.screen_a).toBeUndefined();
  });

  it('CRITERIO: en master, A y B reciben el MISMO cue', () => {
    const r = compileTakeoverDraft(PRESET_TAKEOVER_15S(), ctx());
    const a = r.showPackage!.timeline.filter((e) => 'target' in e && e.target === 'screen_a');
    const b = r.showPackage!.timeline.filter((e) => 'target' in e && e.target === 'screen_b');
    expect(a).toHaveLength(b.length);
    a.forEach((e, i) => {
      expect(e.atMs).toBe(b[i]!.atMs);
      expect(e.type).toBe(b[i]!.type);
    });
  });

  it('CRITERIO: en master, la directiva de `upper` manda sobre las de torre', () => {
    // El mutation check encontro el hueco: en los presets `pellegrini` copia a
    // `upper`, asi que sustituir uno por otro no cambiaba nada. Aca difieren a
    // proposito: si el compilador leyera `pellegrini` en modo master, A y B
    // quedarian con cues distintos y se romperia el frame-lock.
    const base = PRESET_TAKEOVER_15S();
    const d = updateMoment(base, 'reveal', {
      screens: {
        upper: { mode: 'play', fromMs: 0 },
        corrientes: { mode: 'black' },
        pellegrini: { mode: 'black' },
        horizontal: { mode: 'play', fromMs: 0 },
      },
    });
    const r = compileTakeoverDraft(d, ctx());
    const en3000 = r.showPackage!.timeline.filter((e) => e.atMs === 3000 && 'target' in e);
    const a = en3000.find((e) => 'target' in e && e.target === 'screen_a')!;
    const b = en3000.find((e) => 'target' in e && e.target === 'screen_b')!;
    expect(a.type).toBe('media.play');
    expect(b.type).toBe('media.play');
    expect(a).toEqual({ ...b, target: 'screen_a' });
  });

  it('CRITERIO: si la campania no vuelve sola, el compilador cierra en identidad', () => {
    // Otro hueco del mutation check: los presets ya terminan en trust_normal,
    // asi que el evento de cierre era redundante y quitarlo no rompia nada.
    // Una campania que termina en la escena de marca SI lo necesita: sin eso el
    // edificio queda con la iluminacion del anunciante fuera de pauta.
    const base = PRESET_TAKEOVER_15S();
    const sinRetorno = {
      ...base,
      moments: base.moments.filter((m) => m.id !== 'exit' && m.id !== 'firma'),
    };
    const r = compileTakeoverDraft(sinRetorno, ctx());
    expect(r.ok).toBe(true);

    const fin = totalDurationMs(sinRetorno);
    const cierre = r.showPackage!.timeline.find(
      (e) => e.atMs === fin && e.type === 'lighting.scene',
    );
    expect(cierre, 'falta el evento de cierre').toBeDefined();
    expect(cierre && 'value' in cierre ? cierre.value : null).toBe('trust_normal');

    // Y preflight no marca que quede con la marca puesta.
    const pre = preflightShow(r.showPackage!, preflightCtx);
    expect(pre.warnings.map((w) => w.code)).not.toContain('ENDS_IN_TAKEOVER');
  });

  it('CRITERIO: modo independiente asigna una fuente por torre, sin grupo', () => {
    const base = PRESET_TAKEOVER_15S();
    const d: TakeoverDraft = {
      ...base,
      surfaces: {
        ...base.surfaces,
        upperMode: 'independent',
        masterAssetId: null,
        corrientesAssetId: 'corrientes_clip',
        pellegriniAssetId: 'pellegrini_clip',
      },
    };
    const registry = new AssetRegistry([
      ...REPO_ASSETS,
      { id: 'corrientes_clip', name: 'Corrientes', type: 'video', source: '/demo/c.mp4', width: 1152, height: 576, tags: [], unmanaged: false },
      { id: 'pellegrini_clip', name: 'Pellegrini', type: 'video', source: '/demo/p.mp4', width: 1440, height: 576, tags: [], unmanaged: false },
    ]);

    const r = compileTakeoverDraft(d, { ...ctx(), assets: registry });
    expect(r.ok).toBe(true);
    expect(r.showPackage!.mediaGroups).toEqual({});
    expect(r.showPackage!.media.screen_a).toBe('/demo/c.mp4');
    expect(r.showPackage!.media.screen_b).toBe('/demo/p.mp4');
  });

  it('`hold` no emite eventos: la continuidad es ausencia de evento', () => {
    const d = PRESET_TAKEOVER_15S();
    const r = compileTakeoverDraft(d, ctx());
    // El moment "takeover" deja las pantallas en hold: no debe haber media.* en 6000.
    const enTakeover = r.showPackage!.timeline.filter(
      (e) => e.atMs === 6000 && e.type.startsWith('media.'),
    );
    expect(enTakeover).toEqual([]);
  });

  it('la campania vuelve a identidad y a negro al cerrar', () => {
    const d = PRESET_TAKEOVER_15S();
    const r = compileTakeoverDraft(d, ctx());
    const pre = preflightShow(r.showPackage!, preflightCtx);
    expect(pre.warnings.map((w) => w.code)).not.toContain('ENDS_IN_TAKEOVER');
    expect(pre.warnings.map((w) => w.code)).not.toContain('ENDS_ON_FROZEN_FRAME');
  });

  it('rechaza una escena inexistente', () => {
    const d = PRESET_TAKEOVER_15S();
    const roto = updateMoment(d, 'takeover', { lighting: { mode: 'scene', sceneId: 'no_existe' } });
    const r = compileTakeoverDraft(roto, ctx());
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain('SCENE_NOT_FOUND');
    expect(r.errors[0]!.momentId).toBe('takeover');
  });

  it('un draft sin moments no compila', () => {
    const r = compileTakeoverDraft({ ...PRESET_TAKEOVER_15S(), moments: [] }, ctx());
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain('NO_MOMENTS');
  });
});

/* ════════════════════════════════════════════════════════════════
 * Assets
 * ════════════════════════════════════════════════════════════════ */

describe('asset registry', () => {
  it('CRITERIO: un asset fuera de los namespaces controlados se bloquea', () => {
    for (const source of [
      'https://cdn.agencia.com/clip.mp4',
      '//host/clip.mp4',
      '/etc/passwd',
      '/uploads/clip.mp4',
      'demo/clip.mp4',
      '/demo/../secreto.mp4',
    ]) {
      const v = validateAsset(
        { id: 'x', name: 'X', type: 'video', source, width: 2592, height: 576, tags: [], unmanaged: false },
        null,
      );
      expect(v.status, source).toBe('BLOCKED');
    }
  });

  it('el registro rechaza registrar un asset con ruta invalida', () => {
    const r = new AssetRegistry();
    expect(() =>
      r.register({ id: 'malo', name: 'Malo', type: 'video', source: 'https://x/y.mp4', width: 10, height: 10, tags: [], unmanaged: false }),
    ).toThrow();
  });

  it('CRITERIO: un archivo local sin registrar bloquea la exportacion', () => {
    const registry = createRepoRegistry();
    registry.registerLocalPreview({
      id: 'arrastrado',
      name: 'video-del-cliente.mp4',
      type: 'video',
      source: 'blob:local',
      width: 2592,
      height: 576,
      tags: [],
    });
    expect(registry.unmanagedIds()).toEqual(['arrastrado']);

    const base = PRESET_TAKEOVER_15S();
    const d = { ...base, surfaces: { ...base.surfaces, masterAssetId: 'arrastrado' } };
    const v = validateDraft(d, { ...full(), assets: registry });
    expect(v.status).toBe('BLOCKED');
    expect(v.exportable).toBe(false);
    expect(v.errors.map((e) => e.code)).toContain('ASSET_UNMANAGED');
  });

  it('CRITERIO: validateAsset bloquea un archivo sin registrar por si mismo', () => {
    // El compilador tambien lo bloquea, pero eso es defensa en profundidad: la
    // regla tiene que valer en el validador, porque es el que le habla al panel
    // de assets antes de compilar nada.
    const v = validateAsset(
      { id: 'x', name: 'X', type: 'video', source: '/demo/ok.mp4', width: 2592, height: 576, tags: [], unmanaged: true },
      null,
    );
    expect(v.status).toBe('BLOCKED');
    expect(v.issues.map((i) => i.code)).toContain('ASSET_UNMANAGED');
  });

  it('un asset inexistente bloquea', () => {
    const base = PRESET_TAKEOVER_15S();
    const d = { ...base, surfaces: { ...base.surfaces, masterAssetId: 'fantasma' } };
    const v = validateDraft(d, full());
    expect(v.status).toBe('BLOCKED');
    expect(v.errors.map((e) => e.code)).toContain('ASSET_MISSING');
  });

  it('un aspecto incompatible bloquea', () => {
    const registry = new AssetRegistry([
      ...REPO_ASSETS,
      { id: 'cuadrado', name: 'Cuadrado', type: 'video', source: '/demo/c.mp4', width: 1000, height: 1000, tags: [], unmanaged: false },
    ]);
    const base = PRESET_TAKEOVER_15S();
    const d = { ...base, surfaces: { ...base.surfaces, masterAssetId: 'cuadrado' } };
    const v = validateDraft(d, { ...full(), assets: registry });
    expect(v.errors.map((e) => e.code)).toContain('ASPECT_MISMATCH');
  });

  it('resolucion por debajo de la pantalla es warning, no bloqueo', () => {
    const registry = new AssetRegistry([
      { id: 'chico', name: 'Chico', type: 'video', source: '/demo/ch.mp4', width: 1296, height: 288, tags: [], unmanaged: false },
    ]);
    const v = validateAsset(registry.get('chico'), { widthPx: 2592, heightPx: 576, physicalRatio: 4.5 });
    expect(v.status).toBe('WARNING');
    expect(v.issues[0]!.code).toBe('RESOLUTION_LOW');
  });

  it('un clip mas corto que su uso avisa', () => {
    const registry = new AssetRegistry([
      { id: 'corto', name: 'Corto', type: 'video', source: '/demo/co.mp4', width: 2592, height: 576, durationMs: 2000, tags: [], unmanaged: false },
    ]);
    const v = validateAsset(registry.get('corto'), null, { minDurationMs: 12000 });
    expect(v.issues.map((i) => i.code)).toContain('DURATION_SHORT');
  });
});

/* ════════════════════════════════════════════════════════════════
 * Validacion / export
 * ════════════════════════════════════════════════════════════════ */

describe('panel de preflight', () => {
  it('un preset limpio queda READY o WARNING, nunca BLOCKED', () => {
    for (const p of DRAFT_PRESETS) {
      const v = validateDraft(p.build(), full());
      expect(v.status, p.id).not.toBe('BLOCKED');
      expect(v.exportable, p.id).toBe(true);
    }
  });

  it('CRITERIO: con BLOCKED no se exporta', () => {
    const base = PRESET_TAKEOVER_15S();
    const roto = { ...base, surfaces: { ...base.surfaces, masterAssetId: 'no_existe' } };
    const v = validateDraft(roto, full());
    expect(v.status).toBe('BLOCKED');
    expect(v.exportable).toBe(false);
    expect(v.compile.showPackage).toBeNull();
  });

  it('CRITERIO: incluir la horizontal en el grupo avisa que el sync no esta verificado', () => {
    const base = PRESET_TAKEOVER_15S();
    const d = { ...base, surfaces: { ...base.surfaces, includeHorizontalInMaster: true } };
    const v = validateDraft(d, full());
    expect(v.warnings.map((w) => w.code)).toContain('SYNC_HARDWARE_NOT_VERIFIED');
    const aviso = v.warnings.find((w) => w.code === 'SYNC_HARDWARE_NOT_VERIFIED')!;
    expect(aviso.message).toContain('SYNC HARDWARE NOT VERIFIED');
  });

  it('el grupo con horizontal exige modo master', () => {
    const base = PRESET_TAKEOVER_15S();
    const d = {
      ...base,
      surfaces: { ...base.surfaces, upperMode: 'independent' as const, includeHorizontalInMaster: true },
    };
    const v = validateDraft(d, full());
    expect(v.errors.map((e) => e.code)).toContain('HORIZONTAL_GROUP_REQUIRES_MASTER');
  });

  it('los issues de preflight se ubican en su moment', () => {
    const base = PRESET_TAKEOVER_15S();
    // Fade mas largo que el moment: el compilador lo ubica.
    const d = updateMoment(base, 'firma', {
      lighting: { mode: 'scene', sceneId: 'iconic_signature', fadeMs: 9000 },
    });
    const v = validateDraft(d, full());
    const w = v.warnings.find((x) => x.code === 'FADE_LONGER_THAN_MOMENT');
    expect(w).toBeDefined();
    expect(w!.momentId).toBe('firma');
  });
});

/* ════════════════════════════════════════════════════════════════
 * Runtime: el preview usa el ShowEngine real
 * ════════════════════════════════════════════════════════════════ */

describe('el preview corre sobre el ShowEngine existente', () => {
  const engineDe = (d: TakeoverDraft) => {
    const r = compileTakeoverDraft(d, ctx());
    expect(r.ok).toBe(true);
    const clock = new ManualClock(0);
    const engine = new ShowEngine({ show: r.showPackage!, context: preflightCtx, now: clock.now });
    return { engine, clock, pkg: r.showPackage! };
  };

  it('CRITERIO: el paquete compilado se carga y reproduce', () => {
    const { engine, clock } = engineDe(PRESET_TAKEOVER_15S());
    engine.play();
    clock.advance(7000);
    expect(engine.getTimeMs()).toBe(7000);
    // En el full takeover la torre esta en rojo de marca.
    expect(engine.getState().lightingSceneId).toBe('mcd_red_gold');
  });

  it('CRITERIO: STOP sigue siendo BLACK', () => {
    const { engine, clock } = engineDe(PRESET_TAKEOVER_15S());
    engine.play();
    clock.advance(7000);
    engine.stop();
    for (const s of Object.values(engine.getState().screens)) expect(s.output).toBe('black');
  });

  it('CRITERIO: PAUSE sigue siendo HOLD', () => {
    const { engine, clock } = engineDe(PRESET_TAKEOVER_15S());
    engine.play();
    clock.advance(7000);
    engine.pause();
    expect(engine.getState().screens.screen_a.output).toBe('hold');
  });

  it('CRITERIO: SAFE MODE sigue ganando sobre lo que arme el builder', () => {
    const { engine, clock } = engineDe(PRESET_TAKEOVER_15S());
    engine.play();
    clock.advance(7000);
    engine.enterSafeMode();
    const s = engine.getState();
    expect(s.lightingSceneId).toBe('safe_mode');
    for (const x of Object.values(s.screens)) expect(x.output).toBe('black');
    engine.play();
    expect(engine.getStatus()).not.toBe('playing');
  });

  it('el estado a lo largo del show es determinista', () => {
    const d = PRESET_TAKEOVER_15S();
    const a = engineDe(d);
    const b = engineDe(d);
    for (let t = 0; t <= 15000; t += 250) {
      a.engine.seek(t);
      b.engine.seek(t);
      expect(a.engine.getState()).toEqual(b.engine.getState());
    }
  });

  it('CRITERIO: el builder no expone ninguna via a hardware', () => {
    // El resultado de compilar es datos: un ShowPackage serializable. No hay
    // funciones, handles ni nada accionable.
    const r = compileTakeoverDraft(PRESET_TAKEOVER_15S(), ctx());
    const plano = JSON.parse(JSON.stringify(r.showPackage));
    expect(plano).toEqual(r.showPackage);
    const recorrer = (v: unknown): void => {
      expect(typeof v).not.toBe('function');
      if (v && typeof v === 'object') Object.values(v).forEach(recorrer);
    };
    recorrer(r.showPackage);
  });
});

/* ════════════════════════════════════════════════════════════════
 * Presets
 * ════════════════════════════════════════════════════════════════ */

describe('presets', () => {
  it('todos compilan y son estables entre llamadas', () => {
    for (const p of DRAFT_PRESETS) {
      expect(p.build()).toEqual(p.build());
      expect(compileTakeoverDraft(p.build(), ctx()).ok, p.id).toBe(true);
    }
  });

  it('CRITERIO: el preset McDonald\u0027s compila con los assets que existen', () => {
    const d = PRESET_MCDONALDS_15S();
    expect(totalDurationMs(d)).toBe(15000);
    const spans = momentSpans(d);
    expect(spans.map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 3000],
      [3000, 6000],
      [6000, 12000],
      [12000, 14000],
      [14000, 15000],
    ]);
    const v = validateDraft(d, full());
    expect(v.exportable).toBe(true);
  });

  it('el preset McDonald\u0027s documenta que los assets son placeholders', () => {
    const d = PRESET_MCDONALDS_15S();
    expect(d.notes ?? '').toMatch(/placeholder|prueba/i);
    // Y usa la escena real del catalogo, no una inventada.
    expect(d.moments.some((m) => m.lighting.mode === 'scene' && m.lighting.sceneId === 'mcd_red_gold')).toBe(true);
  });

  it('presetById encuentra los seis', () => {
    for (const id of ['EMPTY', 'BRAND_REVEAL_15S', 'TAKEOVER_15S', 'EVENT_30S', 'ICONIC_15S', 'MCDONALDS_15S']) {
      expect(presetById(id), id).toBeDefined();
    }
    expect(presetById('NO_EXISTE')).toBeUndefined();
  });
});
