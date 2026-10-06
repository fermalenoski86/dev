import { Transport, type TransportStatus } from '@trust/timeline';
import type { ShowPackage, ShowRuntimeState } from '@trust/shared-types';
import { resolveStateAt, type ResolveContext } from './resolve';
import { compileShow, type CompiledShow } from './compile';

export interface ShowEngineOptions {
  show: ShowPackage;
  context: ResolveContext;
  now?: () => number;
  loop?: boolean;
  /** Hora de pared para la aguja del reloj. Sin esto, la aguja sigue el show. */
  wallClockMs?: () => number;
}

/**
 * ShowEngine — la única fuente de verdad del comportamiento de un show.
 *
 * PREVIS lo consume para pintar el twin. CONTROL/EDGE lo consumirán para
 * emitir a hardware real. Por eso no importa nada de React ni de Three.js acá.
 */
export class ShowEngine {
  private readonly transport: Transport;
  private context: ResolveContext;
  private show: ShowPackage;
  private compiled: CompiledShow;
  private safe = false;
  private readonly wallClockMs: (() => number) | undefined;

  constructor(opts: ShowEngineOptions) {
    this.show = opts.show;
    this.compiled = compileShow(opts.show);
    this.context = opts.context;
    this.wallClockMs = opts.wallClockMs;
    this.transport = new Transport({
      durationMs: opts.show.durationMs,
      now: opts.now,
      loop: opts.loop ?? false,
    });
  }

  getShow(): ShowPackage {
    return this.show;
  }

  /** Cargar otro show resetea el transporte: no se hereda tiempo entre shows. */
  loadShow(show: ShowPackage): void {
    this.show = show;
    this.compiled = compileShow(show);
    this.safe = false;
    this.transport.stop();
    this.transport.setDurationMs(show.durationMs);
  }

  play(): void {
    if (this.safe) return; // SAFE MODE gana siempre sobre la programación.
    this.transport.play();
  }
  pause(): void {
    this.transport.pause();
  }
  stop(): void {
    this.transport.stop();
  }
  seek(ms: number): void {
    this.transport.seek(ms);
  }
  nudge(ms: number): void {
    this.transport.nudge(ms);
  }

  getStatus(): TransportStatus {
    return this.transport.getStatus();
  }
  getTimeMs(): number {
    return this.transport.getTimeMs();
  }
  getDurationMs(): number {
    return this.transport.getDurationMs();
  }
  isFinished(): boolean {
    return this.transport.isFinished();
  }

  /**
   * SAFE MODE: detiene el show y fuerza estado seguro.
   * Solo por causa LOCAL (fallo, contenido invalido, seguridad, watchdog,
   * operador). Perder la nube es DEGRADED_OFFLINE, no esto. Ver
   * docs/architecture/OPERATING_STATES.md.
   */
  enterSafeMode(): void {
    this.safe = true;
    this.transport.pause();
  }
  exitSafeMode(): void {
    this.safe = false;
  }
  isSafeMode(): boolean {
    return this.safe;
  }

  /**
   * Estado del edificio ahora mismo.
   *
   * REVIEW-002: el estado del transporte entra como argumento del resolve, asi
   * que `pause` global produce output=hold en las pantallas y SAFE MODE produce
   * output=black. No hay parcheo posterior del estado resuelto.
   */
  getState(): ShowRuntimeState {
    return resolveStateAt(this.show, this.context, this.transport.getTimeMs(), {
      transport: this.transport.getStatus(),
      safeMode: this.safe,
      wallClockMs: this.wallClockMs?.(),
      events: this.compiled.events,
    });
  }

  /** Datos precompilados del show: eventos ordenados y discontinuidades. */
  getCompiled(): CompiledShow {
    return this.compiled;
  }

  /** Estado en un instante arbitrario, sin mover el transporte (scrub/preview). */
  getStateAt(timeMs: number, opts: { transport?: TransportStatus } = {}): ShowRuntimeState {
    return resolveStateAt(this.show, this.context, timeMs, {
      transport: opts.transport ?? 'playing',
      safeMode: this.safe,
      wallClockMs: this.wallClockMs?.(),
      events: this.compiled.events,
    });
  }
}
