import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ShowPackageSchema } from '@trust/shared-types';
import { describe, expect, it } from 'vitest';
import { CANONICALIZATION_VERSION, HASH_ENVELOPE_VERSION, SHOW_AUTHORING_VERSION, SHOW_PACKAGE_SCHEMA_VERSION } from './index';

describe('CRITERIO: constantes de versión atadas a su fuente', () => {
  it('SHOW_AUTHORING_VERSION coincide con el package.json del compiler', () => {
    // Se lee en el TEST, no en runtime: si alguien sube la versión del
    // compiler sin actualizar la constante, esto falla.
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../show-authoring/package.json'), 'utf-8'));
    expect(SHOW_AUTHORING_VERSION).toBe(pkg.version);
  });

  it('SHOW_PACKAGE_SCHEMA_VERSION es la versión que acepta ShowPackageSchema', () => {
    const base = { id: 's', name: 'S', durationMs: 1000, initialState: { lightingScene: 'x' } };
    expect(ShowPackageSchema.safeParse({ ...base, version: SHOW_PACKAGE_SCHEMA_VERSION }).success).toBe(true);
    expect(ShowPackageSchema.safeParse({ ...base, version: SHOW_PACKAGE_SCHEMA_VERSION + 1 }).success).toBe(false);
  });

  it('versiones del hash fijas y explícitas', () => {
    expect(HASH_ENVELOPE_VERSION).toBe(1);
    expect(CANONICALIZATION_VERSION).toBe('jcs-rfc8785/canonicalize@5.1.0');
  });
});
