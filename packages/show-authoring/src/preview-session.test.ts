import { describe, it, expect } from 'vitest';
import { DEMO_SCENES, EL_TRUST, ShowEngine } from '@trust/show-engine';
import type { ShowPackage } from '@trust/shared-types';
import {
  DRAFT_STORAGE_KEY,
  MemoryDraftStorage,
  PRESET_MCDONALDS_15S,
  PreviewSession,
  adoptDraft,
  canPreview,
  createRepoRegistry,
  loadDraft,
  previewRefusal,
  requiresDiscardConfirmation,
  saveDraft,
  showPackageRevision,
  updateMoment,
  validateDraft,
  type TakeoverDraft,
} from './index';

/**
 * Estos tests corren el MISMO código que el store: `PreviewSession`,
 * `canPreview`, `adoptDraft` y las funciones de storage se importan, no se
 * reimplementan. Es la lección de M2A.3: si producción y test construyen el
 * comportamiento por caminos distintos, el test no prueba producción.
 */

const preflightCtx = { building: EL_TRUST, scenes: DEMO_SCENES };
const compileCtx = {
  building: EL_TRUST,
  assets: createRepoRegistry(),
  sceneIds: new Set(DEMO_SCENES.keys()),
};
const validate = (draft: TakeoverDraft) =>
  validateDraft(draft, { ...compileCtx, preflight: preflightCtx });

/** Sesión con el motor real, igual que en el navegador. */
const nuevaSesion = () =>
  new PreviewSession({
    createEngine: (show: ShowPackage) => new ShowEngine({ show, context: preflightCtx }),
  });

/* ════════════════════════════════════════════════════════════════
 * M2C.1.1 / 1 — el motor nunca queda viejo
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.1.1 punto 1: revisión del paquete compilado', () => {
  it('la revisión sale del contenido: mismo paquete, misma revisión', () => {
    const v = validate(PRESET_MCDONALDS_15S());
    const pkg = v.compile.showPackage!;
    expect(showPackageRevision(pkg)).toBe(showPackageRevision(pkg));
    expect(showPackageRevision(JSON.parse(JSON.stringify(pkg)))).toBe(showPackageRevision(pkg));
  });

  it('cambiar una duración cambia la revisión', () => {
    const draft = PRESET_MCDONALDS_15S();
    const a = validate(draft).compile.showPackage;
    const b = validate(
      updateMoment(draft, draft.moments[1]!.id, { durationMs: 5000 }),
    ).compile.showPackage;
    expect(showPackageRevision(a)).not.toBe(showPackageRevision(b));
  });

  it('cambiar una escena cambia la revisión', () => {
    const draft = PRESET_MCDONALDS_15S();
    const a = validate(draft).compile.showPackage;
    const b = validate(
      updateMoment(draft, draft.moments[1]!.id, {
        lighting: { mode: 'scene', sceneId: 'iconic_signature' },
      } as never),
    ).compile.showPackage;
    expect(showPackageRevision(a)).not.toBe(showPackageRevision(b));
  });

  it('un cambio que NO afecta al paquete deja la revisión igual', () => {
    // Renombrar un moment es cosa del editor: no debe cortar la reproducción.
    const draft = PRESET_MCDONALDS_15S();
    const a = validate(draft).compile.showPackage;
    const b = validate(
      updateMoment(draft, draft.moments[0]!.id, { name: 'Otro nombre' }),
    ).compile.showPackage;
    expect(showPackageRevision(a)).toBe(showPackageRevision(b));
  });

  it('sin paquete la revisión es "none"', () => {
    expect(showPackageRevision(null)).toBe('none');
  });
});

describe('M2C.1.1 punto 1: RESTART y SCRUB usan el show ACTUAL', () => {
  it('CRITERIO: PLAY → editar duración → RESTART ejecuta la nueva duración', () => {
    const session = nuevaSesion();
    const draft = PRESET_MCDONALDS_15S();

    const v1 = validate(draft);
    session.play(v1);
    expect(session.snapshot(v1).durationMs).toBe(15000);

    // El operador alarga el takeover: 15 s → 21 s.
    const editado = updateMoment(draft, draft.moments[2]!.id, { durationMs: 12000 });
    const v2 = validate(editado);
    expect(v2.compile.showPackage!.durationMs).toBe(21000);

    // Antes del arreglo, RESTART reiniciaba el show viejo de 15 s.
    const snap = session.restart(v2);
    expect(snap.durationMs).toBe(21000);
    expect(snap.current).toBe(true);
    expect(snap.engineRevision).toBe(showPackageRevision(v2.compile.showPackage));
  });

  it('CRITERIO: PLAY → editar → SCRUB da el estado del NUEVO compilado', () => {
    const session = nuevaSesion();
    const draft = PRESET_MCDONALDS_15S();
    session.play(validate(draft));

    // Se cambia la escena del segundo moment a iconic_signature.
    const editado = updateMoment(draft, draft.moments[1]!.id, {
      lighting: { mode: 'scene', sceneId: 'iconic_signature', fadeMs: 0 },
    });
    const v2 = validate(editado);

    // Instante dentro del segundo moment.
    const snap = session.scrub(v2, 4000);
    expect(snap.state!.lightingSceneId).toBe('iconic_signature');
    expect(snap.current).toBe(true);
    expect(snap.transport).toBe('paused');
  });

  it('CRITERIO: scrubear muestra el frame, no negro', () => {
    // Un motor recien cargado esta `stopped`, y STOP es BLACK. Si el scrub no
    // dejara el motor en PAUSA, el editor mostraria las tres pantallas en
    // negro en cada busqueda.
    const session = nuevaSesion();
    const v = validate(PRESET_MCDONALDS_15S());
    const snap = session.scrub(v, 8000);
    expect(snap.transport).toBe('paused');
    const salidas = Object.values(snap.state!.screens).map((s) => s.output);
    expect(salidas).not.toEqual(['black', 'black', 'black']);
  });

  it('RESTART sin haber tocado nada sigue reiniciando desde cero', () => {
    const session = nuevaSesion();
    const v = validate(PRESET_MCDONALDS_15S());
    session.play(v);
    session.scrub(v, 9000);
    expect(session.snapshot(v).timeMs).toBe(9000);
    expect(session.restart(v).timeMs).toBe(0);
  });

  it('el motor se recarga una sola vez por revisión, no en cada comando', () => {
    let cargas = 0;
    const session = new PreviewSession({
      createEngine: (show) => {
        const e = new ShowEngine({ show, context: preflightCtx });
        const original = e.loadShow.bind(e);
        e.loadShow = (s: ShowPackage) => {
          cargas += 1;
          original(s);
        };
        return e;
      },
    });
    const v = validate(PRESET_MCDONALDS_15S());
    session.play(v);
    session.restart(v);
    session.scrub(v, 2000);
    session.play(v);
    expect(cargas).toBe(0); // construido con el paquete, sin recargas
  });

  it('isCurrent detecta el desfasaje sin necesidad de reproducir', () => {
    const session = nuevaSesion();
    const draft = PRESET_MCDONALDS_15S();
    const v1 = validate(draft);
    session.play(v1);
    expect(session.isCurrent(v1)).toBe(true);

    const v2 = validate(updateMoment(draft, draft.moments[0]!.id, { durationMs: 4000 }));
    expect(session.isCurrent(v2)).toBe(false);
    expect(session.snapshot(v2).current).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2C.1.1 / 2 — BLOCKED es regla del estado, no del botón
 * ════════════════════════════════════════════════════════════════ */

/**
 * Bloqueo con paquete NO nulo: se asigna a la horizontal un asset cuyo aspecto
 * no corresponde a esa superficie. El compilador produce un ShowPackage
 * perfectamente formado; lo que bloquea es la validación de assets.
 *
 * Es el caso importante: si la guarda dependiera de `showPackage === null`,
 * este draft se reproduciría igual.
 */
function draftBloqueadoConPaquete(): TakeoverDraft {
  const draft = PRESET_MCDONALDS_15S();
  return {
    ...draft,
    surfaces: {
      ...draft.surfaces,
      // El master de torres (2592×576, aspecto 4.5) asignado a la horizontal
      // (1920×412, aspecto 4.66): el recorte no corresponde a esa superficie.
      horizontalAssetId: 'test_towers_master',
    },
  };
}

describe('M2C.1.1 punto 2: la guarda vive en el estado', () => {
  it('el caso de prueba está BLOCKED y su paquete NO es null', () => {
    const v = validate(draftBloqueadoConPaquete());
    expect(v.status).toBe('BLOCKED');
    expect(v.exportable).toBe(false);
    expect(v.compile.showPackage).not.toBeNull();
    expect(canPreview(v)).toBe(false);
    expect(previewRefusal(v)).toBe('BLOCKED');
  });

  it('CRITERIO: PLAY no arranca con BLOCKED', () => {
    const session = nuevaSesion();
    const snap = session.play(validate(draftBloqueadoConPaquete()));
    expect(session.getEngine()).toBeNull();
    expect(snap.transport).toBe('stopped');
    expect(snap.state).toBeNull();
  });

  it('CRITERIO: RESTART no arranca con BLOCKED', () => {
    const session = nuevaSesion();
    expect(session.restart(validate(draftBloqueadoConPaquete())).transport).toBe('stopped');
    expect(session.getEngine()).toBeNull();
  });

  it('CRITERIO: SCRUB no crea motor con BLOCKED', () => {
    const session = nuevaSesion();
    const snap = session.scrub(validate(draftBloqueadoConPaquete()), 5000);
    expect(session.getEngine()).toBeNull();
    expect(snap.timeMs).toBe(0);
  });

  it('CRITERIO: pasar a BLOCKED mientras reproduce SUELTA el motor', () => {
    // Si no, un show valido seguiria sonando sobre un draft que ya no lo es.
    const session = nuevaSesion();
    session.play(validate(PRESET_MCDONALDS_15S()));
    expect(session.getEngine()).not.toBeNull();

    session.play(validate(draftBloqueadoConPaquete()));
    expect(session.getEngine()).toBeNull();
  });

  it('CRITERIO: las dos condiciones se chequean por separado', () => {
    /*
     * `status` y `exportable` son campos distintos del tipo. Hoy se mueven
     * juntos, pero el pedido dice "BLOCKED O exportable false": la guarda no
     * puede depender de que sigan sincronizados. Lo encontro el mutation
     * check — sin este caso, borrar el chequeo de `status` no rompia nada.
     */
    const base = validate(PRESET_MCDONALDS_15S());
    expect(canPreview({ ...base, status: 'BLOCKED', exportable: true })).toBe(false);
    expect(canPreview({ ...base, status: 'READY', exportable: false })).toBe(false);
    expect(canPreview({ ...base, status: 'WARNING', exportable: true })).toBe(true);
  });

  it('canPreview también rechaza validación ausente o paquete nulo', () => {
    expect(canPreview(null)).toBe(false);
    expect(previewRefusal(null)).toBe('NO_VALIDATION');
    const v = validate(PRESET_MCDONALDS_15S());
    const sinPaquete = { ...v, compile: { ...v.compile, showPackage: null } };
    expect(canPreview(sinPaquete)).toBe(false);
    expect(previewRefusal(sinPaquete)).toBe('NO_PACKAGE');
  });

  it('un draft válido sí puede previsualizarse', () => {
    const v = validate(PRESET_MCDONALDS_15S());
    expect(canPreview(v)).toBe(true);
    expect(previewRefusal(v)).toBeNull();
    expect(nuevaSesion().play(v).transport).toBe('playing');
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2C.1.1 / 3 — persistencia honesta
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.1.1 punto 3: preset e import no parecen guardados', () => {
  it('CRITERIO: adoptar un preset deja sucio y pide autosave', () => {
    const r = adoptDraft(PRESET_MCDONALDS_15S(), 'preset');
    expect(r.dirty).toBe(true);
    expect(r.autosave).toBe(true);
  });

  it('CRITERIO: importar deja sucio y pide autosave', () => {
    const r = adoptDraft(PRESET_MCDONALDS_15S(), 'import');
    expect(r.dirty).toBe(true);
    expect(r.autosave).toBe(true);
  });

  it('lo que viene del disco sí está limpio: es exactamente lo guardado', () => {
    const r = adoptDraft(PRESET_MCDONALDS_15S(), 'storage');
    expect(r.dirty).toBe(false);
    expect(r.autosave).toBe(false);
  });

  it('CRITERIO: la recarga devuelve el último draft realmente adoptado', () => {
    const storage = new MemoryDraftStorage();
    const viejo = PRESET_MCDONALDS_15S();
    saveDraft(storage, viejo);

    // El operador elige otro preset: se adopta sucio y el autosave escribe.
    const nuevo = { ...PRESET_MCDONALDS_15S(), id: 'otra_campania', name: 'Otra campaña' };
    const adopted = adoptDraft(nuevo, 'preset');
    if (adopted.autosave) saveDraft(storage, adopted.draft);

    const recuperado = loadDraft(storage);
    expect(recuperado!.id).toBe('otra_campania');
    expect(recuperado!.name).toBe('Otra campaña');
  });

  it('cambiar de draft con trabajo sin guardar pide confirmación', () => {
    expect(requiresDiscardConfirmation({ dirty: true })).toBe(true);
    expect(requiresDiscardConfirmation({ dirty: false })).toBe(false);
  });

  it('el storage valida con Zod lo que lee: basura no se carga', () => {
    const storage = new MemoryDraftStorage();
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ takeoverDraftVersion: 99, moments: [] }));
    expect(loadDraft(storage)).toBeNull();
    storage.setItem(DRAFT_STORAGE_KEY, 'no es json');
    expect(loadDraft(storage)).toBeNull();
  });

  it('sin nada guardado devuelve null, no un draft vacío', () => {
    expect(loadDraft(new MemoryDraftStorage())).toBeNull();
  });

  it('un storage que falla no rompe el editor', () => {
    const roto = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
      removeItem: () => undefined,
    };
    expect(saveDraft(roto, PRESET_MCDONALDS_15S())).toBe(false);
    expect(loadDraft(roto)).toBeNull();
  });

  it('el ciclo completo conserva el draft intacto', () => {
    const storage = new MemoryDraftStorage();
    const draft = PRESET_MCDONALDS_15S();
    saveDraft(storage, draft);
    expect(loadDraft(storage)).toEqual(draft);
  });
});
