/**
 * Límite de consumo por actor en el upload — BL-10 (aceptada con ajustes del
 * auditor) · Fase E1 · master §39 · OWASP API4:2023 (Unrestricted Resource
 * Consumption).
 *
 * Dos límites, los dos por ACTOR AUTENTICADO (nunca solo por IP):
 *   · concurrencia: uploads (= inspecciones ffprobe/ffmpeg) en curso a la vez;
 *   · tasa: uploads empezados por ventana fija.
 *
 * Se consulta ANTES de leer el cuerpo y antes de reservar la Idempotency-Key:
 * un 429 no deja temporal, ni Asset, ni key reservada. El cupo de concurrencia
 * se devuelve SIEMPRE (finally), también si el upload falla.
 *
 * En memoria del proceso, con memoria acotada (`maxActors`, descartando el
 * actor inactivo más viejo; nunca uno con uploads en curso). Con varias
 * instancias cada una cuenta por su lado: documentado como límite conocido
 * en docs/platform/API.md (un store compartido es trabajo futuro).
 */
export interface UploadLimits {
  maxConcurrent: number;
  maxPerWindow: number;
  windowMs: number;
  maxActors: number;
}
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = { maxConcurrent: 2, maxPerWindow: 30, windowMs: 60_000, maxActors: 10_000 };

export type UploadDecision =
  | { ok: true; release: () => void }
  | { ok: false; reason: 'CONCURRENCY' | 'RATE'; retryAfterMs: number };

interface Estado { active: number; count: number; resetAt: number }

export class UploadLimiter {
  private readonly cfg: UploadLimits;
  private readonly porActor = new Map<string, Estado>();

  constructor(cfg: Partial<UploadLimits> = {}, private readonly now: () => number = Date.now) {
    this.cfg = { ...DEFAULT_UPLOAD_LIMITS, ...cfg };
    for (const [k, v] of Object.entries(this.cfg)) {
      if (!Number.isInteger(v) || v <= 0) throw new Error(`upload limit: ${k} tiene que ser un entero positivo`);
    }
  }

  /** Reserva un cupo. Con `ok: true` hay que llamar a `release()` exactamente una vez. */
  acquire(actorId: string): UploadDecision {
    const t = this.now();
    let e = this.porActor.get(actorId);
    if (e && e.resetAt <= t) {
      e.count = 0;
      e.resetAt = t + this.cfg.windowMs;
    }
    if (e && e.active >= this.cfg.maxConcurrent) {
      // sin un tiempo exacto (depende de que termine otro upload): 1 s es honesto y barato de reintentar
      return { ok: false, reason: 'CONCURRENCY', retryAfterMs: 1_000 };
    }
    if (e && e.count >= this.cfg.maxPerWindow) return { ok: false, reason: 'RATE', retryAfterMs: e.resetAt - t };
    if (!e) {
      this.hacerLugar();
      e = { active: 0, count: 0, resetAt: t + this.cfg.windowMs };
      this.porActor.set(actorId, e);
    }
    e.active += 1;
    e.count += 1;
    let liberado = false;
    const estado = e;
    return {
      ok: true,
      release: () => {
        if (liberado) return;
        liberado = true;
        estado.active -= 1;
      },
    };
  }

  /** Para tests y métricas. */
  stats(actorId: string): { active: number; count: number } {
    const e = this.porActor.get(actorId);
    return { active: e?.active ?? 0, count: e?.count ?? 0 };
  }

  actors(): number {
    return this.porActor.size;
  }

  private hacerLugar(): void {
    if (this.porActor.size < this.cfg.maxActors) return;
    const t = this.now();
    // primero los vencidos e inactivos; si no hay, el inactivo más viejo
    for (const [k, v] of this.porActor) {
      if (v.active === 0 && v.resetAt <= t) {
        this.porActor.delete(k);
        if (this.porActor.size < this.cfg.maxActors) return;
      }
    }
    for (const [k, v] of this.porActor) {
      if (v.active === 0) {
        this.porActor.delete(k);
        return;
      }
    }
    // todos con uploads en curso: no se descarta a nadie (la concurrencia ya acota el total)
  }
}

export function uploadLimitsFromEnv(env: NodeJS.ProcessEnv): Partial<UploadLimits> {
  const leer = (k: string, min: number, max: number): number | undefined => {
    const raw = env[k];
    if (raw === undefined || raw === '') return undefined;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${k} tiene que ser un entero entre ${min} y ${max}`);
    return v;
  };
  const out: Partial<UploadLimits> = {};
  const c = leer('UPLOAD_MAX_CONCURRENT_PER_ACTOR', 1, 32);
  const w = leer('UPLOAD_MAX_PER_MINUTE_PER_ACTOR', 1, 10_000);
  if (c !== undefined) out.maxConcurrent = c;
  if (w !== undefined) out.maxPerWindow = w;
  return out;
}
