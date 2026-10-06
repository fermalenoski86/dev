import type { ScreenId, ShowRuntimeState, UvRect } from '@trust/shared-types';
import { FULL_FRAME } from '@trust/shared-types';
import type { ExperienceView } from './experience';

/**
 * Composición de la experiencia ejecutiva — M2C.2.1.
 *
 * Tres cosas que el renderer necesita y que NO debe deducir por su cuenta:
 *
 *  1. dónde cae cada superficie dentro del master de cada vista (geometría);
 *  2. qué media corresponde a cada superficie (sale de `ShowRuntimeState`);
 *  3. cómo se ve la iluminación por zona (también del estado).
 *
 * Todo acá es puro. El renderer pinta; el ShowEngine sigue siendo la única
 * autoridad sobre qué pasa.
 */

/* ────────────────────────────────────────────────────────────────
 * 1 · Geometría: un cuadrilátero por superficie y por vista
 * ──────────────────────────────────────────────────────────────── */

/** Punto en coordenadas normalizadas del master: 0..1 sobre ancho y alto. */
export interface Point2 {
  x: number;
  y: number;
}

/**
 * Cuadrilátero de cuatro esquinas, en orden: superior-izquierda,
 * superior-derecha, inferior-derecha, inferior-izquierda.
 *
 * M2C.2.1 / punto 3: un rectángulo con `skewY` no alcanza. Una pantalla vista
 * en perspectiva no es un paralelogramo — los dos bordes verticales convergen,
 * y con skew el contenido se desliza respecto del edificio. Con cuatro esquinas
 * libres la superficie calza sobre el master real, y ajustar el encaje cuando
 * lleguen las fotos definitivas es mover números, no reescribir el renderer.
 */
export interface Quad {
  tl: Point2;
  tr: Point2;
  br: Point2;
  bl: Point2;
}

/**
 * Una superficie puede necesitar VARIOS quads.
 *
 * La pantalla horizontal envuelve la ochava: es una banda curva que en la foto
 * sube hacia la esquina y baja hacia los extremos. Un solo cuadrilátero recto
 * deja al descubierto el vértice, y por ese hueco se ve el contenido REAL que
 * la pantalla estaba mostrando cuando se sacó la foto — un anuncio ajeno
 * asomando en medio de la presentación.
 *
 * Con segmentos, cada tramo toma su porción del clip y la banda queda cubierta.
 */
export type SurfaceQuads = Partial<Record<ScreenId, Quad | Quad[]>>;

/** Proporciones del master de cada vista. Necesarias para el encaje `cover`. */
export interface MasterSize {
  width: number;
  height: number;
}

/** Zonas de luz que cada vista puede representar, con su máscara. */
export interface LightLayer {
  /** Zonas de `ShowRuntimeState.zones` que alimentan esta capa. */
  zones: string[];
  /** Región normalizada donde se pinta. */
  quad: Quad;
  /** Desenfoque en px relativo al ancho del contenedor. */
  blur: number;
  label: 'architectural' | 'dome' | 'clock' | 'facade';
}

export interface ViewGeometry {
  /** Tamaño real del archivo. El encaje depende de su relación de aspecto. */
  master: MasterSize;
  surfaces: SurfaceQuads;
  lights: LightLayer[];
  /** Halo del reloj, si la vista lo muestra. */
  clock: { quad: Quad } | null;
}

const q = (
  tl: [number, number],
  tr: [number, number],
  br: [number, number],
  bl: [number, number],
): Quad => ({
  tl: { x: tl[0], y: tl[1] },
  tr: { x: tr[0], y: tr[1] },
  br: { x: br[0], y: br[1] },
  bl: { x: bl[0], y: bl[1] },
});

/**
 * ⚠️ VALORES PROVISORIOS.
 *
 * Están calzados contra los masters PLACEHOLDER actuales. Cuando entren las
 * fotografías definitivas hay que re-encajar estas ocho coordenadas por
 * superficie — es el único trabajo que exige el cambio de masters, y por eso
 * vive en una constante y no repartido por el renderer.
 */
export const VIEW_GEOMETRY: Record<ExperienceView, ViewGeometry> = {
  /*
   * Coordenadas MEDIDAS sobre las fotografías nocturnas del 05-10-2026
   * (masters en `apps/control/public/experience/`). La toma del hero es
   * frontal desde la vereda: el mismo punto de vista del boceto del cliente.
   *
   * · `horizontal` es la pantalla que YA existe, en dos segmentos que cubren
   *   la banda entera incluido el vértice de la ochava.
   *
   * ── LAS PANTALLAS SUPERIORES LAS FIJÓ EL CLIENTE ───────────────────
   *   Posición transferida de `boceto4.png` usando el ANCHO DEL TAMBOR DE LA
   *   CÚPULA como unidad común (está en el boceto y en la foto). Ajuste del
   *   cliente sobre la foto del 05-10: las dos del MISMO tamaño (1,37
   *   tambores de ancho) y misma diagonal; extremo exterior apoyado en la
   *   BARANDA de balaustres; borde interno contra el tambor, trepando hasta
   *   la columnata. Ajustes del cliente sobre mockup (05-10): el borde
   *   superior llega a la moldura donde arranca la curva de la cúpula, y A se
   *   corre apenas hacia afuera para no pisar la voluta donde arranca la
   *   columna del tambor.
   *
   * · `horizontal`: la marquesina dobla en CURVA por la ochava. 24 tramos
   *   generados del borde inferior MEDIDO cada 1 % y suavizado; el superior se
   *   deriva con el espesor real de la banda (el borde superior medido agarra
   *   ventanas iluminadas y hacía una joroba falsa).
   *
   *   Instrucción explícita: la posición exacta manda sobre la proporción del
   *   pliego (7,68 × 3,84 y 9,60 × 3,84). Resultado proyectado: A ≈ 2,8:1 y
   *   B ≈ 2,41:1. La desviación está en `PLACEMENT_ASPECT` y cubierta por test: es
   *   una decisión registrada, no un error.
   */
  HERO_CORNER: {
    master: { width: 2560, height: 1733 },
    surfaces: {
      screen_a: q([0.237, 0.335], [0.415, 0.266], [0.415, 0.360], [0.237, 0.429]),
      screen_b: q([0.555, 0.258], [0.733, 0.309], [0.733, 0.418], [0.555, 0.367]),
      horizontal: [
        q([0.0920, 0.8642], [0.1193, 0.8607], [0.1193, 0.9094], [0.0920, 0.9127]),
        q([0.1193, 0.8607], [0.1467, 0.8561], [0.1467, 0.9053], [0.1193, 0.9094]),
        q([0.1467, 0.8561], [0.1740, 0.8510], [0.1740, 0.9006], [0.1467, 0.9053]),
        q([0.1740, 0.8510], [0.2013, 0.8459], [0.2013, 0.8960], [0.1740, 0.9006]),
        q([0.2013, 0.8459], [0.2287, 0.8406], [0.2287, 0.8911], [0.2013, 0.8960]),
        q([0.2287, 0.8406], [0.2560, 0.8349], [0.2560, 0.8859], [0.2287, 0.8911]),
        q([0.2560, 0.8349], [0.2833, 0.8295], [0.2833, 0.8810], [0.2560, 0.8859]),
        q([0.2833, 0.8295], [0.3107, 0.8244], [0.3107, 0.8763], [0.2833, 0.8810]),
        q([0.3107, 0.8244], [0.3380, 0.8192], [0.3380, 0.8717], [0.3107, 0.8763]),
        q([0.3380, 0.8192], [0.3653, 0.8142], [0.3653, 0.8671], [0.3380, 0.8717]),
        q([0.3653, 0.8142], [0.3927, 0.8101], [0.3927, 0.8634], [0.3653, 0.8671]),
        q([0.3927, 0.8101], [0.4200, 0.8078], [0.4200, 0.8616], [0.3927, 0.8634]),
        q([0.4200, 0.8078], [0.4473, 0.8072], [0.4473, 0.8614], [0.4200, 0.8616]),
        q([0.4473, 0.8072], [0.4747, 0.8082], [0.4747, 0.8624], [0.4473, 0.8614]),
        q([0.4747, 0.8082], [0.5020, 0.8099], [0.5020, 0.8640], [0.4747, 0.8624]),
        q([0.5020, 0.8099], [0.5293, 0.8124], [0.5293, 0.8663], [0.5020, 0.8640]),
        q([0.5293, 0.8124], [0.5567, 0.8157], [0.5567, 0.8695], [0.5293, 0.8663]),
        q([0.5567, 0.8157], [0.5840, 0.8194], [0.5840, 0.8731], [0.5567, 0.8695]),
        q([0.5840, 0.8194], [0.6113, 0.8233], [0.6113, 0.8769], [0.5840, 0.8731]),
        q([0.6113, 0.8233], [0.6387, 0.8274], [0.6387, 0.8809], [0.6113, 0.8769]),
        q([0.6387, 0.8274], [0.6660, 0.8318], [0.6660, 0.8852], [0.6387, 0.8809]),
        q([0.6660, 0.8318], [0.6933, 0.8363], [0.6933, 0.8896], [0.6660, 0.8852]),
        q([0.6933, 0.8363], [0.7207, 0.8403], [0.7207, 0.8934], [0.6933, 0.8896]),
        q([0.7207, 0.8403], [0.7480, 0.8434], [0.7480, 0.8965], [0.7207, 0.8934]),
      ],
    },
    lights: [
      { zones: ['dome'], quad: q([0.40, 0.12], [0.58, 0.12], [0.59, 0.36], [0.39, 0.36]), blur: 0.05, label: 'dome' },
      { zones: ['tower_upper', 'tower_mid'], quad: q([0.18, 0.22], [0.86, 0.22], [0.86, 0.44], [0.18, 0.44]), blur: 0.05, label: 'architectural' },
      {
        zones: ['corrientes_left', 'corrientes_right', 'pellegrini_left', 'pellegrini_right', 'chamfer'],
        quad: q([0.10, 0.42], [0.88, 0.42], [0.88, 0.92], [0.10, 0.92]),
        blur: 0.07,
        label: 'facade',
      },
    ],
    clock: { quad: q([0.470, 0.095], [0.505, 0.095], [0.505, 0.145], [0.470, 0.145]) },
  },
  CORRIENTES: {
    // Recorte del mismo master: x' = x / 0.62.
    master: { width: 1587, height: 1733 },
    surfaces: {
      screen_a: q([0.382, 0.335], [0.669, 0.266], [0.669, 0.360], [0.382, 0.429]),
      horizontal: [
        q([0.1484, 0.8642], [0.1925, 0.8607], [0.1925, 0.9094], [0.1484, 0.9127]),
        q([0.1925, 0.8607], [0.2366, 0.8561], [0.2366, 0.9053], [0.1925, 0.9094]),
        q([0.2366, 0.8561], [0.2806, 0.8510], [0.2806, 0.9006], [0.2366, 0.9053]),
        q([0.2806, 0.8510], [0.3247, 0.8459], [0.3247, 0.8960], [0.2806, 0.9006]),
        q([0.3247, 0.8459], [0.3688, 0.8406], [0.3688, 0.8911], [0.3247, 0.8960]),
        q([0.3688, 0.8406], [0.4129, 0.8349], [0.4129, 0.8859], [0.3688, 0.8911]),
        q([0.4129, 0.8349], [0.4570, 0.8295], [0.4570, 0.8810], [0.4129, 0.8859]),
        q([0.4570, 0.8295], [0.5011, 0.8244], [0.5011, 0.8763], [0.4570, 0.8810]),
        q([0.5011, 0.8244], [0.5452, 0.8192], [0.5452, 0.8717], [0.5011, 0.8763]),
        q([0.5452, 0.8192], [0.5892, 0.8142], [0.5892, 0.8671], [0.5452, 0.8717]),
        q([0.5892, 0.8142], [0.6333, 0.8101], [0.6333, 0.8634], [0.5892, 0.8671]),
        q([0.6333, 0.8101], [0.6774, 0.8078], [0.6774, 0.8616], [0.6333, 0.8634]),
        q([0.6774, 0.8078], [0.7215, 0.8072], [0.7215, 0.8614], [0.6774, 0.8616]),
        q([0.7215, 0.8072], [0.7656, 0.8082], [0.7656, 0.8624], [0.7215, 0.8614]),
        q([0.7656, 0.8082], [0.8097, 0.8099], [0.8097, 0.8640], [0.7656, 0.8624]),
        q([0.8097, 0.8099], [0.8538, 0.8124], [0.8538, 0.8663], [0.8097, 0.8640]),
        q([0.8538, 0.8124], [0.8978, 0.8157], [0.8978, 0.8695], [0.8538, 0.8663]),
        q([0.8978, 0.8157], [0.9419, 0.8194], [0.9419, 0.8731], [0.8978, 0.8695]),
        q([0.9419, 0.8194], [0.9860, 0.8233], [0.9860, 0.8769], [0.9419, 0.8731]),
      ],
    },
    lights: [
      { zones: ['dome'], quad: q([0.645, 0.12], [0.935, 0.12], [0.952, 0.36], [0.629, 0.36]), blur: 0.05, label: 'dome' },
      { zones: ['corrientes_left', 'corrientes_right'], quad: q([0.16, 0.42], [1.0, 0.42], [1.0, 0.92], [0.16, 0.92]), blur: 0.07, label: 'facade' },
    ],
    clock: { quad: q([0.758, 0.095], [0.815, 0.095], [0.815, 0.145], [0.758, 0.145]) },
  },
  PELLEGRINI: {
    // x' = (x - 0.42) / 0.58
    master: { width: 1485, height: 1733 },
    surfaces: {
      screen_b: q([0.233, 0.258], [0.540, 0.309], [0.540, 0.418], [0.233, 0.367]),
      horizontal: [
        q([0.0000, 0.8078], [0.0471, 0.8072], [0.0471, 0.8614], [0.0000, 0.8616]),
        q([0.0471, 0.8072], [0.0943, 0.8082], [0.0943, 0.8624], [0.0471, 0.8614]),
        q([0.0943, 0.8082], [0.1414, 0.8099], [0.1414, 0.8640], [0.0943, 0.8624]),
        q([0.1414, 0.8099], [0.1885, 0.8124], [0.1885, 0.8663], [0.1414, 0.8640]),
        q([0.1885, 0.8124], [0.2356, 0.8157], [0.2356, 0.8695], [0.1885, 0.8663]),
        q([0.2356, 0.8157], [0.2828, 0.8194], [0.2828, 0.8731], [0.2356, 0.8695]),
        q([0.2828, 0.8194], [0.3299, 0.8233], [0.3299, 0.8769], [0.2828, 0.8731]),
        q([0.3299, 0.8233], [0.3770, 0.8274], [0.3770, 0.8809], [0.3299, 0.8769]),
        q([0.3770, 0.8274], [0.4241, 0.8318], [0.4241, 0.8852], [0.3770, 0.8809]),
        q([0.4241, 0.8318], [0.4713, 0.8363], [0.4713, 0.8896], [0.4241, 0.8852]),
        q([0.4713, 0.8363], [0.5184, 0.8403], [0.5184, 0.8934], [0.4713, 0.8896]),
        q([0.5184, 0.8403], [0.5655, 0.8434], [0.5655, 0.8965], [0.5184, 0.8934]),
      ],
    },
    lights: [
      { zones: ['dome'], quad: q([0.0, 0.12], [0.276, 0.12], [0.293, 0.36], [0.0, 0.36]), blur: 0.05, label: 'dome' },
      { zones: ['pellegrini_left', 'pellegrini_right'], quad: q([0.0, 0.42], [0.793, 0.42], [0.793, 0.92], [0.0, 0.92]), blur: 0.07, label: 'facade' },
    ],
    clock: { quad: q([0.086, 0.095], [0.147, 0.095], [0.147, 0.145], [0.086, 0.145]) },
  },
  OBELISCO_WIDE: {
    // Plano general desde la 9 de Julio con el Obelisco. Sin quads de pantalla
    // a propósito: a esa distancia serían rectángulos de dos píxeles.
    master: { width: 2560, height: 1733 },
    surfaces: {},
    lights: [
      { zones: ['dome', 'tower_upper'], quad: q([0.14, 0.06], [0.44, 0.06], [0.44, 0.40], [0.14, 0.40]), blur: 0.05, label: 'dome' },
    ],
    clock: null,
  },
};

/**
 * Relación de aspecto que RESULTA del emplazamiento fijado por el cliente,
 * medida en píxeles del master. Se compara contra la del pliego en el test
 * para que la diferencia quede a la vista y nadie la "corrija" sin querer.
 */
export const PLACEMENT_ASPECT = {
  screen_a: 2.8,
  screen_b: 2.41,
  source: 'boceto4.png · 2026-10-05 · posición fijada por el cliente, transferida por ancho de tambor',
} as const;

/* ────────────────────────────────────────────────────────────────
 * Homografía: cuadrado unidad → cuadrilátero
 * ──────────────────────────────────────────────────────────────── */

/**
 * Matriz de transformación proyectiva que lleva el cuadrado unidad al quad.
 *
 * Es la matemática estándar de homografía 2D. Se resuelve el sistema de 8
 * incógnitas en forma cerrada (no hay iteración ni aproximación) y se devuelve
 * la `matrix3d` de CSS, que es una 4×4 en orden column-major.
 *
 * Usar CSS y no WebGL es deliberado: una sola capa compuesta por el navegador
 * evita un canvas por superficie, y el video sigue siendo un `<video>` normal
 * — con su decodificador de hardware y su sincronía intacta.
 */
export function quadToMatrix3d(quad: Quad, width: number, height: number): string {
  const [x0, y0] = [quad.tl.x * width, quad.tl.y * height];
  const [x1, y1] = [quad.tr.x * width, quad.tr.y * height];
  const [x2, y2] = [quad.br.x * width, quad.br.y * height];
  const [x3, y3] = [quad.bl.x * width, quad.bl.y * height];

  // Origen en (0,0)-(1,1): se resuelve para el cuadrado unidad y se escala
  // después con el tamaño del elemento.
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  const den = dx1 * dy2 - dx2 * dy1;
  // Quad degenerado (tres puntos colineales): se cae a la identidad en vez de
  // emitir NaN, que en CSS descarta la transformación entera sin avisar.
  if (den === 0) return 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)';

  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;

  const m = [a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((v) => round(v)).join(',')})`;
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** Caja que envuelve al quad. Para posicionar el contenedor antes de transformar. */
export function quadBounds(quad: Quad): { x: number; y: number; w: number; h: number } {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/* ────────────────────────────────────────────────────────────────
 * 2 · Plan de superficies: qué media pinta cada una
 * ──────────────────────────────────────────────────────────────── */

export interface SurfacePlan {
  id: ScreenId;
  /** Índice de segmento. La horizontal envuelve la ochava en dos tramos. */
  segment: number;
  quad: Quad;
  /** Ruta del asset, tal como la resolvió el motor. null = nada que mostrar. */
  source: string | null;
  /** Recorte dentro de la fuente. Distinto de FULL_FRAME en un mediaGroup. */
  uv: UvRect;
  /** `live` reproduce · `hold` congela · `black` no muestra media. */
  output: 'live' | 'hold' | 'black';
  /** Posición dentro del clip, en ms. El renderer sincroniza contra esto. */
  mediaTimeMs: number;
}

/**
 * Traduce el estado del motor a lo que cada superficie de ESTA vista debe
 * pintar. No decide nada: lee `state.screens`, que ya resolvió el ShowEngine,
 * incluidos `source` y `uv` de los mediaGroups A+B.
 *
 * M2C.2.1 / punto 2: el renderer pintaba un degradado cuando `output === 'live'`.
 * Con esto muestra el asset real del ShowPackage, y el master A+B se reparte con
 * los `uvRect` que ya calculó el compilador.
 */
export function surfacePlan(state: ShowRuntimeState | null, view: ExperienceView): SurfacePlan[] {
  const geo = VIEW_GEOMETRY[view];
  const out: SurfacePlan[] = [];

  for (const [id, valor] of Object.entries(geo.surfaces) as Array<[ScreenId, Quad | Quad[]]>) {
    const rt = state?.screens[id];
    const segmentos = Array.isArray(valor) ? valor : [valor];
    const base = rt?.uv ?? FULL_FRAME;

    segmentos.forEach((quad, segment) => {
      /*
       * Con varios segmentos, cada uno toma su franja horizontal del recorte
       * que ya traía la superficie. Así la banda curva muestra el clip
       * completo repartido, en vez de repetirlo en cada tramo.
       */
      const ancho = base.w / segmentos.length;
      const uv =
        segmentos.length === 1 ? base : { x: base.x + ancho * segment, y: base.y, w: ancho, h: base.h };

      out.push({
        id,
        segment,
        quad,
        // `black` no muestra media: es negro real, no el último frame atenuado.
        source: rt && rt.output !== 'black' ? rt.source : null,
        uv,
        output: rt?.output ?? 'black',
        mediaTimeMs: rt?.mediaTimeMs ?? 0,
      });
    });
  }
  return out;
}

/** Fuentes distintas que la vista necesita. Una por decoder. */
export function activeSources(plans: readonly SurfacePlan[]): string[] {
  return [...new Set(plans.map((p) => p.source).filter((s): s is string => s !== null))];
}

/* ────────────────────────────────────────────────────────────────
 * 3 · Capas de luz
 * ──────────────────────────────────────────────────────────────── */

export interface LightPlan extends LightLayer {
  /** Intensidad media de las zonas que alimentan la capa, 0..1. */
  intensity: number;
  /** Color resultante, en hex. */
  color: string;
}

/**
 * M2C.2.1 / punto 4: en vez de un único círculo borroso gigante, cada vista
 * declara sus capas y cada capa se alimenta de zonas concretas del estado. La
 * cúpula puede quedar dorada mientras la fachada va de marca — que es
 * exactamente lo que hace `mcd_red_gold`, y antes no se veía.
 */
export function lightPlan(state: ShowRuntimeState | null, view: ExperienceView): LightPlan[] {
  return VIEW_GEOMETRY[view].lights.map((layer) => {
    const zonas = layer.zones
      .map((z) => state?.zones[z as keyof NonNullable<typeof state>['zones']])
      .filter((z): z is NonNullable<typeof z> => Boolean(z) && z!.enabled);

    if (zonas.length === 0) return { ...layer, intensity: 0, color: '#000000' };

    const intensity = zonas.reduce((s, z) => s + z.intensity, 0) / zonas.length;
    const r = zonas.reduce((s, z) => s + z.color.r, 0) / zonas.length;
    const g = zonas.reduce((s, z) => s + z.color.g, 0) / zonas.length;
    const b = zonas.reduce((s, z) => s + z.color.b, 0) / zonas.length;
    const w = zonas.reduce((s, z) => s + z.color.w, 0) / zonas.length;

    const ch = (c: number) =>
      Math.round(Math.min(1, c + w * 0.9) * 255)
        .toString(16)
        .padStart(2, '0');

    return { ...layer, intensity: round(intensity), color: `#${ch(r)}${ch(g)}${ch(b)}` };
  });
}

/* ────────────────────────────────────────────────────────────────
 * 4 · Reloj
 * ──────────────────────────────────────────────────────────────── */

export interface ClockPlan {
  quad: Quad;
  state: 'normal' | 'off' | 'accent' | 'countdown';
  /** Brillo ya resuelto por el motor. */
  intensity: number;
  angleDeg: number;
  visible: boolean;
}

/** Solo los cuatro estados que el contrato soporta hoy. Nada inventado. */
export function clockPlan(state: ShowRuntimeState | null, view: ExperienceView): ClockPlan | null {
  const geo = VIEW_GEOMETRY[view].clock;
  if (!geo || !state) return null;
  return {
    quad: geo.quad,
    state: state.clockState,
    intensity: state.clockIntensity,
    angleDeg: state.clockAngleDeg,
    visible: state.clockState !== 'off',
  };
}


/* ────────────────────────────────────────────────────────────────
 * Encaje `cover` — M2C.2.1 / punto 3
 * ──────────────────────────────────────────────────────────────── */

/**
 * `contain`: la foto entra ENTERA en el escenario.
 *
 * Con `cover`, un master vertical dentro de un escenario apaisado pierde
 * arriba y abajo — y justamente ahí están el reloj y la pantalla horizontal,
 * que son dos de las cuatro superficies. Se prefiere que el edificio entre
 * completo y que los costados los ocupe una copia desenfocada de la misma
 * foto, que se lee como profundidad de campo y no como un recorte fallido.
 *
 * Variante `cover`, que se conserva por si un master futuro es apaisado.
 *
 * Es imprescindible: el master es una foto vertical de la esquina y el
 * escenario suele ser apaisado, así que el navegador recorta la imagen. Si los
 * quads se escalaran con el contenedor a secas, las pantallas quedarían
 * corridas respecto del edificio justo en la vista que se le muestra al
 * cliente.
 */
export function containQuad(
  quad: Quad,
  master: MasterSize,
  containerW: number,
  containerH: number,
): Quad {
  const escala = Math.min(containerW / master.width, containerH / master.height);
  const w = master.width * escala;
  const h = master.height * escala;
  const dx = (containerW - w) / 2;
  const dy = (containerH - h) / 2;
  const map = (pt: Point2): Point2 => ({
    x: (pt.x * w + dx) / Math.max(1, containerW),
    y: (pt.y * h + dy) / Math.max(1, containerH),
  });
  return { tl: map(quad.tl), tr: map(quad.tr), br: map(quad.br), bl: map(quad.bl) };
}

export function coverQuad(
  quad: Quad,
  master: MasterSize,
  containerW: number,
  containerH: number,
): Quad {
  const escala = Math.max(containerW / master.width, containerH / master.height);
  const w = master.width * escala;
  const h = master.height * escala;
  const dx = (containerW - w) / 2;
  const dy = (containerH - h) / 2;

  // El resultado vuelve a normalizarse contra el contenedor, porque es lo que
  // espera `quadToMatrix3d`.
  const map = (pt: Point2): Point2 => ({
    x: (pt.x * w + dx) / Math.max(1, containerW),
    y: (pt.y * h + dy) / Math.max(1, containerH),
  });
  return { tl: map(quad.tl), tr: map(quad.tr), br: map(quad.br), bl: map(quad.bl) };
}
