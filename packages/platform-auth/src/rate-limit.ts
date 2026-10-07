import { isIP } from 'node:net';

/**
 * Rate limit de login — §23 + decisiones del brief C.
 *
 * Ventana fija por clave, en memoria del proceso. Se aplica ANTES de verificar
 * la password y antes de escribir audit, así que tampoco deja crecer el audit
 * sin límite. Las claves son el email normalizado y la dirección agrupada:
 * IPv4 /32 e IPv6 /64 (rotar dentro de un /64 no saltea el límite: BL-10,
 * GHSA-grpc-p53c-r64v).
 *
 * Límite conocido: con varias instancias cada una cuenta por su lado. Un store
 * compartido queda con BL-10.
 */
export interface RateLimitConfig {
  windowMs: number;
  maxPerEmail: number;
  maxPerAddress: number;
  /**
   * Tope de claves en memoria (auditoría C1, OWASP API4:2023). Al llegar al tope
   * se descarta la clave MÁS VIEJA (la más cercana a vencer). Política explícita:
   * para resetear el contador de una víctima un atacante tendría que generar
   * `maxKeys` claves nuevas dentro de la ventana, y cada dirección solo puede
   * crear `maxPerAddress` claves de email por ventana.
   */
  maxKeys: number;
}
export const DEFAULT_LOGIN_LIMITS: RateLimitConfig = { windowMs: 15 * 60_000, maxPerEmail: 5, maxPerAddress: 50, maxKeys: 100_000 };

/** Largo máximo de email que entra como clave (RFC 5321: 254 útiles; 320 con margen). */
export const MAX_EMAIL_KEY_CHARS = 320;

/**
 * Clave de dirección. IPv4 /32, IPv6 /64, IPv4-mapeada como IPv4. Lo que no es
 * una IP válida (no debería pasar: Fastify da la del socket) cae en UN solo
 * balde compartido, así nunca genera claves arbitrarias.
 */
export function addressKey(ip: string): string {
  const v = isIP(ip);
  if (v === 4) return `4:${ip}`;
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return `4:${mapped[1]}`;
    const [head, tail = ''] = ip.toLowerCase().split('::');
    const a = head ? head.split(':') : [];
    const b = tail ? tail.split(':') : [];
    const full = ip.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
    return `6:${full.slice(0, 4).map((h) => h.padStart(4, '0')).join(':')}::/64`;
  }
  return '?:invalid';
}

/**
 * Ventana fija por clave. Memoria ACOTADA:
 *   · la ventana es la misma para todas las claves y una clave solo se inserta
 *     cuando no existe, así que el orden de inserción del Map ES el orden de
 *     vencimiento. En cada `check` se barren desde el principio las vencidas y
 *     se corta en la primera vigente: costo amortizado O(1) por clave creada.
 *     Una clave vencida nunca se reutiliza: el barrido la saca antes y su
 *     ventana nueva entra al final;
 *   · tope duro `maxKeys`, descartando la más vieja.
 */
export class LoginRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private evicted = 0;
  private readonly cfg: RateLimitConfig;
  constructor(cfg: Partial<RateLimitConfig> = {}, private readonly now: () => number = Date.now) {
    this.cfg = { ...DEFAULT_LOGIN_LIMITS, ...cfg };
    for (const [k, v] of Object.entries(this.cfg)) {
      if (!Number.isInteger(v) || v <= 0) throw new Error(`rate limit: ${k} tiene que ser un entero positivo`);
    }
  }

  /** null = permitido (y cuenta el intento); número = ms hasta poder reintentar. */
  check(email: string, ip: string): number | null {
    const t = this.now();
    this.sweep(t);
    const keys: Array<[string, number]> = [[`e:${email.slice(0, MAX_EMAIL_KEY_CHARS)}`, this.cfg.maxPerEmail], [`a:${addressKey(ip)}`, this.cfg.maxPerAddress]];
    let retry = 0;
    for (const [k, max] of keys) {
      const h = this.hits.get(k);
      if (h && h.resetAt > t && h.count >= max) retry = Math.max(retry, h.resetAt - t);
    }
    if (retry > 0) return retry;
    for (const [k] of keys) {
      const h = this.hits.get(k);
      if (h) {
        h.count += 1; // vigente: el barrido de arriba ya sacó las vencidas
        continue;
      }
      while (this.hits.size >= this.cfg.maxKeys) {
        const oldest = this.hits.keys().next().value as string;
        this.hits.delete(oldest);
        this.evicted += 1;
      }
      this.hits.set(k, { count: 1, resetAt: t + this.cfg.windowMs });
    }
    return null;
  }

  /** Login exitoso: el email vuelve a cero (la dirección no, para no premiar spraying). */
  succeeded(email: string): void {
    this.hits.delete(`e:${email.slice(0, MAX_EMAIL_KEY_CHARS)}`);
  }

  /** Para métricas y tests: claves vivas y descartadas por el tope. */
  stats(): { keys: number; evicted: number } {
    return { keys: this.hits.size, evicted: this.evicted };
  }

  private sweep(t: number): void {
    for (const [k, h] of this.hits) {
      if (h.resetAt > t) break; // orden de vencimiento: las siguientes también están vigentes
      this.hits.delete(k);
    }
  }
}
