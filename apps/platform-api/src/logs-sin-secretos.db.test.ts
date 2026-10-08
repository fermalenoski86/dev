import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { LoginRateLimiter, createUser } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedContract, seedStoredObject } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { mediaFixtures } from '@trust/platform-media/fixtures';
import { LocalDiskStorage } from '@trust/platform-storage';
import { PRESET_TAKEOVER_15S, type TakeoverDraft } from '@trust/show-authoring';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_DEV, SessionActorProvider } from './actor';
import { buildApp } from './app';
import { MeResponseSchema, ShowVersionResponseSchema } from './contracts';

/**
 * E1 · master §34 — ningún log contiene passwords, tokens de sesión, cookies
 * ni CSRF. Recorre login → upload → submit → evidencia → approve con
 * Fastify real, PostgreSQL real, sesiones reales y el logger de producción
 * (JSON + redacción), capturando TODA la salida. También pide con secretos
 * inválidos (cookie y CSRF falsos, password incorrecta): esos tampoco pueden
 * aparecer.
 */
let t: TestDatabase;
let root: string;
let app: FastifyInstance;
let contrato: string;
const salida: string[] = [];
const logStream = new Writable({ write(c, _e, cb) { salida.push(String(c)); cb(); } });
const PW_OP = 'op password con espacios 7Q!';
const PW_APR = 'apr password larga 9Z?';
const media = { ...mediaRuntimeFromEnv({ MEDIA_INSPECTION_CONCURRENCY: '2' }) };
type Sesion = { cookie: string; token: string; csrf: string; id: string };

beforeAll(async () => {
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-e1-logs-'));
  media.scratchDir = path.join(root, 'scratch');
  const storage = await LocalDiskStorage.open(path.join(root, 'store'));
  contrato = (await seedContract(t.app)).id;
  await createUser(t.app, { name: 'Op', email: 'op-logs@affinitas.com', password: PW_OP, organization: 'Affinitas', roles: [{ role: 'OPERATOR' }] });
  await createUser(t.app, { name: 'Apr', email: 'apr-logs@affinitas.com', password: PW_APR, organization: 'Affinitas', roles: [{ role: 'INTERNAL_APPROVER' }] });
  app = await buildApp({
    db: t.app, storage, media, maxUploadBytes: 50 * 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName: SESSION_COOKIE_DEV, externalApprovalEnabled: false }),
    auth: { limiter: new LoginRateLimiter(), sessionTtlMs: 60 * 60_000, cookieName: SESSION_COOKIE_DEV, secureCookie: false },
    // el nivel más verboso que se usaría en producción para diagnosticar
    log: { level: 'debug', stream: logStream },
  });
});
afterAll(async () => {
  await app?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

async function login(email: string, password: string): Promise<Sesion> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email, password }) });
  expect(r.statusCode, r.body).toBe(200);
  const setCookie = String(r.headers['set-cookie']);
  const token = new RegExp(`${SESSION_COOKIE_DEV}=([^;]+)`).exec(setCookie)?.[1] ?? '';
  expect(token.length).toBeGreaterThan(20);
  const me = MeResponseSchema.parse(r.json());
  return { cookie: `${SESSION_COOKIE_DEV}=${token}`, token, csrf: me.csrfToken ?? '', id: me.user.id };
}

async function multipart(campos: Array<[string, string] | [string, Buffer, string]>) {
  const fd = new FormData();
  for (const c of campos) {
    if (c.length === 2) fd.append(c[0], c[1]);
    else fd.append(c[0], new Blob([new Uint8Array(c[1])]), c[2]);
  }
  const req = new Request('http://local/', { method: 'POST', body: fd });
  return { payload: Buffer.from(await req.arrayBuffer()), contentType: req.headers.get('content-type') as string };
}

async function assetReady(surface: string, width: number, height: number, creador: string) {
  const o = await seedStoredObject(t.app, `logs-${surface}-${Math.random()}`);
  const a = await t.app.insertInto('assets').values({ original_filename: `${surface}.mp4`, surface_type: surface, created_by: creador }).returning('id').executeTakeFirstOrThrow();
  await t.app.updateTable('assets').set({ status: 'VALIDATING', stored_object_id: o.storedObjectId, sha256: o.sha256, container: 'MP4', mime_type: 'video/mp4', size_bytes: 1000, width, height, fps: 25, codec: 'h264', duration_ms: 30000 }).where('id', '=', a.id).execute();
  await t.app.updateTable('assets').set({ status: 'READY' }).where('id', '=', a.id).execute();
  return a.id;
}

describe('E1 · §34: los logs no contienen secretos', () => {
  it('login, upload, submit, evidencia, approve y pedidos con secretos falsos → ningún secreto en la salida', async () => {
    const op = await login('op-logs@affinitas.com', PW_OP);
    const apr = await login('apr-logs@affinitas.com', PW_APR);

    // password incorrecta (también es un secreto que no se loguea)
    const PW_MALA = 'password incorrecta muy distinguible 4K#';
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email: 'op-logs@affinitas.com', password: PW_MALA }) })).statusCode).toBe(401);

    // upload real con sesión + CSRF + Idempotency-Key
    const fx = mediaFixtures();
    const mp = await multipart([['surfaceType', 'screen_a'], ['file', readFileSync(fx('valid_screen_a_25.mp4')), 'screen_a.mp4']]);
    const IDEM = 'idempotency-key-secreta-0123456789';
    const up = await app.inject({ method: 'POST', url: '/api/v1/assets', headers: { cookie: op.cookie, 'x-csrf-token': op.csrf, 'idempotency-key': IDEM, 'content-type': mp.contentType }, payload: mp.payload });
    expect(up.statusCode, up.body).toBe(201);

    // submit real (compilador + preflight) sobre un draft persistido
    const master = await assetReady('towers_ab', 2592, 576, op.id);
    const horizontal = await assetReady('horizontal', 1920, 412, op.id);
    const base = PRESET_TAKEOVER_15S();
    const draft: TakeoverDraft = { ...base, surfaces: { ...base.surfaces, masterAssetId: master, horizontalAssetId: horizontal } };
    const camp = await t.app.transaction().execute(async (trx) => {
      const c = await trx.insertInto('campaigns').values({ contract_id: contrato, name: 'Logs' }).returning('id').executeTakeFirstOrThrow();
      const d = await trx.insertInto('campaign_drafts').values({ campaign_id: c.id, takeover_draft: JSON.stringify(draft), created_by: op.id }).returning('id').executeTakeFirstOrThrow();
      await trx.updateTable('campaigns').set({ current_draft_id: d.id }).where('id', '=', c.id).execute();
      return c.id;
    });
    const sub = await app.inject({
      method: 'POST', url: `/api/v1/campaigns/${camp}/submit`,
      headers: { cookie: op.cookie, 'x-csrf-token': op.csrf, 'idempotency-key': `${IDEM}-submit`, 'content-type': 'application/json' }, payload: JSON.stringify({ draftRevision: 1 }),
    });
    expect(sub.statusCode, sub.body).toBe(201);
    const version = ShowVersionResponseSchema.parse(sub.json());

    // evidencia + approve por otra persona
    const pdf = Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n% ${Math.random()}\n`);
    const ev = await multipart([['type', 'PDF'], ['file', pdf, 'ok.pdf']]);
    const evR = await app.inject({ method: 'POST', url: `/api/v1/show-versions/${version.id}/evidence`, headers: { cookie: apr.cookie, 'x-csrf-token': apr.csrf, 'idempotency-key': `${IDEM}-ev`, 'content-type': ev.contentType }, payload: ev.payload });
    expect(evR.statusCode, evR.body).toBe(201);
    const ap = await app.inject({
      method: 'POST', url: `/api/v1/show-versions/${version.id}/approve`,
      headers: { cookie: apr.cookie, 'x-csrf-token': apr.csrf, 'idempotency-key': `${IDEM}-ap`, 'content-type': 'application/json' },
      payload: JSON.stringify({ evidenceId: (evR.json() as { id: string }).id, versionHash: version.versionHash }),
    });
    expect(ap.statusCode, ap.body).toBe(201);

    // secretos FALSOS: cookie inexistente y CSRF equivocado
    const COOKIE_FALSA = 'token-de-sesion-falso-que-no-existe-XYZ987';
    const CSRF_FALSO = 'csrf-falso-muy-distinguible-ABC123';
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `${SESSION_COOKIE_DEV}=${COOKIE_FALSA}` } })).statusCode).toBe(401);
    const sinCsrf = await app.inject({ method: 'PUT', url: `/api/v1/campaigns/${camp}/draft`, headers: { cookie: op.cookie, 'x-csrf-token': CSRF_FALSO, 'content-type': 'application/json' }, payload: JSON.stringify({ takeoverDraft: draft, expectedRevision: 1 }) });
    expect(sinCsrf.statusCode).toBe(403);

    // logout (también emite set-cookie)
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: op.cookie, 'x-csrf-token': op.csrf } })).statusCode).toBe(204);

    const log = salida.join('');
    // hubo logs de verdad, en JSON, de cada etapa
    expect(log.length).toBeGreaterThan(1000);
    for (const evento of ['auth.login', 'asset.upload']) expect(log).toContain(evento);
    for (const linea of log.trim().split('\n')) expect(() => JSON.parse(linea)).not.toThrow();
    // y ningún secreto, en ninguna forma
    const secretos: Record<string, string> = {
      'password operador': PW_OP, 'password aprobador': PW_APR, 'password incorrecta': PW_MALA,
      'token operador': op.token, 'token aprobador': apr.token, 'csrf operador': op.csrf, 'csrf aprobador': apr.csrf,
      'cookie falsa': COOKIE_FALSA, 'csrf falso': CSRF_FALSO, 'idempotency-key': IDEM,
    };
    for (const [nombre, valor] of Object.entries(secretos)) {
      expect(log.includes(valor), `${nombre} apareció en los logs`).toBe(false);
      expect(log.includes(encodeURIComponent(valor)), `${nombre} (url-encoded) apareció en los logs`).toBe(false);
    }
    // los logs de request existen (método/url), pero el serializer de Fastify no vuelca headers;
    // la redacción (cookie, CSRF, Idempotency-Key, set-cookie) queda como segunda barrera
    expect(log).toContain('"req":');
  });
});
