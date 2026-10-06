import type { ShowPackage, ShowRuntimeState } from '@trust/shared-types';
import type { BuilderValidation } from './validation';

/**
 * PREVIEW SESSION — M2C.1.1.
 *
 * Dueña del ciclo de vida del ShowEngine del Builder. Existe por dos bugs que
 * tenían la misma raíz: el estado del motor y el estado del editor podían
 * divergir sin que nada lo notara.
 *
 * ── Bug 1: engine stale ──────────────────────────────────────────
 *
 * `play()` recargaba el paquete, pero `restart()` y `scrub()` operaban sobre el
 * motor que hubiera quedado. Editabas una duración o una escena y RESTART
 * reproducía el show anterior. En una demo delante de un cliente eso es
 * exactamente el momento en que el editor pierde credibilidad.
 *
 * ── Bug 2: BLOCKED solo en la UI ─────────────────────────────────
 *
 * El bloqueo vivía en `disabled={blocked}` de React. Cualquier camino que no
 * pasara por ese botón —un atajo de teclado, el scrubber, entrar a PRESENT—
 * arrancaba igual.
 *
 * La solución a los dos es la misma: **una sola guarda, del lado del estado**.
 */

/** Mínimo del ShowEngine que la sesión necesita. Permite testear sin React. */
export interface PreviewEngine {
  loadShow(show: ShowPackage): void;
  play(): void;
  pause(): void;
  stop(): void;
  seek(ms: number): void;
  getState(): ShowRuntimeState;
  getStatus(): 'stopped' | 'playing' | 'paused' | 'ended';
  getTimeMs(): number;
  getDurationMs(): number;
  isSafeMode(): boolean;
}

/**
 * Identidad del paquete compilado.
 *
 * Se deriva del CONTENIDO, no de un contador que alguien tiene que acordarse
 * de incrementar. Dos consecuencias buenas:
 *
 *  - Cualquier cambio del draft que afecte al ShowPackage cambia la revisión,
 *    sin enumerar qué campos importan.
 *  - Un cambio que NO afecta al paquete (renombrar un moment, una nota) deja
 *    la revisión igual y no interrumpe la reproducción en curso.
 *
 * Hash FNV-1a de 32 bits sobre el JSON: suficiente para detectar cambios de
 * edición, y determinista, que es lo que los tests necesitan.
 */
export function showPackageRevision(pkg: ShowPackage | null): string {
  if (!pkg) return 'none';
  const json = JSON.stringify(pkg);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `r${h.toString(16).padStart(8, '0')}`;
}

/**
 * ÚNICA guarda de preview. La usan el store y la UI; no hay una segunda copia
 * del criterio en un `disabled`.
 */
export function canPreview(validation: BuilderValidation | null): boolean {
  if (!validation) return false;
  if (validation.status === 'BLOCKED') return false;
  if (!validation.exportable) return false;
  // Un paquete nulo no es reproducible aunque nada esté marcado como bloqueo.
  return validation.compile.showPackage !== null;
}

export type PreviewRefusal = 'NO_VALIDATION' | 'BLOCKED' | 'NOT_EXPORTABLE' | 'NO_PACKAGE';

/** Por qué se negó, para poder decírselo al operador en vez de no hacer nada. */
export function previewRefusal(validation: BuilderValidation | null): PreviewRefusal | null {
  if (!validation) return 'NO_VALIDATION';
  if (validation.status === 'BLOCKED') return 'BLOCKED';
  if (!validation.exportable) return 'NOT_EXPORTABLE';
  if (validation.compile.showPackage === null) return 'NO_PACKAGE';
  return null;
}

export interface PreviewSnapshot {
  state: ShowRuntimeState | null;
  transport: 'stopped' | 'playing' | 'paused' | 'ended';
  timeMs: number;
  durationMs: number;
  /** Revisión que el motor tiene cargada. `none` si no hay motor. */
  engineRevision: string;
  /** Revisión del compilado actual. */
  compiledRevision: string;
  /** false cuando el motor quedó viejo respecto del draft. */
  current: boolean;
}

const IDLE: PreviewSnapshot = {
  state: null,
  transport: 'stopped',
  timeMs: 0,
  durationMs: 0,
  engineRevision: 'none',
  compiledRevision: 'none',
  current: true,
};

export interface PreviewSessionOptions {
  /** Fábrica del motor. En producción, `new ShowEngine(...)`. */
  createEngine: (show: ShowPackage) => PreviewEngine;
}

/**
 * Sesión de preview.
 *
 * Toda operación recibe la validación actual y decide dos cosas, en este orden:
 *
 *   1. ¿Está permitido previsualizar? (`canPreview`)
 *   2. ¿El motor tiene cargado el compilado de AHORA? Si no, lo recarga.
 *
 * No hay forma de reproducir un paquete viejo, porque no hay ningún camino que
 * saltee el paso 2.
 */
export class PreviewSession {
  private engine: PreviewEngine | null = null;
  private engineRevision = 'none';
  private readonly createEngine: (show: ShowPackage) => PreviewEngine;

  constructor(options: PreviewSessionOptions) {
    this.createEngine = options.createEngine;
  }

  getEngine(): PreviewEngine | null {
    return this.engine;
  }

  getEngineRevision(): string {
    return this.engineRevision;
  }

  /** True si el motor cargado corresponde al compilado que se le pasa. */
  isCurrent(validation: BuilderValidation | null): boolean {
    return this.engineRevision === showPackageRevision(validation?.compile.showPackage ?? null);
  }

  /**
   * Asegura que el motor tenga el compilado actual. Devuelve null si no se
   * puede previsualizar; en ese caso además SUELTA el motor anterior, para que
   * un draft que pasó a BLOCKED no deje un show viejo reproduciéndose.
   */
  private ensure(validation: BuilderValidation | null): PreviewEngine | null {
    if (!canPreview(validation)) {
      this.release();
      return null;
    }
    const pkg = validation?.compile.showPackage;
    // `canPreview` ya garantizo que existe; el chequeo mantiene el tipo sin
    // aserciones, que es lo que el lint pide y ademas es mas honesto.
    if (!pkg) {
      this.release();
      return null;
    }
    const revision = showPackageRevision(pkg);

    if (!this.engine) {
      this.engine = this.createEngine(pkg);
      this.engineRevision = revision;
      return this.engine;
    }
    if (this.engineRevision !== revision) {
      // El draft cambió: el motor se recarga ANTES de cualquier comando.
      this.engine.loadShow(pkg);
      this.engineRevision = revision;
    }
    return this.engine;
  }

  play(validation: BuilderValidation | null): PreviewSnapshot {
    const engine = this.ensure(validation);
    if (!engine) return this.snapshot(validation);
    engine.play();
    return this.snapshot(validation);
  }

  pause(validation: BuilderValidation | null): PreviewSnapshot {
    // Pausar no necesita recargar: pausa lo que esté sonando.
    this.engine?.pause();
    return this.snapshot(validation);
  }

  /**
   * STOP nunca se bloquea — M2C.1.2 / punto 5.
   *
   * Detener es la operacion de seguridad: si el draft paso a BLOCKED mientras
   * algo se reproducia, deshabilitar STOP dejaria al operador mirando un
   * preview corriendo sin forma de pararlo. Que un show no se pueda ARRANCAR
   * no implica que no se pueda PARAR.
   *
   * Idempotente: sin motor no hace nada y no falla.
   */
  stop(validation: BuilderValidation | null): PreviewSnapshot {
    this.engine?.stop();
    return this.snapshot(validation);
  }

  /**
   * Aplica el estado de validacion sin ejecutar ningun comando.
   *
   * M2C.1.2 / punto 5: `ensure` solo corria en play/restart/scrub, asi que un
   * draft que pasaba a BLOCKED MIENTRAS reproducia seguia sonando hasta el
   * proximo comando. La revalidacion ahora suelta el motor apenas deja de
   * poder previsualizarse.
   */
  enforce(validation: BuilderValidation | null): PreviewSnapshot {
    if (!canPreview(validation)) this.release();
    return this.snapshot(validation);
  }

  /** Reinicia el SHOW ACTUAL. Si el draft cambió, recarga antes de arrancar. */
  restart(validation: BuilderValidation | null): PreviewSnapshot {
    const engine = this.ensure(validation);
    if (!engine) return this.snapshot(validation);
    engine.stop();
    engine.play();
    return this.snapshot(validation);
  }

  /**
   * Busca dentro del SHOW ACTUAL. Recarga si hace falta y deja el motor en
   * PAUSA, no detenido.
   *
   * La diferencia no es cosmética: `STOP` es BLACK y `PAUSE` es HOLD
   * (ADR-009). Un motor recién cargado está `stopped`, y `pause()` sobre algo
   * detenido no hace nada — así que scrubear mostraría las tres pantallas en
   * negro en vez del frame de ese instante. Por eso se arranca antes de
   * pausar.
   */
  scrub(validation: BuilderValidation | null, ms: number): PreviewSnapshot {
    const engine = this.ensure(validation);
    if (!engine) return this.snapshot(validation);
    if (engine.getStatus() !== 'playing') engine.play();
    engine.seek(ms);
    engine.pause();
    return this.snapshot(validation);
  }

  /** Suelta el motor. Sin motor no hay nada viejo que pueda reproducirse. */
  release(): void {
    this.engine?.stop();
    this.engine = null;
    this.engineRevision = 'none';
  }

  snapshot(validation: BuilderValidation | null): PreviewSnapshot {
    const compiledRevision = showPackageRevision(validation?.compile.showPackage ?? null);
    if (!this.engine) {
      return { ...IDLE, compiledRevision, current: this.engineRevision === compiledRevision };
    }
    return {
      state: this.engine.getState(),
      transport: this.engine.getStatus(),
      timeMs: this.engine.getTimeMs(),
      durationMs: this.engine.getDurationMs(),
      engineRevision: this.engineRevision,
      compiledRevision,
      current: this.engineRevision === compiledRevision,
    };
  }
}
