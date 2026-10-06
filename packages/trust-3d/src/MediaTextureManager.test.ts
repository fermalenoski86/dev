import { describe, it, expect, beforeEach } from 'vitest';
import type { ScreenRuntimeState } from '@trust/shared-types';
import { MediaTextureManager } from './MediaTextureManager';

/**
 * Doble de <video>. Registra lo que el manager le hace y permite simular un
 * fallo de carga. No es un navegador: verifica la LOGICA del actuador, no el
 * decodificado real. Eso sigue pendiente de la prueba en Chrome/Edge.
 */
class FakeVideo {
  static creados: FakeVideo[] = [];

  src = '';
  crossOrigin: string | null = null;
  loop = false;
  muted = false;
  playsInline = false;
  preload = '';
  readyState = 4; // HAVE_ENOUGH_DATA
  paused = true;
  currentTime = 0;
  error: { message: string } | null = null;

  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;
  seeks: number[] = [];
  private listeners: Record<string, Array<() => void>> = {};

  constructor() {
    FakeVideo.creados.push(this);
    // Interceptar escrituras a currentTime para contar correcciones.
    let t = 0;
    Object.defineProperty(this, 'currentTime', {
      get: () => t,
      set: (v: number) => {
        t = v;
        this.seeks.push(v);
      },
    });
  }

  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  load() {
    this.loadCalls += 1;
  }
  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }
  play() {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  /** Simula que el navegador no pudo cargar el clip. */
  fallar(message = 'MEDIA_ERR_SRC_NOT_SUPPORTED') {
    this.error = { message };
    for (const fn of this.listeners.error ?? []) fn();
  }
}

const crear = () => {
  const errores: Array<[string, string]> = [];
  const m = new MediaTextureManager({
    createVideo: () => new FakeVideo() as unknown as HTMLVideoElement,
  });
  m.onError = (src, msg) => errores.push([src, msg]);
  return { m, errores };
};

const ultimo = () => FakeVideo.creados[FakeVideo.creados.length - 1]!;

const pantalla = (over: Partial<ScreenRuntimeState> = {}): ScreenRuntimeState => ({
  id: 'screen_a',
  source: '/demo/a.mp4',
  uv: { x: 0, y: 0, w: 1, h: 1 },
  cue: 'playing',
  output: 'live',
  mediaTimeMs: 0,
  ...over,
});

beforeEach(() => {
  FakeVideo.creados = [];
});

describe('Gate V3.1 punto 4: fallo y retry de media', () => {
  it('un clip que falla queda marcado, avisa y deja de entregar textura', () => {
    const { m, errores } = crear();
    expect(m.acquire('/demo/a.mp4')).not.toBeNull();
    ultimo().fallar();

    expect(m.hasFailed('/demo/a.mp4')).toBe(true);
    expect(m.failedSources()).toEqual(['/demo/a.mp4']);
    expect(errores).toEqual([['/demo/a.mp4', 'MEDIA_ERR_SRC_NOT_SUPPORTED']]);
    expect(m.acquire('/demo/a.mp4')).toBeNull();
  });

  it('retry crea un <video> NUEVO y vuelve a entregar textura, sin recargar la app', () => {
    const { m } = crear();
    m.acquire('/demo/a.mp4');
    const viejo = ultimo();
    viejo.fallar();

    expect(m.retry('/demo/a.mp4')).toBe(true);
    const nuevo = ultimo();

    expect(nuevo).not.toBe(viejo);
    expect(FakeVideo.creados).toHaveLength(2);
    expect(nuevo.src).toBe('/demo/a.mp4');
    expect(m.hasFailed('/demo/a.mp4')).toBe(false);
    expect(m.acquire('/demo/a.mp4')).not.toBeNull();
  });

  it('retry libera el decoder viejo: pausa, descarga y suelta el src', () => {
    const { m } = crear();
    m.acquire('/demo/a.mp4');
    const viejo = ultimo();
    viejo.fallar();
    m.retry('/demo/a.mp4');

    expect(viejo.pauseCalls).toBeGreaterThan(0);
    expect(viejo.loadCalls).toBe(1);
    expect(viejo.src).toBe('');
  });

  it('retry sobre un clip sano no hace nada', () => {
    const { m } = crear();
    m.acquire('/demo/a.mp4');
    expect(m.retry('/demo/a.mp4')).toBe(false);
    expect(FakeVideo.creados).toHaveLength(1);
  });

  it('retry sobre una fuente desconocida no hace nada', () => {
    const { m } = crear();
    expect(m.retry('/demo/nunca.mp4')).toBe(false);
  });

  it('un segundo fallo despues del retry se vuelve a reportar', () => {
    const { m, errores } = crear();
    m.acquire('/demo/a.mp4');
    ultimo().fallar('primero');
    m.retry('/demo/a.mp4');
    ultimo().fallar('segundo');
    expect(errores.map(([, msg]) => msg)).toEqual(['primero', 'segundo']);
    expect(m.hasFailed('/demo/a.mp4')).toBe(true);
  });

  it('retryAllFailed reintenta solo los fallados', () => {
    const { m } = crear();
    m.acquire('/demo/a.mp4');
    ultimo().fallar();
    m.acquire('/demo/b.mp4'); // sano
    m.acquire('/demo/c.mp4');
    ultimo().fallar();

    expect(m.retryAllFailed()).toBe(2);
    expect(m.failedSources()).toEqual([]);
    expect(FakeVideo.creados).toHaveLength(5); // 3 originales + 2 reintentos
  });

  it('recargar el show (syncActiveSources) libera una fuente activa pero fallada', () => {
    // El bug de REVIEW-003: la fuente seguia activa, asi que no se liberaba, y
    // acquire() devolvia null para siempre.
    const { m } = crear();
    m.acquire('/demo/a.mp4');
    ultimo().fallar();

    m.syncActiveSources(new Set(['/demo/a.mp4']));
    expect(m.hasFailed('/demo/a.mp4')).toBe(false);
    expect(m.acquire('/demo/a.mp4')).not.toBeNull();
    expect(FakeVideo.creados).toHaveLength(2);
  });

  it('syncActiveSources conserva las fuentes activas sanas y libera las viejas', () => {
    const { m } = crear();
    m.acquire('/demo/show1.mp4');
    const del1 = ultimo();
    m.acquire('/demo/show2.mp4');

    m.syncActiveSources(new Set(['/demo/show2.mp4']));
    expect(del1.src).toBe('');
    expect(FakeVideo.creados).toHaveLength(2);
    m.acquire('/demo/show2.mp4');
    expect(FakeVideo.creados).toHaveLength(2); // no se recreo
  });

  it('dispose libera todo y despues no entrega nada', () => {
    const { m } = crear();
    m.acquire('/demo/a.mp4');
    const v = ultimo();
    m.dispose();
    expect(v.src).toBe('');
    expect(m.acquire('/demo/a.mp4')).toBeNull();
  });
});

describe('frame-lock: un decoder por fuente', () => {
  it('dos pantallas de un mediaGroup comparten el MISMO <video>', () => {
    const { m } = crear();
    const a = m.acquire('/demo/master.mp4', { x: 0, y: 0, w: 1152 / 2592, h: 1 });
    const b = m.acquire('/demo/master.mp4', { x: 1152 / 2592, y: 0, w: 1440 / 2592, h: 1 });

    expect(FakeVideo.creados).toHaveLength(1);
    expect(a).not.toBe(b); // vistas distintas
    expect(a!.image).toBe(b!.image); // mismo elemento de video
    expect(a!.offset.x).toBe(0);
    expect(b!.offset.x).toBeCloseTo(1152 / 2592, 12);
    expect(b!.repeat.x).toBeCloseTo(1440 / 2592, 12);
  });

  it('pedir el mismo recorte dos veces devuelve la misma vista', () => {
    const { m } = crear();
    const uv = { x: 0, y: 0, w: 0.5, h: 1 };
    expect(m.acquire('/demo/m.mp4', uv)).toBe(m.acquire('/demo/m.mp4', uv));
  });

  it('si falla el master, fallan todas las pantallas del grupo juntas', () => {
    const { m } = crear();
    m.acquire('/demo/master.mp4', { x: 0, y: 0, w: 0.5, h: 1 });
    ultimo().fallar();
    expect(m.acquire('/demo/master.mp4', { x: 0.5, y: 0, w: 0.5, h: 1 })).toBeNull();
  });
});

describe('actuador: obedece a output, no a cue', () => {
  it('PAUSE -> HOLD: con output=hold no se llama a play() nunca', () => {
    const { m } = crear();
    m.acquire('/demo/a.mp4');
    const v = ultimo();
    for (let i = 0; i < 60; i++) {
      // cue sigue en playing (el show esta pausado, no detenido)
      m.sync(pantalla({ cue: 'playing', output: 'hold', mediaTimeMs: 9000 }), i * 16);
    }
    expect(v.playCalls).toBe(0);
    expect(v.paused).toBe(true);
    expect(v.currentTime).toBe(9);
  });

  it('HOLD no produce un bucle de correcciones', () => {
    const { m } = crear();
    m.acquire('/demo/a.mp4');
    const v = ultimo();
    for (let i = 0; i < 60; i++) {
      m.sync(pantalla({ output: 'hold', mediaTimeMs: 9000 }), i * 16);
    }
    // Una sola escritura a currentTime, no 60.
    expect(v.seeks).toEqual([9]);
  });

  it('STOP -> BLACK y SAFE MODE -> BLACK: el video queda pausado', () => {
    const { m } = crear();
    m.acquire('/demo/a.mp4');
    const v = ultimo();
    m.sync(pantalla({ output: 'live', mediaTimeMs: 1000 }), 0);
    expect(v.paused).toBe(false);
    m.sync(pantalla({ cue: 'playing', output: 'black', mediaTimeMs: 0 }), 16);
    expect(v.paused).toBe(true);
  });

  it('LIVE reproduce y no corrige deriva dentro de la tolerancia', () => {
    const { m } = crear();
    m.acquire('/demo/a.mp4');
    const v = ultimo();
    m.sync(pantalla({ output: 'live', mediaTimeMs: 0 }), 0);
    expect(v.playCalls).toBe(1);
    v.currentTime = 1.05; // el decoder avanza solo
    v.seeks = [];
    m.sync(pantalla({ output: 'live', mediaTimeMs: 1000 }), 1000); // 50 ms de deriva
    expect(v.seeks).toEqual([]);
  });

  it('LIVE corrige un salto grande (seek del operador)', () => {
    const { m } = crear();
    m.acquire('/demo/a.mp4');
    const v = ultimo();
    m.sync(pantalla({ output: 'live', mediaTimeMs: 0 }), 0);
    v.seeks = [];
    m.sync(pantalla({ output: 'live', mediaTimeMs: 20000 }), 16);
    expect(v.seeks).toEqual([20]);
  });

  it('un clip fallado no se toca en sync', () => {
    const { m } = crear();
    m.acquire('/demo/a.mp4');
    const v = ultimo();
    v.fallar();
    m.sync(pantalla({ output: 'live', mediaTimeMs: 5000 }), 0);
    expect(v.playCalls).toBe(0);
  });
});
