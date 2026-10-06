import { createHash } from 'node:crypto';
import canonicalizeImpl from 'canonicalize';

/**
 * Canonicalización — ADR: canonicalization/hash.
 *
 * RFC 8785 (JSON Canonicalization Scheme) con `canonicalize`, la
 * implementación de referencia de uno de los autores del RFC. NADA ad-hoc:
 * el orden de claves, el formato de números y el escape de strings los define
 * el RFC, no este repo.
 *
 * La versión queda persistida junto a cada hash. Si algún día cambia la
 * librería o la regla, los hashes viejos siguen siendo explicables y
 * recalculables con la versión con la que se hicieron.
 */
export const CANONICALIZATION_VERSION = 'jcs-rfc8785/canonicalize@5.1.0' as const;
export const HASH_ALGORITHM = 'sha256' as const;

const canonicalizeFn = canonicalizeImpl as unknown as (input: unknown) => string | undefined;

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

/** Forma canónica RFC 8785. Rechaza lo que JSON no puede representar. */
export function canonicalize(value: unknown): string {
  assertJsonSafe(value, '$');
  const out = canonicalizeFn(value);
  if (typeof out !== 'string') throw new CanonicalizationError('valor no representable en JSON');
  return out;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * JCS acepta números no finitos convirtiéndolos o fallando según la
 * implementación; acá se rechazan de forma explícita, igual que `undefined`
 * dentro de arreglos, funciones y símbolos: un hash no puede depender de algo
 * que JSON no representa.
 */
function assertJsonSafe(v: unknown, path: string): void {
  if (v === null) return;
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(v)) throw new CanonicalizationError(`número no finito en ${path}`);
      return;
    case 'object':
      if (Array.isArray(v)) {
        v.forEach((x, i) => {
          if (x === undefined) throw new CanonicalizationError(`undefined en ${path}[${i}]`);
          assertJsonSafe(x, `${path}[${i}]`);
        });
        return;
      }
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (x === undefined) continue; // como JSON.stringify: la clave se omite
        assertJsonSafe(x, `${path}.${k}`);
      }
      return;
    default:
      throw new CanonicalizationError(`tipo ${typeof v} no representable en ${path}`);
  }
}
