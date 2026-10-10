import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants.js';
import { afterEach, describe, expect, it } from 'vitest';
import config from '../next.config.mjs';
import { PHASE_PRODUCTION_BUILD as FASE_LOCAL, assertBuildEnv, checkBuildEnv } from './build-env.mjs';

/**
 * BL-30 · TODO `next build` exige la API por HTTPS (auditoría E3c [P1]: sin
 * banderas opt-in). `next dev` y `next start` no validan.
 */
const API = 'https://api.trust.example';
const BUILD = PHASE_PRODUCTION_BUILD;

describe('BL-30 · variables públicas del build de platform-web', () => {
  it('https absoluta: OK; el Builder es opcional pero, si está, también https', () => {
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: API })).toEqual([]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: API, NEXT_PUBLIC_TRUST_BUILDER_URL: 'https://control.trust.example' })).toEqual([]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: API, NEXT_PUBLIC_TRUST_BUILDER_URL: 'http://control.trust.example' })).toEqual([expect.stringMatching(/BUILDER_URL tiene que ser https/)]);
  });

  it('ausente, http, relativa, con credenciales o query: errores', () => {
    expect(checkBuildEnv({})).toEqual([expect.stringMatching(/API_URL es obligatoria en `next build`/)]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: '  ' })).toEqual([expect.stringMatching(/obligatoria/)]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: 'http://api.trust.example' })).toEqual([expect.stringMatching(/tiene que ser https/)]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: '/api' })).toEqual([expect.stringMatching(/no es una URL absoluta/)]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: 'https://u:p@api.trust.example' })).toEqual([expect.stringMatching(/credenciales/)]);
    expect(checkBuildEnv({ NEXT_PUBLIC_TRUST_API_URL: `${API}/?x=1` })).toEqual([expect.stringMatching(/query/)]);
  });

  it('la fase de build de producción SIEMPRE valida (sin bandera); dev y start no', () => {
    expect(FASE_LOCAL).toBe(PHASE_PRODUCTION_BUILD);
    expect(() => assertBuildEnv(BUILD, {})).toThrow(/BL-30/);
    expect(() => assertBuildEnv(BUILD, { NODE_ENV: 'production' })).toThrow(/BL-30/);
    expect(() => assertBuildEnv(BUILD, { TRUST_BUILD_STRICT: '0', NEXT_PUBLIC_TRUST_API_URL: 'http://api.trust.example' })).toThrow(/https/);
    expect(() => assertBuildEnv(BUILD, { NEXT_PUBLIC_TRUST_API_URL: API })).not.toThrow();
    expect(() => assertBuildEnv(PHASE_DEVELOPMENT_SERVER, {})).not.toThrow();
    expect(() => assertBuildEnv(PHASE_PRODUCTION_SERVER, {})).not.toThrow();
  });

  describe('next.config.mjs real (el mismo módulo que carga `next build`)', () => {
    const antes = { api: process.env.NEXT_PUBLIC_TRUST_API_URL, builder: process.env.NEXT_PUBLIC_TRUST_BUILDER_URL };
    afterEach(() => {
      for (const [k, v] of [['NEXT_PUBLIC_TRUST_API_URL', antes.api], ['NEXT_PUBLIC_TRUST_BUILDER_URL', antes.builder]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    it('build sin URL o con http → lanza; con https → devuelve la config; dev/start sin URL → no lanza', () => {
      delete process.env.NEXT_PUBLIC_TRUST_API_URL;
      delete process.env.NEXT_PUBLIC_TRUST_BUILDER_URL;
      expect(() => config(BUILD)).toThrow(/NEXT_PUBLIC_TRUST_API_URL es obligatoria/);
      expect(config(PHASE_DEVELOPMENT_SERVER)).toMatchObject({ reactStrictMode: true });
      expect(config(PHASE_PRODUCTION_SERVER)).toMatchObject({ poweredByHeader: false });
      process.env.NEXT_PUBLIC_TRUST_API_URL = 'http://api.trust.example';
      expect(() => config(BUILD)).toThrow(/tiene que ser https/);
      process.env.NEXT_PUBLIC_TRUST_API_URL = API;
      expect(config(BUILD)).toMatchObject({ reactStrictMode: true, poweredByHeader: false });
    });
  });
});
