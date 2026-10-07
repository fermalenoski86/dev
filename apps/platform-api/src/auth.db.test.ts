import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { LoginRateLimiter, createUser, issueSession, setUserRoles } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedContract } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_DEV, SESSION_COOKIE_PROD, SessionActorProvider } from './actor';
import { buildApp } from './app';
import { ErrorResponseSchema, MeResponseSchema } from './contracts';

/**
 * C1 — auth por HTTP: Fastify real + PostgreSQL real + SessionActorProvider.
 * Cookies, CSRF, rotación, revocación, rate limit y roles, por la API.
 */
let t: TestDatabase;
let root: string;
let app: FastifyInstance;
let opId: string;
const PW = 'correct horse battery staple';
const logs: string[] = [];
const logStream = new Writable({ write(c, _e, cb) { logs.push(String(c)); cb(); } });

async function nuevaApp(o: { cookieName?: string; secure?: boolean; limiter?: LoginRateLimiter; external?: boolean } = {}) {
  const cookieName = o.cookieName ?? SESSION_COOKIE_DEV;
  const storage = await LocalDiskStorage.open(path.join(root, `store-${Math.random().toString(36).slice(2)}`));
  return buildApp({
    db: t.app, storage, media: mediaRuntimeFromEnv({}), maxUploadBytes: 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName, externalApprovalEnabled: o.external ?? false }),
    auth: { limiter: o.limiter ?? new LoginRateLimiter(), sessionTtlMs: 60 * 60_000, cookieName, secureCookie: o.secure ?? false },
    log: { stream: logStream },
  });
}

beforeAll(async () => {
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-c1-'));
  opId = (await createUser(t.app, { name: 'Op', email: 'op@affinitas.com', password: PW, organization: 'Affinitas', roles: [{ role: 'OPERATOR' }] })).id;
  app = await nuevaApp();
});
afterAll(async () => {
  await app?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const cookieDe = (r: LightMyRequestResponse, name = SESSION_COOKIE_DEV) => r.cookies.find((c) => c.name === name);
const loguear = (a: FastifyInstance = app, email = 'op@affinitas.com', password = PW, extra: Record<string, string> = {}) =>
  a.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json', ...extra }, payload: JSON.stringify({ email, password }) });
async function sesion(a: FastifyInstance = app, email = 'op@affinitas.com') {
  const r = await loguear(a, email);
  expect(r.statusCode).toBe(200);
  const c = cookieDe(r);
  if (!c) throw new Error('sin cookie');
  return { cookie: `${c.name}=${c.value}`, token: c.value, csrf: MeResponseSchema.parse(r.json()).csrfToken as string };
}
const me = (cookie?: string) => app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: cookie ? { cookie } : {} });
const esError = (b: unknown, code: string) => expect(ErrorResponseSchema.parse(b).code).toBe(code);

describe('CRITERIO C1: POST /api/v1/auth/login', () => {
  it('éxito: cookie HttpOnly, SameSite=Lax, Path=/, con vencimiento; el cuerpo trae roles y CSRF pero NO el token', async () => {
    const r = await loguear();
    expect(r.statusCode).toBe(200);
    const c = cookieDe(r);
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(c?.domain).toBeUndefined();
    expect(c?.expires).toBeInstanceOf(Date);
    const body = MeResponseSchema.parse(r.json());
    expect(body).toMatchObject({ user: { id: opId, email: 'op@affinitas.com' }, roles: ['OPERATOR'], externalContractIds: [] });
    expect(body.csrfToken).toBeTruthy();
    expect(r.body).not.toContain(c?.value as string);
  });

  it('producción: cookie `__Host-` con Secure, sin Domain, Path=/', async () => {
    const prod = await nuevaApp({ cookieName: SESSION_COOKIE_PROD, secure: true });
    const r = await loguear(prod);
    const c = cookieDe(r, SESSION_COOKIE_PROD);
    expect(c).toMatchObject({ name: '__Host-trust_session', secure: true, httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(c?.domain).toBeUndefined();
    await prod.close();
  });

  it('credenciales malas: 401 idéntico para usuario inexistente y password incorrecta, sin cookie', async () => {
    const a = await loguear(app, 'nadie@affinitas.com');
    const b = await loguear(app, 'op@affinitas.com', 'otra password larga');
    for (const r of [a, b]) {
      expect(r.statusCode).toBe(401);
      esError(r.json(), 'INVALID_CREDENTIALS');
      expect(cookieDe(r)).toBeUndefined();
    }
    expect({ ...a.json(), requestId: '' }).toEqual({ ...b.json(), requestId: '' });
  });

  it('rate limit: 429 con Retry-After, aunque la password ahora sea la correcta', async () => {
    const lim = await nuevaApp({ limiter: new LoginRateLimiter({ windowMs: 60_000, maxPerEmail: 2, maxPerAddress: 100 }) });
    await loguear(lim, 'op@affinitas.com', 'mala mala mala');
    await loguear(lim, 'op@affinitas.com', 'mala mala mala');
    const r = await loguear(lim);
    expect(r.statusCode).toBe(429);
    esError(r.json(), 'RATE_LIMITED');
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    await lim.close();
  });

  it('login solo acepta JSON (un form cross-site no puede): text/plain y form → 415, campos extra → 400', async () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded']) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': ct }, payload: `email=op@affinitas.com&password=${PW}` });
      expect(r.statusCode, ct).toBe(415);
    }
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email: 'op@affinitas.com', password: PW, admin: true }) });
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain(PW);
  });

  it('rotación: loguearse con una sesión vigente la revoca y emite otra', async () => {
    const vieja = await sesion();
    const r = await loguear(app, 'op@affinitas.com', PW, { cookie: vieja.cookie });
    const nueva = cookieDe(r);
    expect(nueva?.value).not.toBe(vieja.token);
    expect((await me(vieja.cookie)).statusCode).toBe(401);
    expect((await me(`${nueva?.name}=${nueva?.value}`)).statusCode).toBe(200);
  });
});

describe('CRITERIO C1: sesión, CSRF y logout', () => {
  it('/auth/me: con cookie → usuario; sin cookie, cookie inventada o mal formada → 401', async () => {
    const s = await sesion();
    const r = await me(s.cookie);
    expect(r.statusCode).toBe(200);
    expect(MeResponseSchema.parse(r.json()).csrfToken).toBe(s.csrf);
    for (const c of [undefined, `${SESSION_COOKIE_DEV}=${'A'.repeat(43)}`, `${SESSION_COOKIE_DEV}=nope`]) {
      const x = await me(c);
      expect(x.statusCode).toBe(401);
      esError(x.json(), 'UNAUTHENTICATED');
    }
  });

  it('mutación con sesión: sin X-CSRF-Token → 403; con el de OTRA sesión → 403; con el propio pasa al handler', async () => {
    const s = await sesion();
    const otra = await sesion();
    const post = (h: Record<string, string>) => app.inject({ method: 'POST', url: '/api/v1/assets', headers: { cookie: s.cookie, 'content-type': 'application/json', ...h }, payload: '{}' });
    const sin = await post({});
    expect(sin.statusCode).toBe(403);
    esError(sin.json(), 'CSRF_TOKEN_INVALID');
    const ajeno = await post({ 'x-csrf-token': otra.csrf });
    expect(ajeno.statusCode).toBe(403);
    esError(ajeno.json(), 'CSRF_TOKEN_INVALID');
    const token = await post({ 'x-csrf-token': s.token }); // el token de sesión no sirve como CSRF
    expect(token.statusCode).toBe(403);
    const ok = await post({ 'x-csrf-token': s.csrf });
    expect(ok.statusCode).toBe(400); // pasó auth+CSRF+rol; frena la validación del upload
    esError(ok.json(), 'IDEMPOTENCY_KEY_REQUIRED');
  });

  it('logout: exige CSRF; con CSRF revoca la sesión, borra la cookie y la sesión deja de valer', async () => {
    const s = await sesion();
    const sin = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: s.cookie } });
    expect(sin.statusCode).toBe(403);
    expect((await me(s.cookie)).statusCode).toBe(200);
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf } });
    expect(r.statusCode).toBe(204);
    const borrada = cookieDe(r);
    expect(borrada?.value).toBe('');
    expect((await me(s.cookie)).statusCode).toBe(401);
    const row = await t.app.selectFrom('sessions').select('revoked_at').where('user_id', '=', opId).where('revoked_at', 'is not', null).execute();
    expect(row.length).toBeGreaterThan(0);
  });

  it('cambio de roles: las sesiones vivas del usuario mueren (rotación por privilegios)', async () => {
    const u = await createUser(t.app, { name: 'R', email: 'r@affinitas.com', password: PW, organization: 'Affinitas', roles: [{ role: 'OPERATOR' }] });
    const s = await sesion(app, 'r@affinitas.com');
    expect((await me(s.cookie)).statusCode).toBe(200);
    await setUserRoles(t.app, u.id, [{ role: 'ADMIN' }]);
    expect((await me(s.cookie)).statusCode).toBe(401);
    const nueva = await sesion(app, 'r@affinitas.com');
    expect(MeResponseSchema.parse((await me(nueva.cookie)).json()).roles).toEqual(['ADMIN']);
  });

  it('usuario deshabilitado: su sesión deja de valer en el siguiente request', async () => {
    const u = await createUser(t.app, { name: 'D', email: 'd@affinitas.com', password: PW, organization: 'Affinitas', roles: [{ role: 'OPERATOR' }] });
    const s = await sesion(app, 'd@affinitas.com');
    await t.app.updateTable('users').set({ enabled: false }).where('id', '=', u.id).execute();
    expect((await me(s.cookie)).statusCode).toBe(401);
  });
});

describe('CRITERIO C1: roles por ruta y EXTERNAL_APPROVER deshabilitado (§22, §24)', () => {
  it('EXTERNAL_APPROVER con flag apagado: se loguea pero no tiene ningún rol ni contrato; Assets → 403', async () => {
    const c = await seedContract(t.app);
    await t.app.updateTable('contracts').set({ external_approval_enabled: true }).where('id', '=', c.id).execute();
    await createUser(t.app, { name: 'E', email: 'e@cliente.com', password: PW, organization: 'Cliente', roles: [{ role: 'EXTERNAL_APPROVER', contractId: c.id }] });
    const s = await sesion(app, 'e@cliente.com');
    expect(MeResponseSchema.parse((await me(s.cookie)).json())).toMatchObject({ roles: [], externalContractIds: [] });
    const r = await app.inject({ method: 'GET', url: '/api/v1/assets', headers: { cookie: s.cookie } });
    expect(r.statusCode).toBe(403);
    esError(r.json(), 'FORBIDDEN');

    const on = await nuevaApp({ external: true });
    const s2 = await sesion(on, 'e@cliente.com');
    const r2 = await on.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: s2.cookie } });
    expect(MeResponseSchema.parse(r2.json())).toMatchObject({ roles: ['EXTERNAL_APPROVER'], externalContractIds: [c.id] });
    // aunque esté habilitado, no tiene permisos de Assets
    expect((await on.inject({ method: 'GET', url: '/api/v1/assets', headers: { cookie: s2.cookie } })).statusCode).toBe(403);
    await on.close();
  });

  it('una sesión emitida directo en la base (sin rol) no da acceso a Assets', async () => {
    const u = await createUser(t.app, { name: 'N', email: 'n@affinitas.com', password: PW, organization: 'Affinitas', roles: [] });
    const s = await issueSession(t.app, u.id, 60_000);
    const r = await app.inject({ method: 'GET', url: '/api/v1/assets', headers: { cookie: `${SESSION_COOKIE_DEV}=${s.token}` } });
    expect(r.statusCode).toBe(403);
  });
});

describe('CRITERIO C1: nada sensible en logs', () => {
  it('ni password, ni token de sesión, ni CSRF en los logs', async () => {
    const s = await sesion();
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf } });
    const todo = logs.join('\n');
    expect(todo.length).toBeGreaterThan(0);
    for (const x of [PW, s.token, s.csrf]) expect(todo).not.toContain(x);
  });
});
