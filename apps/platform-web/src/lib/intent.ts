import { PlatformApiError, randomKey } from './api';

/**
 * F3(a) UI · "intención" de una mutación (brief `docs/briefs/F3A_UI.md` §5,
 * acordado en #60 ronda 1).
 *
 * Una intención guarda JUNTOS la Idempotency-Key y el payload exacto (lo que
 * se manda: ids y cuerpo, incluido `expectedActiveVersionId`). Ciclo:
 *
 *   start(payload) → en vuelo → resultado
 *     · definitivo (2xx válido, o 4xx con cuerpo de error válido, incluidos
 *       los 409 que terminalizan el pedido) → se descarta la intención;
 *     · incierto (red/corte/timeout, cuerpo ilegible o inesperado aunque el
 *       status sea 2xx, cualquier 5xx incluidos 502/504 de un intermediario)
 *       → se CONSERVA: `retry()` manda la MISMA key y el MISMO payload, nunca
 *       uno reconstruido desde un GET nuevo;
 *   discard() → abandono explícito (recién ahí una operación nueva usa otra key).
 *
 * Sin persistencia: vive lo que vive la página. Una intención por acción y,
 * mientras está en vuelo o incierta, no se puede empezar otra (sin doble envío).
 */
export type IntentOutcome<R> =
  | { kind: 'ok'; value: R }
  | { kind: 'definitive-error'; error: PlatformApiError }
  | { kind: 'uncertain'; error: unknown };

export interface IntentSnapshot<P> {
  key: string;
  payload: P;
  inFlight: boolean;
}

/** ¿El resultado de esta excepción es desconocido (la operación pudo haberse aplicado)? */
export function isUncertain(e: unknown): boolean {
  if (!(e instanceof PlatformApiError)) return true;
  if (e.status === 0) return true; // fetch falló: red, corte, timeout
  if (e.code === 'UNEXPECTED_RESPONSE') return true; // cuerpo ilegible o fuera de contrato, aunque sea 2xx
  if (e.status >= 500) return true; // 5xx: 502/504 pueden llegar después del COMMIT del origen
  return false;
}

/** Copia profunda congelada: lo que se reintenta es exactamente lo que se mandó, aunque el formulario cambie. */
function congelar<P>(payload: P): P {
  const copia = structuredClone(payload);
  const profundo = (x: unknown) => {
    if (x && typeof x === 'object') {
      for (const v of Object.values(x)) profundo(v);
      Object.freeze(x);
    }
  };
  profundo(copia);
  return copia;
}

/** Qué hace la pantalla después de un resultado: incierto → conservar y ofrecer Reintentar; si no → descartar y RELEER el estado. */
export function trasResultado(kind: IntentOutcome<unknown>['kind']): { phase: 'idle' | 'uncertain'; recargar: boolean } {
  if (kind === 'uncertain') return { phase: 'uncertain', recargar: false };
  return { phase: 'idle', recargar: true };
}

export class IntentInProgressError extends Error {
  constructor() {
    super('Ya hay una operación en curso o con resultado incierto: reintentala o descartala.');
  }
}

export class Intent<P, R> {
  private actual: IntentSnapshot<P> | null = null;

  constructor(
    private readonly send: (payload: P, key: string) => Promise<R>,
    private readonly newKey: () => string = randomKey,
  ) {}

  /** La intención viva (en vuelo o incierta), o null. */
  get snapshot(): IntentSnapshot<P> | null {
    return this.actual ? { ...this.actual } : null;
  }

  /** Empieza una operación NUEVA: key nueva y payload congelado. */
  async start(payload: P): Promise<IntentOutcome<R>> {
    if (this.actual) throw new IntentInProgressError();
    this.actual = { key: this.newKey(), payload: congelar(payload), inFlight: false };
    return this.run();
  }

  /** Reintenta la intención incierta con la MISMA key y el MISMO payload. */
  async retry(): Promise<IntentOutcome<R>> {
    if (!this.actual) throw new Error('No hay una operación para reintentar.');
    return this.run();
  }

  /** Abandono explícito de una intención incierta. */
  discard(): void {
    if (this.actual?.inFlight) throw new IntentInProgressError();
    this.actual = null;
  }

  private async run(): Promise<IntentOutcome<R>> {
    const a = this.actual;
    if (!a) throw new Error('sin intención');
    if (a.inFlight) throw new IntentInProgressError();
    a.inFlight = true;
    try {
      const value = await this.send(a.payload, a.key);
      this.actual = null;
      return { kind: 'ok', value };
    } catch (e) {
      if (isUncertain(e)) return { kind: 'uncertain', error: e };
      this.actual = null;
      return { kind: 'definitive-error', error: e as PlatformApiError };
    } finally {
      a.inFlight = false;
    }
  }
}
