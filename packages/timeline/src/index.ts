/**
 * @trust/timeline — transporte puro.
 *
 * Responsabilidad única: saber qué hora del show es.
 * No sabe qué es una pantalla, una luz ni un show package.
 *
 * El reloj es inyectable (`now()`). Eso es lo que permite testear sin timers
 * y lo que mañana deja que TRUST EDGE use un reloj sincronizado por PTP/NTP
 * en vez de performance.now().
 */

/**
 * REVIEW-002 / P1-8. `ended` es un estado propio, no `playing` clampeado.
 *
 * Antes, al llegar al final el tiempo se congelaba pero el status seguia
 * `playing`. El actuador de media veia cue=playing contra un target congelado
 * y corregia el <video> indefinidamente. Un show que termino no esta corriendo.
 */
export type TransportStatus = 'stopped' | 'playing' | 'paused' | 'ended';

export interface TransportSnapshot {
  status: TransportStatus;
  timeMs: number;
  durationMs: number;
}

export interface TransportOptions {
  durationMs: number;
  /** Fuente de tiempo monotónico en ms. Default: performance.now / Date.now. */
  now?: () => number;
  /** Si true, al llegar al final vuelve a 0 en vez de frenar. */
  loop?: boolean;
  /** 1 = tiempo real. Sirve para previsualizar en cámara lenta. */
  rate?: number;
}

const defaultNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export class Transport {
  private readonly now: () => number;
  private readonly loop: boolean;

  private status: TransportStatus = 'stopped';
  private durationMs: number;
  private rate: number;

  /** Tiempo de show congelado en la última pausa/seek. */
  private anchorShowMs = 0;
  /** Valor del reloj externo cuando se fijó el anchor. */
  private anchorWallMs = 0;

  constructor(opts: TransportOptions) {
    if (opts.durationMs <= 0) throw new Error('durationMs debe ser > 0');
    this.durationMs = Math.floor(opts.durationMs);
    this.now = opts.now ?? defaultNow;
    this.loop = opts.loop ?? false;
    this.rate = opts.rate ?? 1;
  }

  getStatus(): TransportStatus {
    this.settle();
    return this.status;
  }

  getDurationMs(): number {
    return this.durationMs;
  }

  setDurationMs(durationMs: number): void {
    if (durationMs <= 0) throw new Error('durationMs debe ser > 0');
    const current = this.getTimeMs();
    this.durationMs = Math.floor(durationMs);
    this.seek(Math.min(current, this.durationMs));
  }

  setRate(rate: number): void {
    if (rate <= 0) throw new Error('rate debe ser > 0');
    // Re-anclar antes de cambiar el rate, si no se distorsiona el pasado.
    const current = this.getTimeMs();
    this.rate = rate;
    this.anchorShowMs = current;
    this.anchorWallMs = this.now();
  }

  /**
   * Tiempo de show actual, en ms enteros.
   * Función pura del reloj externo: llamarla dos veces sin avanzar el reloj
   * devuelve exactamente lo mismo.
   */
  /** Reevalua si el show llego al final. Idempotente; se llama en cada consulta. */
  private settle(): void {
    if (this.status !== 'playing' || this.loop) return;
    const elapsed = (this.now() - this.anchorWallMs) * this.rate;
    if (this.anchorShowMs + elapsed >= this.durationMs) {
      this.anchorShowMs = this.durationMs;
      this.status = 'ended';
    }
  }

  getTimeMs(): number {
    this.settle();
    if (this.status !== 'playing') return this.anchorShowMs;

    const elapsed = (this.now() - this.anchorWallMs) * this.rate;
    const raw = this.anchorShowMs + elapsed;

    if (raw >= this.durationMs) {
      if (this.loop) {
        return Math.floor(raw % this.durationMs);
      }
      return this.durationMs;
    }
    return Math.floor(Math.max(0, raw));
  }

  /** True cuando un show sin loop llegó al final. */
  isFinished(): boolean {
    return this.getStatus() === 'ended';
  }

  play(): void {
    this.settle();
    if (this.status === 'playing') return;
    // Si terminó y le dan play de nuevo, arranca del principio.
    if (this.anchorShowMs >= this.durationMs) this.anchorShowMs = 0;
    this.anchorWallMs = this.now();
    this.status = 'playing';
  }

  pause(): void {
    this.settle();
    if (this.status !== 'playing') return;
    this.anchorShowMs = this.getTimeMs();
    this.status = 'paused';
  }

  stop(): void {
    this.anchorShowMs = 0;
    this.anchorWallMs = this.now();
    this.status = 'stopped';
  }

  /** Seek absoluto. Mantiene el estado de reproducción. */
  seek(timeMs: number): void {
    this.settle();
    const clamped = Math.floor(Math.min(Math.max(0, timeMs), this.durationMs));
    this.anchorShowMs = clamped;
    this.anchorWallMs = this.now();
    // Seekear hacia atras desde el final devuelve el show a estado pausado:
    // ya no termino, pero tampoco corre hasta que le den play.
    if (this.status === 'ended' && clamped < this.durationMs) this.status = 'paused';
  }

  /** Seek relativo. Negativo va para atrás. */
  nudge(deltaMs: number): void {
    this.seek(this.getTimeMs() + deltaMs);
  }

  snapshot(): TransportSnapshot {
    // REVIEW-003: settle() primero. Leer this.status antes de getTimeMs()
    // devolvia `playing` en el instante en que el show acababa de terminar.
    this.settle();
    return { status: this.status, timeMs: this.getTimeMs(), durationMs: this.durationMs };
  }
}

/** Reloj manual para tests y para render frame-a-frame de previsualizaciones. */
export class ManualClock {
  private t: number;
  constructor(start = 0) {
    this.t = start;
  }
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}
