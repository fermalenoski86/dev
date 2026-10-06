'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { quadToMatrix3d, type SurfacePlan } from '@trust/experience-core';

/**
 * SURFACE MEDIA RENDERER — M2C.2.1 / puntos 2 y 3.
 *
 * Pinta el asset REAL de una superficie, recortado por su `uvRect` y encajado
 * en el cuadrilátero de la vista.
 *
 * Antes el renderer ejecutivo dibujaba un degradado de color cuando
 * `output === 'live'`. Eso alcanza para un diagrama técnico y no alcanza para
 * una presentación: lo que se le muestra al cliente tiene que ser el contenido
 * que va a salir al aire, no una representación de que hay contenido.
 *
 * NO resuelve nada del show. Recibe `SurfacePlan`, que ya salió de
 * `ShowRuntimeState`: qué fuente, qué recorte, qué salida y en qué ms del clip.
 */

/**
 * Diagnóstico por superficie — M2C.2.2 / P0.
 *
 * `data-output="live"` solo dice lo que PIDE el motor. No dice que el decoder
 * haya entregado un frame ni que el canvas lo haya pintado. Esto expone el
 * estado real para que un test pueda afirmar sobre píxeles, no intenciones.
 */
export interface SurfaceDiagnostic {
  id: string;
  segment: number;
  output: string;
  source: string | null;
  readyState: number;
  videoWidth: number;
  videoHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  framesDrawn: number;
  paused: boolean;
  currentTime: number;
  lastError: string | null;
}

const diagnostics = new Map<string, SurfaceDiagnostic>();

declare global {
  interface Window {
    __TRUST_SURFACES__?: () => SurfaceDiagnostic[];
  }
}

if (typeof window !== 'undefined') {
  window.__TRUST_SURFACES__ = () => [...diagnostics.values()];
}

/** Un `<video>` por FUENTE, compartido por las superficies que la usan. */
const videos = new Map<string, HTMLVideoElement>();

function getVideo(source: string): HTMLVideoElement {
  let v = videos.get(source);
  if (!v) {
    v = document.createElement('video');
    v.src = source;
    v.loop = false;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    videos.set(source, v);
  }
  return v;
}

/**
 * Grano compartido: un tile de ruido generado una vez. Se aplica DENTRO del
 * canvas al dibujar, no como capa CSS — ver `pintar`.
 */
let granoTile: HTMLCanvasElement | null = null;
function getGrano(): HTMLCanvasElement {
  if (granoTile) return granoTile;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      // gris medio ± ruido: en 'overlay' no cambia el brillo, solo agrega textura
      const v = 128 + (Math.random() + Math.random() + Math.random() - 1.5) * 70;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  granoTile = c;
  return c;
}

/** Deriva tolerada antes de corregir. Por debajo, nadie la ve. */
const DRIFT_MS = 300;

/**
 * UN SOLO loop de dibujo para todas las superficies.
 *
 * Con un `requestAnimationFrame` por superficie, A y B leían el mismo `<video>`
 * en ticks distintos y podían quedar separadas por un par de frames. El decoder
 * es uno —eso garantiza que no haya deriva acumulada— pero el PINTADO también
 * tiene que ser simultáneo: si no, el contenido anamórfico se abre justo en la
 * arista de la ochava, que es donde el cliente está mirando.
 *
 * Un loop compartido dibuja todas las superficies dentro del mismo frame.
 */
type Pintor = () => void;
const pintores = new Set<Pintor>();
let loop = 0;

function registrarPintor(fn: Pintor): () => void {
  pintores.add(fn);
  if (!loop) {
    const tick = () => {
      loop = requestAnimationFrame(tick);
      for (const p of pintores) p();
    };
    loop = requestAnimationFrame(tick);
  }
  return () => {
    pintores.delete(fn);
    if (pintores.size === 0 && loop) {
      cancelAnimationFrame(loop);
      loop = 0;
    }
  };
}

export function SurfaceMedia({
  plan,
  containerW,
  containerH,
  audioEnabled,
  glowStrength = 1,
  angleDim = 1,
  atenuarHold = true,
}: {
  plan: SurfacePlan;
  containerW: number;
  containerH: number;
  audioEnabled: boolean;
  /**
   * Intensidad de la emisión. La marquesina son muchos tramos de UNA sola
   * pantalla: si cada tramo emitiera al 100 % los halos se sumarían.
   */
  glowStrength?: number;
  /** Caída por ángulo: la superficie que mira más de costado, apenas más oscura. */
  angleDim?: number;
  /**
   * Atenuar en HOLD. Sirve al operador para distinguir congelado de vivo; en
   * Client Mode un Brand Moment congelado es una imagen para mostrar, y
   * atenuada se ve peor. Por eso lo decide el modo, no la superficie.
   */
  atenuarHold?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  /** Color promedio del frame, para que la emisión tenga el color del contenido. */
  const [glow, setGlow] = useState<[number, number, number]>([0, 0, 0]);

  /*
   * La homografía lleva el CUADRADO UNIDAD al quad, en píxeles del contenedor.
   * El elemento, en cambio, mide el contenedor entero, así que primero se lo
   * reduce a 1×1 con `scale(1/W, 1/H)` y recién después se aplica la matriz.
   *
   * Sin ese paso la escala queda aplicada dos veces —una en el tamaño del
   * elemento y otra dentro de la matriz— y las superficies salen enormes y
   * fuera de lugar. Mantener el elemento a tamaño completo, en lugar de
   * achicarlo a 1×1 px, es lo que permite que el canvas rasterice a resolución
   * real en vez de escalar un píxel.
   *
   * CSS compone de izquierda a derecha: primero `matrix3d`, después `scale`.
   */
  /*
   * RENDIMIENTO. El elemento mide la caja de SU cuadrilátero, no el escenario.
   * La homografía lleva el cuadrado unidad al quad en px del escenario; antes
   * de aplicarla, `scale(1/bw, 1/bh)` reduce el elemento a 1×1. El resultado
   * en pantalla es idéntico, pero el navegador rasteriza bw×bh en vez de
   * 1600×1000: para un tramo de la marquesina, ~300 veces menos píxeles.
   * Con 26 superficies y sin GPU, eso es la diferencia entre 1 y 30 fps.
   */
  const { matrix, bw, bh } = useMemo(() => {
    const w = Math.max(1, containerW);
    const h = Math.max(1, containerH);
    const xs = [plan.quad.tl.x, plan.quad.tr.x, plan.quad.br.x, plan.quad.bl.x];
    const ys = [plan.quad.tl.y, plan.quad.tr.y, plan.quad.br.y, plan.quad.bl.y];
    const bw = Math.max(2, Math.round((Math.max(...xs) - Math.min(...xs)) * w));
    const bh = Math.max(2, Math.round((Math.max(...ys) - Math.min(...ys)) * h));
    return { matrix: `${quadToMatrix3d(plan.quad, w, h)} scale(${1 / bw}, ${1 / bh})`, bw, bh };
  }, [plan.quad, containerW, containerH]);

  const tamano = useRef({ w: bw, h: bh });
  tamano.current = { w: bw, h: bh };

  const caja = {
    left: 0,
    top: 0,
    width: `${bw}px`,
    height: `${bh}px`,
    transform: matrix,
    transformOrigin: '0 0' as const,
  };

  // Monta el <video> compartido dentro de esta superficie y lo sincroniza.
  useEffect(() => {
    const el = host.current;
    if (!el || !plan.source) return;

    const video = getVideo(plan.source);
    video.muted = !audioEnabled;

    /*
     * Un mismo <video> no puede estar en dos lugares del DOM a la vez, y A+B
     * comparten fuente. Se dibuja sobre un <canvas> por superficie, recortando
     * el uvRect: un solo decoder, dos recortes. Es el mismo principio que el
     * frame-lock del PREVIS.
     */
    const canvas = el.querySelector('canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const clave = `${plan.id}_${plan.segment}`;
    let frames = 0;
    let patron: CanvasPattern | null = null;
    const muestra = document.createElement('canvas');
    muestra.width = 1;
    muestra.height = 1;

    const pintar = () => {
      diagnostics.set(clave, {
        id: plan.id,
        segment: plan.segment,
        output: plan.output,
        source: plan.source,
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        framesDrawn: frames,
        paused: video.paused,
        currentTime: video.currentTime,
        lastError: video.error ? `code ${video.error.code}` : null,
      });

      if (video.readyState < 2) return;

      const sw = video.videoWidth;
      const sh = video.videoHeight;
      if (!sw || !sh) return;

      // El uvRect viene en espacio de textura (origen abajo). El canvas dibuja
      // con origen arriba, así que la Y se invierte acá y en un solo lugar.
      const sx = plan.uv.x * sw;
      const sWidth = plan.uv.w * sw;
      const sHeight = plan.uv.h * sh;
      const sy = (1 - plan.uv.y - plan.uv.h) * sh;

      /*
       * Resolución del canvas: la del recorte, pero tope a 2× lo que ocupa en
       * pantalla. Una pantalla superior mide ~300 px en el escenario; pintar
       * su recorte completo de 1152×576 en cada cuadro era trabajo tirado.
       */
      const tope = tamano.current;
      const cw = Math.max(1, Math.round(Math.min(sWidth, tope.w * 2)));
      const ch = Math.max(1, Math.round(Math.min(sHeight, tope.h * 2)));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
        patron = null; // el patrón depende del contexto; se recrea
      }
      /*
       * M2C.2.2 / 3 — integración a la foto, hecha EN EL CANVAS.
       *
       * Antes era `filter` CSS en el <canvas> y capas con `mix-blend-mode`.
       * Sobre elementos con `matrix3d`, eso obliga al compositor a rehacer
       * cada capa en cada cuadro: con 26 superficies y sin GPU se congelaba
       * después del primer frame. Acá todo cae sobre un bitmap chico, una vez
       * por frame, y el compositor solo mueve una textura ya terminada.
       */
      // Solo matriz de color: barata. El desenfoque de medio píxel no se ve a
      // esta escala y sin GPU costaba más que todo el resto del cuadro.
      ctx.filter = `saturate(0.86) sepia(0.07) brightness(${(0.97 * angleDim).toFixed(3)})`;
      ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';
      // negro levantado: una LED encendida tampoco llega a #000
      ctx.globalCompositeOperation = 'lighten';
      ctx.fillStyle = '#0a0b0e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // grano de la foto
      if (!patron) patron = ctx.createPattern(getGrano(), 'repeat');
      if (patron) {
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = patron;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';
      frames += 1;

      // Color promedio para la emisión: 1×1 px, cada ~20 frames. Barato, y el
      // halo no necesita seguir el contenido cuadro a cuadro.
      if (frames % 20 === 1) {
        const m = muestra.getContext('2d', { willReadFrequently: true });
        if (m) {
          m.drawImage(canvas, 0, 0, 1, 1);
          const d = m.getImageData(0, 0, 1, 1).data;
          setGlow((g) =>
            Math.abs(g[0] - d[0]!) + Math.abs(g[1] - d[1]!) + Math.abs(g[2] - d[2]!) > 12 ? [d[0]!, d[1]!, d[2]!] : g,
          );
        }
      }
    };
    return registrarPintor(pintar);
    /*
     * M2C.2.2 / P0. Las dependencias son los VALORES del recorte, no el objeto.
     *
     * `surfacePlan` arma un `uv` nuevo en cada tick, así que con `plan.uv` en
     * las dependencias este efecto se desmontaba y volvía a montar 60 veces por
     * segundo: el pintor se desregistraba antes de llegar a dibujar y la
     * superficie quedaba negra. Se veía en el diagnóstico como `frames=0`
     * mientras el video reproducía sin problemas.
     */
  }, [plan.source, plan.uv.x, plan.uv.y, plan.uv.w, plan.uv.h, audioEnabled, angleDim]);

  // El transporte del video obedece a `output`, nunca a lo que le parezca.
  useEffect(() => {
    if (!plan.source) return;
    const video = getVideo(plan.source);

    /*
     * Los clips de demo duran menos que el show, así que a partir de cierto
     * punto el `<video>` llegaba al final y las pantallas quedaban en negro en
     * plena presentación. Para el PREVIEW se cicla el clip.
     *
     * Ojo: esto es una decisión de PREVISUALIZACIÓN, no del producto. Si un
     * clip real es más corto que su momento, eso es un problema del show y lo
     * tiene que resolver el Builder, no taparlo el renderer.
     */
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const bruto = plan.mediaTimeMs / 1000;
    const targetSec = dur > 0 ? bruto % dur : bruto;

    if (plan.output !== 'live') {
      if (!video.paused) video.pause();
      if (Math.abs(video.currentTime - targetSec) > 0.04) video.currentTime = targetSec;
      return;
    }
    /*
     * No re-buscar mientras ya está buscando. Con el cuadro lento (notebook
     * sin GPU, carga alta) la deriva supera el umbral en cada tick, y buscar
     * en cada tick deja al video en `readyState 1` para siempre: nunca tiene
     * el frame y la pantalla queda negra. Mejor 300 ms de deriva que negro.
     */
    if (!video.seeking && Math.abs(video.currentTime - targetSec) * 1000 > DRIFT_MS) video.currentTime = targetSec;
    if (video.paused) void video.play().catch(() => undefined);
  }, [plan.source, plan.output, plan.mediaTimeMs]);

  /*
   * M2C.2.2 / 3 — integración visual. Todo en el MISMO espacio transformado
   * que la cara frontal, así la emisión y el grano siguen la perspectiva.
   */
  const vivo = plan.output !== 'black' && Boolean(plan.source);

  // Una LED apagada de noche no es un rectángulo #000: es gris muy oscuro con
  // el reflejo del cielo, y conserva la textura de la foto.
  const apagada = (
    <div
      data-testid={`surface-${plan.id}`}
      data-output="black"
      className="absolute overflow-hidden"
      style={{ ...caja, background: 'linear-gradient(to bottom, #1b1e25 0%, #12141a 55%, #0d0f13 100%)' }}
    >
      <div className="absolute inset-0" style={GRANO} />
    </div>
  );
  if (!vivo) return apagada;

  const [r, g, b] = glow;
  return (
    <>
      {/*
        Emisión: un halo del color promedio del frame, POR DETRÁS de la cara
        frontal y sin `overflow-hidden`, para que se derrame sobre la piedra.
        MUY sutil a propósito: si se nota como glow, arruinó la foto.
      */}
      {/*
        RENDIMIENTO: un `blur` grande sobre una capa del tamaño del escenario es
        caro, y sin GPU 26 de esas capas congelan el compositor — el canvas
        pinta pero nunca llega a la pantalla. Por eso el halo solo existe donde
        `glowStrength > 0` (las dos superiores).
      */}
      {glowStrength > 0 && (
        /*
         * Halo: una caja MÁS GRANDE que la pantalla dentro del mismo espacio
         * transformado — la homografía la proyecta alrededor del frente con la
         * perspectiva correcta — pintada con un degradé radial. Sin `filter`:
         * un blur grande sobre capas transformadas es lo que congelaba todo.
         */
        <div aria-hidden className="pointer-events-none absolute" style={{ ...caja }}>
          <div
            style={{
              position: 'absolute',
              left: '-35%',
              top: '-70%',
              width: '170%',
              height: '260%',
              background: `radial-gradient(ellipse 50% 50% at 50% 50%, rgba(${r}, ${g}, ${b}, ${(0.20 * glowStrength * (plan.output === 'hold' ? 0.6 : 1)).toFixed(3)}) 0%, rgba(${r}, ${g}, ${b}, 0) 70%)`,
            }}
          />
        </div>
      )}
      <div
        ref={host}
        data-testid={`surface-${plan.id}`}
        data-output={plan.output}
        data-source={plan.source}
        className="absolute overflow-hidden"
        style={{
          ...caja,
          background: '#0b0d10',
          // `hold` se atenúa levemente: el operador distingue congelado de vivo.
          opacity: plan.output === 'hold' && atenuarHold ? 0.72 : 1,
        }}
      >
        {/* La graduación, el negro levantado y el grano se aplican en `pintar`. */}
        <canvas className="h-full w-full" style={{ display: 'block' }} />
      </div>
    </>
  );
}

/** Textura de grano, en overlay: el gris medio no cambia el brillo. */
const GRANO: React.CSSProperties = {
  backgroundImage: 'url(/experience/grain.png)',
  backgroundRepeat: 'repeat',
  backgroundSize: '256px 256px',
  mixBlendMode: 'overlay',
  opacity: 0.16,
  pointerEvents: 'none',
};

/** Libera los decoders que ninguna vista usa. */
/**
 * Fuentes fijadas: nunca se liberan.
 *
 * M2C.2.2 / 12. El renderer liberaba los decoders "sin uso" en cada render, y
 * al montar —antes del PLAY— no hay ninguna superficie en LIVE: le arrancaba el
 * `src` al video que el warm-up estaba cargando. El clip chico llegaba a tiempo
 * y el grande nunca, así que READY TO PRESENT no se encendía. Los clips del
 * show se fijan al cargar la experiencia y quedan calientes toda la reunión.
 */
const pinned = new Set<string>();

export function pinSources(sources: readonly string[]): void {
  for (const s of sources) pinned.add(s);
}

export function releaseUnusedSources(active: readonly string[]): void {
  for (const [src, v] of videos) {
    if (active.includes(src) || pinned.has(src)) continue;
    v.pause();
    v.removeAttribute('src');
    v.load();
    videos.delete(src);
  }
}

/* ────────────────────────────────────────────────────────────────
 * WARM-UP — M2C.2.2 / puntos 12 y 14
 * ──────────────────────────────────────────────────────────────── */

export interface WarmUpResult {
  source: string;
  ok: boolean;
  detail: string;
  durationS: number;
}

/**
 * Calienta un clip EN EL DECODER QUE VA A USAR PLAY.
 *
 * La precarga anterior creaba `<video>` descartables: el navegador bajaba el
 * archivo, pero el elemento que después reproduce arrancaba de cero y el
 * primer PLAY mostraba negro hasta decodificar. Esto usa el mismo `<video>`
 * compartido del mapa de fuentes: baja, decodifica un frame real sobre un
 * canvas, vuelve a 0 y lo deja listo. PLAY en la reunión es instantáneo.
 *
 * Y es la definición honesta de "cargado": no es que el archivo exista, es
 * que el decoder entregó un frame.
 */
export async function warmUpSource(source: string, timeoutMs = 15_000): Promise<WarmUpResult> {
  if (typeof document === 'undefined') return { source, ok: false, detail: 'sin DOM', durationS: 0 };
  const video = getVideo(source);
  video.preload = 'auto';

  try {
    /*
     * Se sondea `readyState` en vez de esperar `canplaythrough`: ese evento
     * depende de una estimación de ancho de banda y en algunos Chromium no
     * llega aunque el video ya esté en HAVE_ENOUGH_DATA. Lo que importa no es
     * el evento, es que haya datos para dibujar un frame.
     */
    if (video.readyState < 2) {
      if (video.networkState === HTMLMediaElement.NETWORK_EMPTY) video.load();
      const inicio = Date.now();
      while (video.readyState < 2) {
        if (video.error) throw new Error(`error de media (code ${video.error.code})`);
        if (Date.now() - inicio > timeoutMs) throw new Error('timeout de carga');
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!video.videoWidth || !video.videoHeight) {
      return { source, ok: false, detail: 'sin dimensiones de video', durationS: 0 };
    }

    // Un frame de verdad, no una promesa de que habrá uno.
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { source, ok: false, detail: 'sin contexto 2d', durationS: 0 };
    ctx.drawImage(video, 0, 0, 4, 4);
    const px = ctx.getImageData(0, 0, 4, 4).data;
    const pinto = px.some((v, i) => i % 4 === 3 && v > 0);
    if (!pinto) return { source, ok: false, detail: 'el decoder no entregó frame', durationS: video.duration };

    // De vuelta al inicio, listo para PLAY.
    video.pause();
    video.currentTime = 0;
    return {
      source,
      ok: true,
      detail: `${video.videoWidth}×${video.videoHeight} · ${video.duration.toFixed(1)} s`,
      durationS: video.duration,
    };
  } catch (e) {
    return { source, ok: false, detail: e instanceof Error ? e.message : 'fallo desconocido', durationS: 0 };
  }
}

export async function warmUpAll(sources: readonly string[]): Promise<WarmUpResult[]> {
  return Promise.all(sources.map((s) => warmUpSource(s)));
}

declare global {
  interface Window {
    /** Diagnóstico de operador: calentar una fuente a mano desde consola. */
    __TRUST_WARMUP__?: (source: string) => Promise<WarmUpResult>;
  }
}
if (typeof window !== 'undefined') window.__TRUST_WARMUP__ = warmUpSource;
