import { describe, expect, it } from 'vitest';
import { assertBuildEnv, checkBuildEnv } from './build-env.mjs';

/** BL-30 · un build estricto (para desplegar o para el E2E) exige la API por HTTPS. */
const API = 'https://api.trust.example';

describe('BL-30 · variables públicas del build de platform-web', () => {
  it('https absoluta: OK; el Builder es opcional pero, si está, también https', () => {
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: API })).toEqual([]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: API, NEXT_PUBLIC_TRUST_BUILDER_URL: 'https://control.trust.example' })).toEqual([]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: API, NEXT_PUBLIC_TRUST_BUILDER_URL: 'http://control.trust.example' })).toEqual([expect.stringMatching(/BUILDER_URL tiene que ser https/)]);
  });

  it('ausente, http, relativa, con credenciales o query: errores', () => {
    expect(checkBuildEnv({})).toEqual([expect.stringMatching(/API_URL es obligatoria/)]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: '  ' })).toEqual([expect.stringMatching(/obligatoria/)]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: 'http://api.trust.example' })).toEqual([expect.stringMatching(/tiene que ser https/)]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: '/api' })).toEqual([expect.stringMatching(/no es una URL absoluta/)]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: 'https://u:p@api.trust.example' })).toEqual([expect.stringMatching(/credenciales/)]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: `${API}/?x=1` })).toEqual([expect.stringMatching(/query/)]);
  });

  it('solo un build estricto falla (TRUST_BUILD_STRICT=1); el build del gate verify-build compila sin la variable', () => {
    expect(() => assertBuildEnv({})).not.toThrow();
    expect(() => assertBuildEnv({ TRUST_BUILD_STRICT: '1' })).toThrow(/BL-30/);
    expect(() => assertBuildEnv({ TRUST_BUILD_STRICT: '1', NEXT_PUBLIC_TRUST_API_URL: 'http://api.trust.example' })).toThrow(/https/);
    expect(() => assertBuildEnv({ TRUST_BUILD_STRICT: '1', NEXT_PUBLIC_TRUST_API_URL: API })).not.toThrow();
  });
});
