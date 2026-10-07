import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tokens de sesión y CSRF — decisión 5 del brief C.
 *
 *   · token de sesión: 32 bytes aleatorios (256 bits ≥ 128), base64url; en la base
 *     solo se guarda su sha256.
 *   · token CSRF: HMAC-SHA256(token de sesión, "trust-csrf-v1"). Está atado a la
 *     sesión, no hay que guardarlo en claro, y /auth/me lo puede volver a dar.
 *     En la base se guarda su sha256 (`sessions.csrf_token_hash`).
 */
export const SESSION_TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const newSessionToken = (): string => randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
export const isWellFormedToken = (t: unknown): t is string => typeof t === 'string' && TOKEN_RE.test(t);
export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');
export const csrfTokenFor = (sessionToken: string): string => createHmac('sha256', sessionToken).update('trust-csrf-v1').digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
