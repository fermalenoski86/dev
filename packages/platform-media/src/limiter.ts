import { MediaAbortError } from './types';

/**
 * Limitador de concurrencia — M3A.1 B2, punto 22.
 * Acota cuántos procesos ffprobe/ffmpeg viven a la vez (MEDIA_INSPECTION_CONCURRENCY):
 * 100 uploads no lanzan 200 procesos. Los pedidos esperan en cola FIFO; un
 * pedido cancelado mientras espera sale de la cola sin llegar a lanzar nada.
 */
export class ConcurrencyLimiter {
  private activos = 0;
  private readonly cola: Array<{ resolve: () => void; reject: (e: unknown) => void; signal?: AbortSignal; onAbort?: () => void }> = [];

  constructor(readonly max: number) {
    if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('la concurrencia tiene que ser un entero >= 1');
  }

  get active(): number {
    return this.activos;
  }
  get queued(): number {
    return this.cola.length;
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new MediaAbortError());
    if (this.activos < this.max) {
      this.activos += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const item: (typeof this.cola)[number] = { resolve, reject, signal };
      if (signal) {
        item.onAbort = () => {
          const i = this.cola.indexOf(item);
          if (i >= 0) this.cola.splice(i, 1);
          reject(new MediaAbortError());
        };
        signal.addEventListener('abort', item.onAbort, { once: true });
      }
      this.cola.push(item);
    });
  }

  private release(): void {
    const siguiente = this.cola.shift();
    if (!siguiente) {
      this.activos -= 1;
      return;
    }
    if (siguiente.signal && siguiente.onAbort) siguiente.signal.removeEventListener('abort', siguiente.onAbort);
    siguiente.resolve(); // el slot pasa directo: activos no cambia
  }
}
