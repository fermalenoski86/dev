import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoginRateLimiter, createUser } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedContract } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_PROD, SessionActorProvider } from './actor';
import { buildApp } from './app';
import { ErrorResponseSchema, MeResponseSchema } from './contracts';
import { CORS_ALLOWED_HEADERS, CORS_ALLOWED_METHODS, parseCorsOrigins } from './cors';
import { createServer } from './server';

/**
 * E3a · CORS por allowlist exacta (ADR-063). Fastify real + PostgreSQL real +
 * sesión de C1 con la cookie de producción (`__Host-trust_session`).
 * El navegador real (hosts distintos, TLS) es el gate multihost de E3c.
 */
const WEB = 'https://web.trust.test';
const CONTROL = 'https://control.trust.test';
const EVIL = 'https://evil.trust.test';
const PW = 'correct horse battery staple';

let t: TestDatabase;
let root: string;
let app: FastifyInstance;
let sinCors: FastifyInstance;
let contractId: string;

async function nuevaApp(corsOrigins?: string[]) {
  const storage = await LocalDiskStorage.open(path.join(root, `store-${Math.random().toString(36).slice(2)}`));
  return buildApp({
    db: t.app, storage, media: mediaRuntimeFromEnv({}), maxUploadBytes: 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName: SESSION_COOKIE_PROD, externalApprovalEnabled: false }),
    auth: { limiter: new LoginRateLimiter(), sessionTtlMs: 60 * 60_000, cookieName: SESSION_COOKIE_PROD, secureCookie: true },
    corsOrigins, log: false,
  });
}

beforeAll(async () => {
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-e3a-cors-'));
  await createUser(t.app, { name: 'Op', email: 'op@affinitas.com', password: PW, organization: 'Affinitas', roles: [{ role: 'OPERATOR' }] });
  contractId = (await seedContract(t.app)).id;
  app = await nuevaApp([WEB, CONTROL]);
  sinCors = await nuevaApp();
});
afterAll(async () => {
  await app?.close();
  await sinCors?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const preflight = (origin: string, method = 'PUT', headers = 'content-type,x-csrf-token', a = app) =>
  a.inject({ method: 'OPTIONS', url: '/api/v1/campaigns', headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': headers } });

async function login(origin?: string) {
  const r = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    payload: JSON.stringify({ email: 'op@affinitas.com', password: PW }),
  });
  return r;
}
async function sesion(origin = WEB) {
  const r = await login(origin);
  expect(r.statusCode).toBe(200);
  const c = r.cookies.find((x) => x.name === SESSION_COOKIE_PROD);
  if (!c) throw new Error('sin cookie');
  return { cookie: `${c.name}=${c.value}`, csrf: MeResponseSchema.parse(r.json()).csrfToken as string };
}
const sinHeadersCors = (h: Record<string, unknown>) => {
  expect(h['access-control-allow-origin']).toBeUndefined();
  expect(h['access-control-allow-credentials']).toBeUndefined();
  expect(h['access-control-allow-methods']).toBeUndefined();
};

describe('E3a · TRUST_CORS_ORIGINS se valida al arrancar', () => {
  it('lista de orígenes exactos: recorta espacios, ignora vacíos y duplicados', () => {
    expect(parseCorsOrigins(undefined, { production: true })).toEqual([]);
    expect(parseCorsOrigins('  ', { production: true })).toEqual([]);
    expect(parseCorsOrigins(` ${WEB} ,, ${CONTROL}, ${WEB}`, { production: true })).toEqual([WEB, CONTROL]);
    expect(parseCorsOrigins('http://localhost:3002', { production: false })).toEqual(['http://localhost:3002']);
  });

  it('rechaza `*`, `null`, paths, barra final, credenciales, otros esquemas y http en producción', () => {
    for (const malo of ['*', 'null', `${WEB}/`, `${WEB}/app`, `${WEB}?x=1`, 'https://u:p@web.trust.test', 'ftp://web.trust.test', 'web.trust.test', 'HTTPS://WEB.trust.test']) {
      expect(() => parseCorsOrigins(malo, { production: false }), malo).toThrow(/TRUST_CORS_ORIGINS/);
    }
    expect(() => parseCorsOrigins('http://web.trust.test', { production: true })).toThrow(/solo https/);
  });

  it('el server no arranca con una allowlist inválida (antes de abrir la base)', async () => {
    await expect(createServer({ NODE_ENV: 'production', TRUST_CORS_ORIGINS: '*' })).rejects.toThrow(/TRUST_CORS_ORIGINS/);
    await expect(createServer({ NODE_ENV: 'production', TRUST_CORS_ORIGINS: 'http://web.trust.test' })).rejects.toThrow(/solo https/);
  });
});

describe('E3a · preflight', () => {
  it('origen permitido: 204 con el origen exacto (nunca `*`), credenciales, métodos, headers, Max-Age y Vary: Origin', async () => {
    for (const origin of [WEB, CONTROL]) {
      const r = await preflight(origin);
      expect(r.statusCode, origin).toBe(204);
      expect(r.headers['access-control-allow-origin']).toBe(origin);
      expect(r.headers['access-control-allow-credentials']).toBe('true');
      expect(r.headers['access-control-allow-methods']).toBe(CORS_ALLOWED_METHODS);
      expect(r.headers['access-control-allow-headers']).toBe(CORS_ALLOWED_HEADERS);
      expect(String(r.headers['access-control-allow-headers'])).toMatch(/X-CSRF-Token/);
      expect(Number(r.headers['access-control-max-age'])).toBeGreaterThan(0);
      expect(String(r.headers.vary)).toMatch(/Origin/);
      expect(r.body).toBe('');
    }
  });

  it('origen no listado (incluido otro subdominio del mismo site y el mismo host por http): 403 sin headers CORS', async () => {
    for (const origin of [EVIL, 'http://web.trust.test', 'https://web.trust.test:8443', 'null']) {
      const r = await preflight(origin);
      expect(r.statusCode, origin).toBe(403);
      sinHeadersCors(r.headers);
      expect(ErrorResponseSchema.parse(r.json()).code).toBe('ORIGIN_NOT_ALLOWED');
      expect(String(r.headers.vary)).toMatch(/Origin/);
    }
  });

  it('preflight sobre una ruta inexistente con origen permitido también responde (no filtra 404 al navegador)', async () => {
    const r = await app.inject({ method: 'OPTIONS', url: '/api/v1/no-existe', headers: { origin: WEB, 'access-control-request-method': 'GET' } });
    expect(r.statusCode).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe(WEB);
  });

  it('sin allowlist (default): el preflight no habilita nada', async () => {
    const r = await preflight(WEB, 'PUT', 'content-type', sinCors);
    expect(r.statusCode).toBe(404);
    sinHeadersCors(r.headers);
  });
});

describe('E3a · solicitudes reales con credenciales', () => {
  it('login desde un origen permitido: cookie `__Host-` host-only del host de la API + headers CORS con credenciales', async () => {
    const r = await login(WEB);
    expect(r.statusCode).toBe(200);
    const c = r.cookies.find((x) => x.name === SESSION_COOKIE_PROD);
    expect(c).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(c?.domain).toBeUndefined();
    expect(r.headers['access-control-allow-origin']).toBe(WEB);
    expect(r.headers['access-control-allow-credentials']).toBe('true');
    expect(String(r.headers['access-control-expose-headers'])).toMatch(/X-Request-Id/);
    expect(String(r.headers.vary)).toMatch(/Origin/);
  });

  it('la sesión de web sirve desde control (misma cookie del host de la API): /auth/me y crear campaña con CSRF', async () => {
    const s = await sesion(WEB);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { origin: CONTROL, cookie: s.cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.headers['access-control-allow-origin']).toBe(CONTROL);
    const c = await app.inject({
      method: 'POST', url: '/api/v1/campaigns',
      headers: { origin: CONTROL, cookie: s.cookie, 'content-type': 'application/json', 'x-csrf-token': s.csrf },
      payload: JSON.stringify({ contractId, name: 'E3a CORS' }),
    });
    expect(c.statusCode).toBe(201);
    expect(c.headers['access-control-allow-origin']).toBe(CONTROL);
  });

  it('CSRF intacto: origen permitido + cookie válida pero sin X-CSRF-Token → 403 CSRF_TOKEN_INVALID (con headers CORS para que la UI lo lea)', async () => {
    const s = await sesion(WEB);
    const r = await app.inject({
      method: 'POST', url: '/api/v1/campaigns',
      headers: { origin: WEB, cookie: s.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ contractId, name: 'sin csrf' }),
    });
    expect(r.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(r.json()).code).toBe('CSRF_TOKEN_INVALID');
    expect(r.headers['access-control-allow-origin']).toBe(WEB);
  });

  it('defensa en profundidad: mutación con Origin no listado → 403 ORIGIN_NOT_ALLOWED aunque traiga cookie y CSRF válidos; no escribe', async () => {
    const s = await sesion(WEB);
    const antes = await t.app.selectFrom('campaigns').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    for (const origin of [EVIL, 'null']) {
      const r = await app.inject({
        method: 'POST', url: '/api/v1/campaigns',
        headers: { origin, cookie: s.cookie, 'content-type': 'application/json', 'x-csrf-token': s.csrf },
        payload: JSON.stringify({ contractId, name: 'desde evil' }),
      });
      expect(r.statusCode, origin).toBe(403);
      expect(ErrorResponseSchema.parse(r.json()).code).toBe('ORIGIN_NOT_ALLOWED');
      sinHeadersCors(r.headers);
    }
    const login403 = await login(EVIL);
    expect(login403.statusCode).toBe(403);
    expect(login403.cookies).toHaveLength(0);
    const despues = await t.app.selectFrom('campaigns').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    expect(despues.n).toBe(antes.n);
  });

  it('GET desde un origen no listado: responde pero sin headers CORS (el navegador no deja leer)', async () => {
    const s = await sesion(WEB);
    const r = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { origin: EVIL, cookie: s.cookie } });
    expect(r.statusCode).toBe(200);
    sinHeadersCors(r.headers);
    expect(String(r.headers.vary)).toMatch(/Origin/);
  });

  it('sin Origin (CLI, tests, servidor a servidor): igual que antes de E3a, sin headers CORS', async () => {
    const s = await sesion(WEB);
    const r = await app.inject({
      method: 'POST', url: '/api/v1/campaigns',
      headers: { cookie: s.cookie, 'content-type': 'application/json', 'x-csrf-token': s.csrf },
      payload: JSON.stringify({ contractId, name: 'sin origin' }),
    });
    expect(r.statusCode).toBe(201);
    sinHeadersCors(r.headers);
    expect(r.headers.vary).toBeUndefined();
  });

  it('sin allowlist (default): una mutación con Origin sigue el camino previo (sin 403 por origen, sin headers CORS)', async () => {
    const r = await sinCors.inject({
      method: 'POST', url: '/api/v1/auth/login',
      headers: { origin: EVIL, 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'op@affinitas.com', password: PW }),
    });
    expect(r.statusCode).toBe(200);
    sinHeadersCors(r.headers);
  });
});
