import * as THREE from 'three';
import type { ScreenRuntimeState, UvRect } from '@trust/shared-types';

/**
 * REVIEW-001 / P0 — reproducción real de media.
 *
 * El motor dice, para cada pantalla y cada instante, qué clip va y en qué ms
 * del clip está. Este gestor hace que el `<video>` obedezca eso, y nada más.
 * No tiene lógica de show: es un actuador, igual que mañana lo será el
 * procesador LED en EDGE.
 *
 * El problema real: `video.currentTime` es un actuador impreciso. Escribirlo
 * cada frame produce tartamudeo, y no escribirlo nunca produce deriva. La
 * solución estándar es tolerancia de deriva — sólo corregir cuando se pasó de
 * un umbral, y dejar que el video corra solo el resto del tiempo.
 */

/** Deriva tolerada antes de forzar un salto, en ms. Por debajo de esto nadie lo ve. */
const DRIFT_TOLERANCE_MS = 120;
/** Deriva a partir de la cual se asume seek deliberado y no acumulación de error. */
const HARD_SEEK_MS = 600;

interface Entry {
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
  /** Vistas recortadas sobre el MISMO <video>. Una por pantalla del mediaGroup. */
  views: Map<string, THREE.Texture>;
  /** Última corrección forzada, para no pelearnos con el decodificador. */
  lastCorrectionAt: number;
  failed: boolean;
}

const uvKey = (uv: UvRect) => `${uv.x}|${uv.y}|${uv.w}|${uv.h}`;

/**
 * Fabrica del elemento de video. Por defecto un <video> real; en tests, un
 * doble que permite disparar `error` y verificar pause/load sin navegador.
 */
export type VideoFactory = () => HTMLVideoElement;

const defaultVideoFactory: VideoFactory = () => document.createElement('video');

export class MediaTextureManager {
  private entries = new Map<string, Entry>();
  private disposed = false;
  private readonly createVideo: VideoFactory;

  constructor(opts: { createVideo?: VideoFactory } = {}) {
    this.createVideo = opts.createVideo ?? defaultVideoFactory;
  }

  /**
   * Textura de un clip, opcionalmente recortada. Idempotente.
   *
   * REVIEW-002 / P1-5 — frame-lock A+B. La clave es `source`: dos pantallas que
   * piden la misma URL comparten UN `<video>`, o sea un solo decoder. Las vistas
   * recortadas son `Texture` clonadas que apuntan al mismo elemento y sólo
   * difieren en offset/repeat, así que es imposible que se separen un frame.
   *
   * ORIENTACIÓN DEL UV — vale la pena dejarlo escrito porque es la trampa
   * clásica de three y falla en silencio (cada pantalla muestra la mitad de
   * la otra, sin error de consola).
   *
   * `VideoTexture` viene con `flipY = true` por defecto, así que la imagen se
   * sube dada vuelta y termina viéndose derecha sobre un `PlaneGeometry`. El
   * muestreo es `v_textura = v_plano * repeat.y + offset.y`. Como la imagen se
   * ve derecha, `v = 0` cae en la parte de ABAJO de la imagen tal como se ve.
   *
   * Entonces, para un master apilado:
   *   offset.y = 0.5, repeat.y = 0.5  →  v ∈ [0.5, 1]  →  mitad de ARRIBA
   *   offset.y = 0,   repeat.y = 0.5  →  v ∈ [0, 0.5]  →  mitad de ABAJO
   *
   * En `test_towers_master.mp4` SCREEN A está arriba, así que screen_a lleva
   * `y: 0.5` y screen_b `y: 0`. Es lo que está en los shows demo.
   *
   * Si al abrirlo la torre A muestra "SCREEN B", el supuesto de flipY no se
   * cumplió en ese navegador: se invierten los dos `y` en el JSON del show y
   * listo, sin tocar código.
   */
  acquire(source: string, uv?: UvRect): THREE.Texture | null {
    if (this.disposed) return null;
    const existing = this.entries.get(source);
    if (existing) {
      if (existing.failed) return null;
      return this.view(existing, uv);
    }

    const video = this.createVideo();
    video.src = source;
    video.crossOrigin = 'anonymous';
    video.loop = false;
    video.muted = true; // autoplay sin gesto del usuario lo exige
    video.playsInline = true;
    video.preload = 'auto';

    const entry: Entry = {
      video,
      texture: Object.assign(new THREE.VideoTexture(video), {
        colorSpace: THREE.SRGBColorSpace,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      }),
      views: new Map<string, THREE.Texture>(),
      lastCorrectionAt: 0,
      failed: false,
    };

    // Un clip que no carga no puede romper el resto del show: la pantalla
    // queda en negro y se registra. En EDGE esto dispara SAFE MODE.
    video.addEventListener('error', () => {
      entry.failed = true;
      this.onError?.(source, video.error?.message ?? 'no se pudo cargar');
    });

    this.entries.set(source, entry);
    return this.view(entry, uv);
  }

  /** Vista recortada sobre el decoder compartido. Sin recorte devuelve el original. */
  private view(entry: Entry, uv?: UvRect): THREE.Texture {
    if (!uv || (uv.x === 0 && uv.y === 0 && uv.w === 1 && uv.h === 1)) return entry.texture;
    const key = uvKey(uv);
    const cached = entry.views.get(key);
    if (cached) return cached;

    const view = entry.texture.clone(); // comparte `image`, o sea el mismo <video>
    view.offset.set(uv.x, uv.y);
    view.repeat.set(uv.w, uv.h);
    view.needsUpdate = true;
    entry.views.set(key, view);
    return view;
  }

  /**
   * REVIEW-002 / P2-11. Pausa y libera todo clip que el show actual ya no usa.
   * Sin esto, al cambiar de show el decoder anterior sigue vivo consumiendo
   * CPU y, peor, sigue avanzando: si se vuelve a ese show, arranca desfasado.
   */
  syncActiveSources(activeSources: ReadonlySet<string>): void {
    for (const [source, entry] of [...this.entries]) {
      // Una fuente activa pero fallada se libera igual: asi el proximo
      // acquire() la reintenta en vez de devolver null para siempre.
      if (activeSources.has(source) && !entry.failed) continue;
      this.release(source);
    }
  }

  /** Callback opcional para que la UI o el watchdog se enteren de un fallo. */
  onError?: (source: string, message: string) => void;

  /**
   * REVIEW-003 / P1-6. Reintenta un clip que fallo.
   *
   * Sin esto, una entrada `failed` quedaba pegada: recargar el mismo show con
   * la misma URL seguia devolviendo null porque la entrada no se liberaba, y la
   * unica salida era refrescar la pagina. En una sala de control, refrescar la
   * pagina para recuperar una pantalla no es una opcion.
   *
   * Devuelve false si el clip no estaba fallado (nada que reintentar).
   */
  retry(source: string): boolean {
    const entry = this.entries.get(source);
    if (!entry || !entry.failed) return false;
    this.release(source);
    this.acquire(source);
    return true;
  }

  /** Reintenta todos los clips fallados. Devuelve cuantos se reintentaron. */
  retryAllFailed(): number {
    let n = 0;
    for (const [source, entry] of [...this.entries]) {
      if (entry.failed && this.retry(source)) n += 1;
    }
    return n;
  }

  /** Lista de fuentes actualmente en estado de fallo. */
  failedSources(): string[] {
    return [...this.entries].filter(([, e]) => e.failed).map(([source]) => source);
  }

  /** Libera una fuente concreta: pausa el video, descarga y tira las texturas. */
  release(source: string): void {
    const entry = this.entries.get(source);
    if (!entry) return;
    entry.video.pause();
    entry.video.removeAttribute('src');
    entry.video.load();
    for (const view of entry.views.values()) view.dispose();
    entry.texture.dispose();
    this.entries.delete(source);
  }

  /**
   * Alinea un `<video>` con lo que el motor dice que debería estar pasando.
   * Se llama una vez por frame y por pantalla.
   */
  sync(runtime: ScreenRuntimeState, nowMs: number): void {
    if (!runtime.source) return;
    const entry = this.entries.get(runtime.source);
    if (!entry || entry.failed) return;
    const { video } = entry;
    if (video.readyState < 1) return; // todavía no sabe ni su duración

    const targetSec = runtime.mediaTimeMs / 1000;

    /*
     * REVIEW-002 / P0-1. El actuador obedece a `output`, no a `cue`.
     *
     * Antes miraba `playing`, que seguía en true con el transporte pausado:
     * el manager llamaba video.play() contra un target congelado y el
     * resultado era tartamudeo y correcciones en bucle.
     */
    if (runtime.output !== 'live') {
      if (!video.paused) video.pause();
      // `hold` congela el frame exacto; `black` no se dibuja, pero igual se
      // deja el video en su posición para que reanudar sea instantáneo.
      if (Math.abs(video.currentTime - targetSec) > 0.04) video.currentTime = targetSec;
      return;
    }

    const driftMs = Math.abs(video.currentTime - targetSec) * 1000;

    if (driftMs > HARD_SEEK_MS) {
      // Salto grande: seek del operador, o el tab estuvo en segundo plano.
      video.currentTime = targetSec;
      entry.lastCorrectionAt = nowMs;
    } else if (driftMs > DRIFT_TOLERANCE_MS && nowMs - entry.lastCorrectionAt > 500) {
      // Deriva acumulada: corregir, pero no más de dos veces por segundo.
      video.currentTime = targetSec;
      entry.lastCorrectionAt = nowMs;
    }

    if (video.paused) {
      // play() devuelve promesa y puede rechazar por política de autoplay.
      void video.play().catch(() => undefined);
    }
  }

  /** Deriva actual de una pantalla, en ms. Para mostrar en la UI de diagnóstico. */
  getDriftMs(runtime: ScreenRuntimeState): number | null {
    if (!runtime.source) return null;
    const entry = this.entries.get(runtime.source);
    if (!entry || entry.failed || entry.video.readyState < 1) return null;
    return Math.round((entry.video.currentTime * 1000 - runtime.mediaTimeMs) * 1) / 1;
  }

  hasFailed(source: string | null): boolean {
    return source ? (this.entries.get(source)?.failed ?? false) : false;
  }

  /** Libera todo. Obligatorio al desmontar: los `<video>` no se limpian solos. */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.video.pause();
      entry.video.removeAttribute('src');
      entry.video.load();
      for (const view of entry.views.values()) view.dispose();
      entry.texture.dispose();
    }
    this.entries.clear();
  }
}
