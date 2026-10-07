import { type Algorithm, hash, verify } from '@node-rs/argon2';

// `Algorithm` es un const enum ambiente (no usable con isolatedModules): 2 = Argon2id.
const ARGON2ID = 2 as unknown as Algorithm;

/**
 * Passwords — M3A.1 §21 + auditoría del brief C (decisión 5).
 *
 * Argon2id con parámetros EXPLÍCITOS y al menos el mínimo de OWASP
 * (m=19 MiB, t=2, p=1). Valores mayores solo con el benchmark reproducible
 * (`pnpm --filter @trust/platform-auth bench:argon2`) corrido en la
 * infraestructura real; nunca copiados.
 */
export const ARGON2_PARAMS = Object.freeze({
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
});

export const MIN_PASSWORD_CHARS = 12;
export const MAX_PASSWORD_CHARS = 256; // corta un DoS de hashing con passwords gigantes

export class WeakPasswordError extends Error {
  readonly code = 'WEAK_PASSWORD' as const;
}

export function assertPasswordPolicy(pw: string): void {
  const n = Array.from(pw).length;
  if (n < MIN_PASSWORD_CHARS || n > MAX_PASSWORD_CHARS) {
    throw new WeakPasswordError(`la contraseña tiene que tener entre ${MIN_PASSWORD_CHARS} y ${MAX_PASSWORD_CHARS} caracteres`);
  }
}

export async function hashPassword(pw: string): Promise<string> {
  assertPasswordPolicy(pw);
  return hash(pw, ARGON2_PARAMS);
}

/**
 * Hash señuelo: se verifica contra él cuando el usuario no existe o está
 * deshabilitado, para que el tiempo de respuesta no revele cuál de los dos casos fue.
 */
let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hash('trust-dummy-password-never-valid', ARGON2_PARAMS));

export async function verifyPassword(storedHash: string | null, pw: string): Promise<boolean> {
  if (pw.length === 0 || Array.from(pw).length > MAX_PASSWORD_CHARS) {
    await verify(await dummyHash(), 'x').catch(() => false);
    return false;
  }
  if (!storedHash) {
    await verify(await dummyHash(), pw).catch(() => false);
    return false;
  }
  return verify(storedHash, pw).catch(() => false);
}
