import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoginRateLimiter, createUser } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedContract } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FetchLike, PlatformApiError, PlatformClient } from '../../platform-web/src/lib/api';
import { SESSION_COOKIE_DEV, SessionActorProvider } from './actor';
import { buildApp } from './app';

/**
 * E3a · el cliente de `apps/platform-web` contra la API REAL: Fastify
 * escuchando, PostgreSQL, login con contraseña, cookie, CSRF y CORS por
 * allowlist. El `fetch` inyectado hace de navegador: guarda la cookie del host
 * de la API, manda `Origin` y exige los headers CORS que el navegador exigiría
 * para dejar leer la respuesta con credenciales. El navegador real con hosts
 * distintos y TLS es el gate multihost de E3c.
 */
const WEB = 'http://localhost:3002';
const PW = 'correct horse battery staple';

let t: TestDatabase;
let root: string;
let app: FastifyInstance;
let base: string;
let contractId: string;

/** "Navegador" mínimo: jar de la cookie de la API + Origin + chequeo CORS. */
function navegador(origin: string) {
  let cookie: string | null = null;
  const vistas: { method: string; url: string; status: number }[] = [];
  const fetchNav: FetchLike = async (url, init) => {
    expect(init.credentials).toBe('include');
    const headers = new Headers(init.headers);
    headers.set('origin', origin);
    if (cookie) headers.set('cookie', cookie);
    const res = await fetch(url, { ...init, headers });
    const set = res.headers.get('set-cookie');
    if (set?.startsWith(`${SESSION_COOKIE_DEV}=`)) {
      const par = set.split(';')[0] ?? '';
      cookie = /Expires=Thu, 01 Jan 1970/i.test(set) || par.endsWith('=') ? null : par;
    }
    vistas.push({ method: init.method ?? 'GET', url, status: res.status });
    // Lo que haría el navegador: sin estos headers, la respuesta no se puede leer.
    if (res.headers.get('access-control-allow-origin') !== origin || res.headers.get('access-control-allow-credentials') !== 'true') {
      throw new TypeError('Failed to fetch (CORS)');
    }
    return res;
  };
  return { fetch: fetchNav, vistas, cookie: () => cookie };
}

beforeAll(async () => {
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-e3a-web-'));
  await createUser(t.app, { name: 'Operadora', email: 'op@affinitas.com', password: PW, organization: 'Affinitas', roles: [{ role: 'OPERATOR' }] });
  await createUser(t.app, { name: 'Aprobador', email: 'ap@affinitas.com', password: PW, organization: 'Affinitas', roles: [{ role: 'INTERNAL_APPROVER' }] });
  contractId = (await seedContract(t.app)).id;
  const storage = await LocalDiskStorage.open(path.join(root, 'store'));
  app = await buildApp({
    db: t.app, storage, media: mediaRuntimeFromEnv({}), maxUploadBytes: 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName: SESSION_COOKIE_DEV, externalApprovalEnabled: false }),
    auth: { limiter: new LoginRateLimiter(), sessionTtlMs: 60 * 60_000, cookieName: SESSION_COOKIE_DEV, secureCookie: false },
    corsOrigins: [WEB], log: false,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('sin puerto');
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  await app?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe('E3a · platform-web contra la API real (HTTP, PostgreSQL, CORS, CSRF)', () => {
  it('OPERATOR: sin sesión → login → me → contratos → crea campaña (CSRF) → la ve → logout revoca', async () => {
    const nav = navegador(WEB);
    const client = new PlatformClient({ baseUrl: base, fetch: nav.fetch });

    expect(await client.me()).toBeNull();
    await expect(client.login('op@affinitas.com', 'mala mala mala')).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });

    const me = await client.login('op@affinitas.com', PW);
    expect(me.roles).toEqual(['OPERATOR']);
    expect(me.user.name).toBe('Operadora');
    const sesion = nav.cookie();
    expect(sesion).toMatch(new RegExp(`^${SESSION_COOKIE_DEV}=`));
    expect((await client.me())?.user.email).toBe('op@affinitas.com');

    const contratos = await client.listContracts();
    expect(contratos.map((c) => c.id)).toContain(contractId);
    const c = await client.createCampaign({ contractId, name: 'Lanzamiento E3a' });
    expect(c).toMatchObject({ name: 'Lanzamiento E3a', contractId, latestApprovedVersion: null });
    expect((await client.listCampaigns()).map((x) => x.id)).toContain(c.id);
    const fila = await t.app.selectFrom('campaigns').select(['name']).where('id', '=', c.id).executeTakeFirstOrThrow();
    expect(fila.name).toBe('Lanzamiento E3a');

    await client.logout();
    expect(nav.cookie()).toBeNull();
    expect(client.hasCsrfToken).toBe(false);
    // la cookie vieja quedó revocada en el servidor, no solo borrada del jar
    const vieja = await fetch(`${base}/api/v1/auth/me`, { headers: { cookie: sesion ?? '', origin: WEB } });
    expect(vieja.status).toBe(401);
    expect(await client.me()).toBeNull();
  });

  it('INTERNAL_APPROVER: ve las campañas pero crear es 403 del servidor (la UI no reimplementa permisos)', async () => {
    const client = new PlatformClient({ baseUrl: base, fetch: navegador(WEB).fetch });
    await client.login('ap@affinitas.com', PW);
    expect((await client.listCampaigns()).length).toBeGreaterThan(0);
    const e = await client.createCampaign({ contractId, name: 'no debería' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PlatformApiError);
    expect((e as PlatformApiError).status).toBe(403);
    await client.logout();
  });

  it('desde un origen no listado el "navegador" no puede ni loguearse: 403 ORIGIN_NOT_ALLOWED y sin cookie', async () => {
    const nav = navegador('https://evil.trust.test');
    const client = new PlatformClient({ baseUrl: base, fetch: nav.fetch });
    await expect(client.login('op@affinitas.com', PW)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(nav.vistas.at(-1)?.status).toBe(403);
    expect(nav.cookie()).toBeNull();
  });
});
