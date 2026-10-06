import type { ShowEvent, ShowPackage } from '@trust/shared-types';
import { sortEvents } from './resolve';
import { discontinuityPoints } from './preflight';

/**
 * REVIEW-003 / P1-7.
 *
 * `resolveStateAt()` ordena el timeline en cada llamada. A 60 fps con tres
 * pantallas eso son cientos de sorts por segundo sobre un array que no cambia.
 * Con los demos actuales es irrelevante; con shows largos y automatizaciones
 * deja de serlo, y en EDGE el motor corre contra hardware sin margen para
 * trabajo inutil.
 *
 * El pipeline queda:
 *
 *   parse (Zod) -> preflight (semantica) -> compile (una vez) -> resolve (por frame)
 *
 * Deliberadamente NO hay arboles de intervalos ni indices por keyframe. La
 * unica optimizacion es no repetir lo que ya se hizo una vez. El fold completo
 * se conserva porque es lo que hace el seek correcto por construccion, y esa
 * propiedad vale mucho mas que los microsegundos que costaria mantener estado
 * incremental consistente.
 */
export interface CompiledShow {
  readonly show: ShowPackage;
  /** Timeline ya ordenado por (atMs, indice de declaracion). */
  readonly events: readonly ShowEvent[];
  /** Instantes donde el estado puede cambiar. Para scrub, marcas y auditoria. */
  readonly discontinuities: readonly number[];
  /** Ultimo ms en que ocurre algo. Sirve para saber si un show tiene cola muerta. */
  readonly lastEventMs: number;
  /** Marca de compilacion, para invalidar caches aguas arriba. */
  readonly compiledAt: number;
}

export function compileShow(show: ShowPackage): CompiledShow {
  const events = Object.freeze(sortEvents(show.timeline));
  return Object.freeze({
    show,
    events,
    discontinuities: Object.freeze(discontinuityPoints(show)),
    lastEventMs: events.length > 0 ? (events[events.length - 1]?.atMs ?? 0) : 0,
    compiledAt: Date.now(),
  });
}

/** True si el show declara mas duracion de la que realmente usa. */
export function hasDeadTail(compiled: CompiledShow, toleranceMs = 1000): boolean {
  return compiled.show.durationMs - compiled.lastEventMs > toleranceMs;
}
