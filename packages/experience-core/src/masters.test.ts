import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EL_TRUST, DEMO_SCENES, resolveStateAt } from '@trust/show-engine';
import { parseShowPackage } from '@trust/shared-types';
import { compileTakeoverDraft, createRepoRegistry, presetById } from '@trust/show-authoring';
import {
  EXPERIENCE_MEDIA,
  EXPERIENCE_VIEWS,
  presentationSource,
  BACKUP_VIDEO,
  DEMO_CHECKS,
  END_CARD_ACTIONS,
  END_CARD_BLOCKS,
  INITIAL_EXPERIENCE,
  WHY_BLOCKS,
  canStop,
  enterCinema,
  exitCinema,
  setView,
  PLACEMENT_ASPECT,
  VIEW_GEOMETRY,
  containQuad,
  coverQuad,
  quadBounds,
  requiredAssets,
  surfacePlan,
  type ExperiencePhase,
  type ExperienceView,
  type Quad,
} from './index';

const PUBLIC_DIR = resolve(__dirname, '../../../apps/control/public');
const ctx = { building: EL_TRUST, assets: createRepoRegistry(), sceneIds: new Set(DEMO_SCENES.keys()) };
const SHOW = parseShowPackage(
  compileTakeoverDraft(presetById('MCDONALDS_15S')!.build(), ctx).showPackage,
);
const at = (t: number) =>
  resolveStateAt(SHOW, { building: EL_TRUST, scenes: DEMO_SCENES }, t, { transport: 'playing' });

/**
 * Lee el tamaño de un JPEG sin dependencias: recorre los marcadores hasta el
 * SOF, que es donde están alto y ancho.
 */
function jpegSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1]!;
    // SOF0..SOF15, salteando los que no llevan dimensiones.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error(`no pude leer el tamaño de ${file}`);
}

/* ════════════════════════════════════════════════════════════════
 * Masters: el archivo del disco y la geometría tienen que coincidir
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1 punto 1: masters fotográficos', () => {
  it('CRITERIO: el tamaño declarado coincide con el archivo real', () => {
    /*
     * Es la guarda que más importa al reemplazar las fotos. Los quads están
     * normalizados contra el master, y el encaje `contain` usa su relación de
     * aspecto: si entra una foto con otras proporciones y nadie actualiza
     * `master`, las pantallas se corren sobre el edificio sin que falle nada
     * — se descubre en la reunión.
     */
    for (const view of Object.values(EXPERIENCE_VIEWS)) {
      const file = resolve(PUBLIC_DIR, `.${view.background}`);
      expect(existsSync(file), view.background).toBe(true);
      const real = jpegSize(file);
      const declarado = VIEW_GEOMETRY[view.id].master;
      expect(real, `${view.id} — actualizá VIEW_GEOMETRY.master`).toEqual(declarado);
    }
  });

  it('todos los fondos son assets requeridos, así que bloquean READY si faltan', () => {
    for (const view of Object.values(EXPERIENCE_VIEWS)) {
      expect(requiredAssets()).toContain(view.background);
    }
  });

  it('los masters pesan lo suficiente para no ser un placeholder vacío', () => {
    for (const view of Object.values(EXPERIENCE_VIEWS)) {
      const bytes = readFileSync(resolve(PUBLIC_DIR, `.${view.background}`)).length;
      expect(bytes, view.background).toBeGreaterThan(50_000);
    }
  });
});

/* ════════════════════════════════════════════════════════════════
 * Segmentos: la banda curva queda cubierta entera
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1 punto 3: segmentos de superficie', () => {
  it('CRITERIO: la horizontal sigue la curva de la ochava en muchos tramos', () => {
    // Con dos tramos rectos la banda terminaba en PUNTA en el vértice; la
    // marquesina real dobla en curva. Se exige suficiente resolución para que
    // el quiebre entre tramos no se perciba.
    const valor = VIEW_GEOMETRY.HERO_CORNER.surfaces.horizontal;
    expect(Array.isArray(valor)).toBe(true);
    expect((valor as unknown[]).length).toBeGreaterThanOrEqual(16);
  });

  it('CRITERIO: la curva no tiene punta — el ángulo entre tramos es chico', () => {
    const quads = VIEW_GEOMETRY.HERO_CORNER.surfaces.horizontal as Quad[];
    const M = VIEW_GEOMETRY.HERO_CORNER.master;
    const ang = (q: Quad) => Math.atan2((q.br.y - q.bl.y) * M.height, (q.br.x - q.bl.x) * M.width);
    for (let i = 1; i < quads.length; i++) {
      const d = Math.abs(ang(quads[i]!) - ang(quads[i - 1]!)) * (180 / Math.PI);
      // Con dos tramos el quiebre en el vértice era de ~13°; acá ninguno pasa de 3°.
      expect(d, `quiebre entre tramo ${i - 1} y ${i}`).toBeLessThan(3);
    }
  });

  it('CRITERIO: los tramos se reparten el clip sin huecos ni solapes', () => {
    const tramos = surfacePlan(at(8000), 'HERO_CORNER')
      .filter((p) => p.id === 'horizontal')
      .sort((a, b) => a.uv.x - b.uv.x);
    expect(tramos.length).toBeGreaterThanOrEqual(16);
    expect(tramos[0]!.uv.x).toBeCloseTo(0, 6);
    for (let i = 1; i < tramos.length; i++) {
      // el final de un tramo es el comienzo del siguiente
      expect(tramos[i - 1]!.uv.x + tramos[i - 1]!.uv.w).toBeCloseTo(tramos[i]!.uv.x, 6);
      // misma fuente y mismo instante: es UNA pantalla
      expect(tramos[i]!.source).toBe(tramos[0]!.source);
      expect(tramos[i]!.mediaTimeMs).toBe(tramos[0]!.mediaTimeMs);
    }
    const ult = tramos[tramos.length - 1]!;
    expect(ult.uv.x + ult.uv.w).toBeCloseTo(1, 6);
  });

  it('los tramos son contiguos también en el edificio', () => {
    // Sin esto queda una línea de foto visible entre tramos.
    const quads = VIEW_GEOMETRY.HERO_CORNER.surfaces.horizontal as Quad[];
    for (let i = 1; i < quads.length; i++) {
      expect(quads[i - 1]!.tr).toEqual(quads[i]!.tl);
      expect(quads[i - 1]!.br).toEqual(quads[i]!.bl);
    }
  });

  it('una superficie de un solo quad conserva su recorte entero', () => {
    const a = surfacePlan(at(8000), 'HERO_CORNER').find((p) => p.id === 'screen_a')!;
    expect(a.segment).toBe(0);
    // No es la mitad: A ocupa 1152 de los 2592 px del lienzo y B los 1440
    // restantes, que es exactamente la proporción de las pantallas reales.
    expect(a.uv.w).toBeCloseTo(1152 / 2592, 6);
  });
});

/* ════════════════════════════════════════════════════════════════
 * Encaje contain
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1 punto 3: encaje del master en el escenario', () => {
  const master = { width: 2560, height: 2080 };
  const unidad = { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } };

  it('CRITERIO: con contain la foto entra entera, con barras a los costados', () => {
    // Escenario más apaisado que el master: sobra ancho, no falta alto.
    const q = containQuad(unidad, master, 1600, 900);
    const b = quadBounds(q);
    expect(b.y).toBeCloseTo(0, 6);
    expect(b.h).toBeCloseTo(1, 6);
    expect(b.x).toBeGreaterThan(0);
    expect(b.w).toBeLessThan(1);
  });

  it('con cover, en cambio, se pierde arriba y abajo', () => {
    // Es lo que hacía que el reloj y la horizontal quedaran fuera de cuadro.
    const b = quadBounds(coverQuad(unidad, master, 1600, 900));
    expect(b.h).toBeGreaterThan(1);
  });

  it('un quad del medio del master sigue en el medio del escenario', () => {
    const centro = {
      tl: { x: 0.4, y: 0.4 },
      tr: { x: 0.6, y: 0.4 },
      br: { x: 0.6, y: 0.6 },
      bl: { x: 0.4, y: 0.6 },
    };
    const b = quadBounds(containQuad(centro, master, 1600, 900));
    expect(b.x + b.w / 2).toBeCloseTo(0.5, 6);
    expect(b.y + b.h / 2).toBeCloseTo(0.5, 6);
  });

  it('el encaje no depende del tamaño: dos escenarios proporcionales dan lo mismo', () => {
    const a = quadBounds(containQuad(unidad, master, 1600, 900));
    const b = quadBounds(containQuad(unidad, master, 3200, 1800));
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.w).toBeCloseTo(b.w, 9);
  });
});

/* ════════════════════════════════════════════════════════════════
 * Cambio de vista durante la reproducción
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1 punto 9: cambiar de vista no corta la reproducción', () => {
  it('CRITERIO: la fuente y el instante del clip son los mismos en toda vista', () => {
    const t = 8000;
    const estado = at(t);
    const hero = surfacePlan(estado, 'HERO_CORNER');
    const cor = surfacePlan(estado, 'CORRIENTES');
    const pel = surfacePlan(estado, 'PELLEGRINI');

    const a = (ps: typeof hero, id: string) => ps.find((p) => p.id === id && p.segment === 0)!;

    expect(a(cor, 'screen_a').source).toBe(a(hero, 'screen_a').source);
    expect(a(cor, 'screen_a').mediaTimeMs).toBe(a(hero, 'screen_a').mediaTimeMs);
    expect(a(cor, 'screen_a').uv).toEqual(a(hero, 'screen_a').uv);

    expect(a(pel, 'screen_b').source).toBe(a(hero, 'screen_b').source);
    expect(a(pel, 'screen_b').mediaTimeMs).toBe(a(hero, 'screen_b').mediaTimeMs);
  });

  it('lo único que cambia entre vistas es la geometría', () => {
    const estado = at(9000);
    const hero = surfacePlan(estado, 'HERO_CORNER').find((p) => p.id === 'screen_a')!;
    const cor = surfacePlan(estado, 'CORRIENTES').find((p) => p.id === 'screen_a')!;
    expect(cor.output).toBe(hero.output);
    expect(cor.quad).not.toEqual(hero.quad);
  });

  it('cada vista muestra solo las superficies que se ven desde ahí', () => {
    for (const view of ['HERO_CORNER', 'CORRIENTES', 'PELLEGRINI'] as ExperienceView[]) {
      const ids = new Set(surfacePlan(at(8000), view).map((p) => p.id));
      expect([...ids].sort()).toEqual([...EXPERIENCE_VIEWS[view].surfaces].sort());
    }
  });
});

/* ════════════════════════════════════════════════════════════════
 * Copy ejecutivo
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1 punto 8: copy sin claims que no podamos sostener', () => {
  const todoElCopy = () =>
    [...WHY_BLOCKS, ...END_CARD_BLOCKS]
      .map((b) => `${b.title} ${b.body}`)
      .concat(Object.values(EXPERIENCE_VIEWS).map((v) => `${v.label} ${v.caption}`))
      .join(' ')
      .toLowerCase();

  it('CRITERIO: no se afirma que sea la esquina más vista del país', () => {
    // Un superlativo sin medición detrás, delante de dirección de una marca,
    // cuesta más de lo que suma.
    const copy = todoElCopy();
    expect(copy).not.toContain('más vista');
    expect(copy).not.toContain('la esquina más');
  });

  it('CRITERIO: no hay superlativos ni números sin fuente', () => {
    const copy = todoElCopy();
    for (const palabra of ['más visto', 'la más', 'el más', 'millones', 'récord', 'número 1']) {
      expect(copy, palabra).not.toContain(palabra);
    }
  });

  it('la ubicación se describe sin cuantificar', () => {
    const ubicacion = WHY_BLOCKS.find((b) => b.title === 'LOCATION')!;
    expect(ubicacion.body).toContain('emblemáticas');
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2C.2.1 / 10 — END CARD
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1 punto 10: end card', () => {
  it('CRITERIO: son exactamente los tres mensajes pedidos, en orden', () => {
    expect(END_CARD_BLOCKS.map((b) => b.title)).toEqual([
      'BRAND DOMINANCE',
      'REAL-TIME MOMENTS',
      'MEASUREMENT',
    ]);
  });

  it('CRITERIO: MEASUREMENT marca Audience Analytics como capacidad futura', () => {
    /*
     * Lo único que no existe de los tres bloques es audience analytics. Si se
     * presenta al mismo nivel que proof of play, el cliente compra algo que hoy
     * no se puede entregar — y eso aparece en la primera reunión de resultados.
     */
    const m = END_CARD_BLOCKS.find((b) => b.title === 'MEASUREMENT')!;
    expect(m.planned).toBe(true);
    expect(m.body.toLowerCase()).toContain('audience analytics');
    expect(m.body.toLowerCase()).toContain('future capability');
    // Proof of play sí existe: no lleva la marca.
    expect(m.body.toLowerCase()).toContain('proof of play');
  });

  it('los otros dos bloques NO se marcan como futuros', () => {
    for (const b of END_CARD_BLOCKS.filter((x) => x.title !== 'MEASUREMENT')) {
      expect(b.planned, b.title).toBeFalsy();
    }
  });

  it('CRITERIO: las acciones son VER DE NUEVO y VOLVER', () => {
    expect(END_CARD_ACTIONS.replay).toBe('VER DE NUEVO');
    expect(END_CARD_ACTIONS.back).toBe('VOLVER');
  });

  it('ningún bloque de la end card afirma hardware conectado', () => {
    const copy = END_CARD_BLOCKS.map((b) => `${b.title} ${b.body}`).join(' ').toLowerCase();
    for (const t of ['en vivo', 'conectado', 'tiempo real en el edificio', 'modbus', 'dmx']) {
      expect(copy, t).not.toContain(t);
    }
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2C.2.1 / 9 — CINEMA MODE
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1 punto 9: cinema mode', () => {
  const base = { ...INITIAL_EXPERIENCE, view: 'CORRIENTES' as const, audioEnabled: true };

  it('CRITERIO: entrar en cinema no toca nada del show ni de la vista', () => {
    // Es una decisión de presentación: si además cambiara la vista o el audio,
    // apretar PLAY delante del cliente alteraría lo que se está mostrando.
    const c = enterCinema(base);
    expect(c.cinema).toBe(true);
    expect(c.view).toBe(base.view);
    expect(c.audioEnabled).toBe(base.audioEnabled);
    expect(c.comparison).toBe(base.comparison);
    expect(c.brandMoment).toBe(base.brandMoment);
  });

  it('salir de cinema devuelve exactamente el estado anterior', () => {
    expect(exitCinema(enterCinema(base))).toEqual(base);
  });

  it('CRITERIO: STOP sigue disponible en cualquier estado, sin excepción', () => {
    /*
     * La única salida siempre accesible. El caso que importa es el que el
     * mutation check destapó: durante LOADING, `canPlay` es false y la
     * tentación es deshabilitar todo el transporte. Pero si algo quedó
     * sonando de una corrida anterior, STOP es lo único que lo corta —
     * justo cuando el operador más lo necesita.
     */
    const estados: ExperiencePhase[] = ['LOADING', 'READY', 'PLAYING', 'PAUSED', 'ENDED'];
    for (const phase of estados) {
      expect(canStop({ ...base, phase }), phase).toBe(true);
      expect(canStop(enterCinema({ ...base, phase })), `cinema/${phase}`).toBe(true);
    }
    // Y tampoco depende de la precarga: sin un solo asset cargado, STOP anda.
    expect(canStop({ ...INITIAL_EXPERIENCE, phase: 'LOADING', loaded: [], failed: requiredAssets() })).toBe(true);
  });

  it('cambiar de vista dentro de cinema no saca del modo', () => {
    const c = setView(enterCinema(base), 'PELLEGRINI');
    expect(c.cinema).toBe(true);
    expect(c.view).toBe('PELLEGRINI');
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2C.2.1 / 11 y 12 — el respaldo tiene que existir de verdad
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.1 puntos 11 y 12: respaldo', () => {
  it('CRITERIO: el video de respaldo existe y es local', () => {
    /*
     * El punto del plan B es que esté ahí cuando falla todo lo demás. Un
     * `BACKUP_VIDEO` declarado apuntando a un archivo inexistente es peor que
     * no tener respaldo: se descubre en el momento exacto en que se lo
     * necesita.
     */
    expect(BACKUP_VIDEO.startsWith('/')).toBe(true);
    expect(/^https?:/i.test(BACKUP_VIDEO)).toBe(false);

    const file = resolve(PUBLIC_DIR, `.${BACKUP_VIDEO}`);
    expect(existsSync(file), BACKUP_VIDEO).toBe(true);
    expect(readFileSync(file).length).toBeGreaterThan(200_000);
  });

  it('el check cubre todo lo que la presentación necesita', () => {
    const ids = DEMO_CHECKS.map((c) => c.id);
    for (const id of ['hero_master', 'views', 'media', 'show_package', 'preflight', 'playback', 'renderer', 'backup_video']) {
      expect(ids, id).toContain(id);
    }
  });

  it('CRITERIO: solo las tipografías son opcionales; respaldo y renderer son requeridos', () => {
    // Todo lo demás bloquea: presentar sin master o sin preflight limpio es
    // presentar roto.
    const opcionales = DEMO_CHECKS.filter((c) => !c.required).map((c) => c.id);
    expect(opcionales).toEqual(['fonts']);
  });
});

/* ════════════════════════════════════════════════════════════════
 * M2C.2.2 — las pantallas están donde las fijó el cliente
 * ════════════════════════════════════════════════════════════════ */

describe('M2C.2.2: emplazamiento de las pantallas superiores', () => {
  const aspectoProyectado = (quad: Quad, master: { width: number; height: number }) => {
    const ancho = ((quad.tr.x - quad.tl.x) + (quad.br.x - quad.bl.x)) / 2 * master.width;
    const alto = ((quad.bl.y - quad.tl.y) + (quad.br.y - quad.tr.y)) / 2 * master.height;
    return ancho / alto;
  };
  const real = (id: 'screen_a' | 'screen_b') => {
    const s = EL_TRUST.screens.find((x) => x.id === id)!;
    return s.physicalWidthM / s.physicalHeightM;
  };

  it('CRITERIO: la posición del boceto se mantiene en todas las vistas', () => {
    /*
     * La posición viene del boceto del cliente (`PLACEMENT_ASPECT.source`) y
     * manda sobre la proporción del pliego. Este test fija ESA posición: si
     * alguien las mueve —para "respetar" el 2:1 o para agrandarlas—, falla.
     */
    for (const [view, geo] of Object.entries(VIEW_GEOMETRY)) {
      for (const id of ['screen_a', 'screen_b'] as const) {
        const valor = geo.surfaces[id];
        if (!valor) continue;
        const quad = Array.isArray(valor) ? valor[0]! : valor;
        const proyectado = aspectoProyectado(quad, geo.master);
        expect(Math.abs(proyectado / PLACEMENT_ASPECT[id] - 1), `${view}/${id} desvío`).toBeLessThan(0.04);
      }
    }
  });

  it('la desviación respecto del pliego queda registrada, no escondida', () => {
    // Pliego: A 2:1, B 2,5:1. Emplazamiento del cliente: A ≈2,8 y B ≈2,4.
    // A queda un 40 % más apaisada que el pliego; B prácticamente en medida.
    expect(PLACEMENT_ASPECT.source).toContain('boceto4');
    expect(PLACEMENT_ASPECT.screen_a / real('screen_a')).toBeGreaterThan(1.3);
    expect(Math.abs(PLACEMENT_ASPECT.screen_b / real('screen_b') - 1)).toBeLessThan(0.06);
  });

  it('las dos suben hacia la cúpula: el borde interno queda más alto que el externo', () => {
    // Es la diagonal del boceto. A sube hacia la derecha, B hacia la izquierda.
    const hero = VIEW_GEOMETRY.HERO_CORNER;
    const a = hero.surfaces.screen_a as Quad;
    const b = hero.surfaces.screen_b as Quad;
    expect(a.tr.y).toBeLessThan(a.tl.y);
    expect(b.tl.y).toBeLessThan(b.tr.y);
  });

  it('el borde interno de cada una toca el tambor de la cúpula, no lo invade', () => {
    const hero = VIEW_GEOMETRY.HERO_CORNER;
    const a = hero.surfaces.screen_a as Quad;
    const b = hero.surfaces.screen_b as Quad;
    const DRUM = { left: 0.425, right: 0.555 }; // medido sobre el master
    // A deja un margen chico para no pisar la voluta del arranque de la columna.
    expect(a.tr.x).toBeLessThan(DRUM.left);
    expect(DRUM.left - a.tr.x).toBeLessThan(0.015);
    expect(b.tl.x).toBeCloseTo(DRUM.right, 2);
    expect(a.tr.x).toBeLessThanOrEqual(b.tl.x);
  });
});

/* ════════════════════════════════════════════════════════════════
 * FINAL POLISH — creatividad de campaña en Client Mode
 * ════════════════════════════════════════════════════════════════ */

describe('Client Mode: creatividad de campaña, nunca media de prueba', () => {
  it('CRITERIO: ningún clip de prueba se precarga ni se muestra en Client Mode', () => {
    for (const src of EXPERIENCE_MEDIA) {
      expect(src, src).not.toMatch(/test_|\/demo\//);
      expect(src.startsWith('/experience/campaign/')).toBe(true);
    }
    // y cada fuente del show tiene su reemplazo de campaña
    expect(presentationSource('/demo/test_towers_master.mp4')).toBe('/experience/campaign/mcd_towers_master.mp4');
    expect(presentationSource('/demo/test_horizontal.mp4')).toBe('/experience/campaign/mcd_horizontal.mp4');
    expect(presentationSource(null)).toBeNull();
  });

  it('el ShowPackage NO cambia: sigue referenciando los clips de prueba', () => {
    // La sustitución es de presentación. Builder y tests internos usan los
    // clips de prueba; el show compilado no se toca.
    const s = at(8000);
    expect(s.screens.screen_a.source).toBe('/demo/test_towers_master.mp4');
    expect(s.screens.horizontal.source).toBe('/demo/test_horizontal.mp4');
  });

  it('CRITERIO: los archivos de campaña existen, son locales y tienen el formato del lienzo', () => {
    const dims: Record<string, [number, number]> = {
      '/experience/campaign/mcd_towers_master.mp4': [2592, 576],
      '/experience/campaign/mcd_horizontal.mp4': [1920, 412],
    };
    for (const src of EXPERIENCE_MEDIA) {
      const file = resolve(PUBLIC_DIR, `.${src}`);
      expect(existsSync(file), src).toBe(true);
      const buf = readFileSync(file);
      expect(buf.length, src).toBeGreaterThan(200_000);
      // ancho y alto del track de video, leídos del encabezado 'tkhd' del MP4
      const i = buf.indexOf(Buffer.from('tkhd'));
      const vids: Array<[number, number]> = [];
      let j = i;
      while (j > 0) {
        const ver = buf[j + 4]!;
        const off = ver === 1 ? j + 4 + 4 + 8 + 8 + 4 + 4 + 8 + 8 + 2 + 2 + 2 + 2 + 36 : j + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 8 + 2 + 2 + 2 + 2 + 36;
        const w = buf.readUInt32BE(off) >>> 16, h = buf.readUInt32BE(off + 4) >>> 16;
        if (w && h) vids.push([w, h]);
        j = buf.indexOf(Buffer.from('tkhd'), j + 4);
      }
      expect(vids, src).toContainEqual(dims[src]!);
    }
  });

  it('la creatividad cubre todo lo que el show reproduce (Brand Reveal → Signature)', () => {
    // El clip arranca en el Brand Reveal (3 s) y el show corta en Exit (14 s):
    // hacen falta al menos 11 s de contenido.
    const vivo = [3000, 6000, 9000, 12000, 13900].map((t) => at(t).screens.screen_a.mediaTimeMs);
    expect(Math.max(...vivo)).toBeLessThanOrEqual(11_000);
  });

  it('CRITERIO: el Signature mantiene las pantallas encendidas; solo Exit va a negro', () => {
    for (const t of [12000, 13000, 13900]) {
      const s = at(t);
      expect(s.screens.screen_a.output, `t=${t}`).not.toBe('black');
      expect(s.screens.screen_b.output, `t=${t}`).not.toBe('black');
    }
    expect(at(14200).screens.screen_a.output).toBe('black');
  });
});
