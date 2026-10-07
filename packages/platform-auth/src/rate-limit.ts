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
}
export const DEFAULT_LOGIN_LIMITS: RateLimitConfig = { windowMs: 15 * 60_000, maxPerEmail: 5, maxPerAddress: 50 };

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
  return `?:${ip}`;
}

export class LoginRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly cfg: RateLimitConfig = DEFAULT_LOGIN_LIMITS, private readonly now: () => number = Date.now) {}

  /** null = permitido (y cuenta el intento); número = ms hasta poder reintentar. */
  check(email: string, ip: string): number | null {
    const t = this.now();
    const keys: Array<[string, number]> = [[`e:${email}`, this.cfg.maxPerEmail], [`a:${addressKey(ip)}`, this.cfg.maxPerAddress]];
    let retry = 0;
    for (const [k, max] of keys) {
      const h = this.hits.get(k);
      if (h && h.resetAt > t && h.count >= max) retry = Math.max(retry, h.resetAt - t);
    }
    if (retry > 0) return retry;
    for (const [k] of keys) {
      const h = this.hits.get(k);
      if (!h || h.resetAt <= t) this.hits.set(k, { count: 1, resetAt: t + this.cfg.windowMs });
      else h.count += 1;
    }
    return null;
  }

  /** Login exitoso: el email vuelve a cero (la dirección no, para no premiar spraying). */
  succeeded(email: string): void {
    this.hits.delete(`e:${email}`);
  }
}
