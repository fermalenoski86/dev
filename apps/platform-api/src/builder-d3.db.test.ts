import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { type CampaignSession, connectBuilderBackend } from '@trust/builder-repository';
import { LoginRateLimiter, type Role, createUser, issueSession } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedApproval, seedVersion, sha } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import { MemoryDraftStorage, PRESET_EMPTY, type TakeoverDraft } from '@trust/show-authoring';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_DEV, SessionActorProvider } from './actor';
import { buildApp } from './app';

/**
 * D3 (#15, opción 1) — la sesión de campaña que usa el Builder
 * (`connectBuilderBackend` + `CampaignSession`) contra la API REAL: Fastify en
 * un puerto, PostgreSQL real y sesión de C1 (el CSRF sale de /auth/me, la
 * cookie la "manda el navegador"). Es la composición exacta que arma el store.
 */
let t: TestDatabase;
let root: string;
let app: FastifyInstance;
let base: string;
const logStream = new Writable({ write(_c, _e, cb) { cb(); } });
const PW = 'correct horse battery staple';
type Who = { id: string; cookie: string };
const U: Record<string, Who> = {};

async function usuario(nombre: string, roles: Array<{ role: Role }>): Promise<Who> {
  const u = await createUser(t.app, { name: nombre, email: `${nombre}-${Math.random().toString(36).slice(2, 8)}@affinitas.com`, password: PW, organization: 'Affinitas', roles });
  const s = await issueSession(t.app, u.id, 60 * 60_000);
  return { id: u.id, cookie: `${SESSION_COOKIE_DEV}=${s.token}` };
}

beforeAll(async () => {
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-d3-'));
  const storage = await LocalDiskStorage.open(path.join(root, 'store'));
  U.admin = await usuario('admin', [{ role: 'ADMIN' }]);
  U.op = await usuario('op', [{ role: 'OPERATOR' }]);
  U.op2 = await usuario('op2', [{ role: 'OPERATOR' }]);
  U.apr = await usuario('apr', [{ role: 'INTERNAL_APPROVER' }]);
  app = await buildApp({
    db: t.app, storage, media: mediaRuntimeFromEnv({}), maxUploadBytes: 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName: SESSION_COOKIE_DEV, externalApprovalEnabled: false }), log: { stream: logStream },
    // /auth/me: de ahí saca el Builder el CSRF de la sesión de C1
    auth: { limiter: new LoginRateLimiter(), sessionTtlMs: 60 * 60_000, cookieName: SESSION_COOKIE_DEV, secureCookie: false },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await app?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

/** El "navegador" de un usuario: manda su cookie y tiene un interruptor de red. */
function navegador(who: Who) {
  const red = { online: true };
  const f: typeof fetch = async (input, init) => {
    if (!red.online) throw new TypeError('fetch failed');
    const headers = new Headers(init?.headers);
    headers.set('cookie', who.cookie);
    return fetch(input, { ...init, headers });
  };
  const storage = new MemoryDraftStorage();
  return { red, storage, conectar: (): Promise<CampaignSession> => connectBuilderBackend({ baseUrl: base, fetch: f, storage }) };
}

async function http(method: string, url: string, who: Who, body?: unknown) {
  const me = await fetch(`${base}/api/v1/auth/me`, { headers: { cookie: who.cookie } });
  const meb = (await me.json()) as { csrfToken: string };
  const csrf = meb.csrfToken;
  const res = await fetch(`${base}${url}`, {
    method, headers: { cookie: who.cookie, 'x-csrf-token': csrf, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let n = 0;
async function campania(): Promise<{ id: string; draftId: string }> {
  const adv = await http('POST', '/api/v1/advertisers', U.admin!, { legalName: 'Arcos Dorados SA', taxId: `30-${Date.now()}${n++}-3` });
  expect(adv.status).toBe(201);
  const ct = await http('POST', '/api/v1/contracts', U.admin!, {
    advertiserId: adv.body.id, name: 'Takeover 2026', startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z', allowedSurfaces: ['screen_a', 'screen_b', 'horizontal'],
  });
  const cp = await http('POST', '/api/v1/campaigns', U.op!, { contractId: ct.body.id, name: 'Launch' });
  expect(cp.status).toBe(201);
  return { id: cp.body.id as string, draftId: (cp.body.currentDraft as { id: string }).id };
}
const draft = (nombre: string): TakeoverDraft => ({ ...PRESET_EMPTY(), name: nombre });
const enBase = async (draftId: string) => {
  const r = await t.app.selectFrom('campaign_drafts').select(['revision', 'takeover_draft']).where('id', '=', draftId).executeTakeFirstOrThrow();
  return { revision: r.revision, name: (r.takeover_draft as { name: string }).name };
};
const updates = async (draftId: string) =>
  (await t.app.selectFrom('audit_events').select('action').where('entity_id', '=', draftId).where('action', '=', 'DRAFT_UPDATED').execute()).length;

describe('CRITERIO D3: el Builder abre la campaña del backend y guarda con expectedRevision', () => {
  it('open muestra APPROVED VERSION vN y WORKING DRAFT; guardar no toca la versión aprobada (§32)', async () => {
    const cp = await campania();
    const v = await seedVersion(t.app, { campaignId: cp.id, draftId: cp.draftId, submittedBy: U.op!.id, versionHash: sha(`d3-${Math.random()}`) });
    await seedApproval(t.app, v.id, U.apr!.id, 'APPROVED');
    await t.app.updateTable('campaigns').set({ latest_approved_version_id: v.id }).where('id', '=', cp.id).execute();
    const antes = await t.app.selectFrom('show_versions').selectAll().where('id', '=', v.id).executeTakeFirstOrThrow();

    const ses = await navegador(U.op!).conectar();
    const o = await ses.open(cp.id);
    expect(o.draft.name).toBe('Launch');
    expect(ses.view()).toMatchObject({ campaignId: cp.id, revision: 1, approvedVersion: { id: v.id, versionNumber: 1 }, phase: 'idle' });

    expect(await ses.save(draft('working draft'))).toMatchObject({ kind: 'saved', revision: 2 });
    expect(ses.view()).toMatchObject({ phase: 'saved', revision: 2, approvedVersion: { versionNumber: 1 } });
    expect(await enBase(cp.draftId)).toEqual({ revision: 2, name: 'working draft' });
    expect(await t.app.selectFrom('show_versions').selectAll().where('id', '=', v.id).executeTakeFirstOrThrow()).toEqual(antes);
  });

  it('autosaves encimados: uno por vez y solo el último; cada subida es UNA revisión y UN audit', async () => {
    const cp = await campania();
    const ses = await navegador(U.op!).conectar();
    await ses.open(cp.id);
    const r = await Promise.all([ses.save(draft('a')), ses.save(draft('b')), ses.save(draft('c'))]);
    expect(r.every((x) => x?.kind === 'saved')).toBe(true);
    const fin = await enBase(cp.draftId);
    expect(fin.name).toBe('c');
    // 'a' se subió primero; 'b' quedó viejo antes de salir: 2 revisiones, no 3
    expect(fin.revision).toBe(3);
    expect(await updates(cp.draftId)).toBe(2);
    expect(ses.view()).toMatchObject({ phase: 'saved', revision: 3 });
  });

  it('offline → pending (local); al volver, sync sube con la revisión correcta', async () => {
    const cp = await campania();
    const nav = navegador(U.op!);
    const ses = await nav.conectar();
    await ses.open(cp.id);
    nav.red.online = false;
    expect(await ses.save(draft('sin red'))).toEqual({ kind: 'pending', revision: 1 });
    expect(ses.view()).toMatchObject({ phase: 'pending', connectivity: 'offline' });
    expect(await enBase(cp.draftId)).toEqual({ revision: 1, name: 'Launch' });
    nav.red.online = true;
    expect(await ses.sync()).toMatchObject({ kind: 'saved', revision: 2 });
    expect(await enBase(cp.draftId)).toEqual({ revision: 2, name: 'sin red' });
  });

  it('otro operador escribe → CONFLICTO visible, el servidor no se pisa; "mantener la mía" es explícito', async () => {
    const cp = await campania();
    const yo = await navegador(U.op!).conectar();
    const otro = await navegador(U.op2!).conectar();
    await yo.open(cp.id);
    await otro.open(cp.id);
    expect(await otro.save(draft('del otro'))).toMatchObject({ kind: 'saved', revision: 2 });
    expect(await yo.save(draft('mio'))).toMatchObject({ kind: 'conflict', conflict: { serverRevision: 2, clientRevision: 1 } });
    expect(yo.view()).toMatchObject({ phase: 'conflict', conflict: { serverRevision: 2 } });
    expect(await enBase(cp.draftId)).toEqual({ revision: 2, name: 'del otro' });
    // seguir editando con el conflicto abierto no sube nada
    expect((await yo.save(draft('mio 2')))?.kind).toBe('conflict');
    expect(await enBase(cp.draftId)).toEqual({ revision: 2, name: 'del otro' });
    expect(await yo.keepLocal()).toMatchObject({ kind: 'saved', revision: 3 });
    expect(await enBase(cp.draftId)).toEqual({ revision: 3, name: 'mio 2' });
  });

  it('recuperar la del servidor y duplicar: el Builder adopta el draft del servidor sin escribir', async () => {
    const cp = await campania();
    const yo = await navegador(U.op!).conectar();
    const otro = await navegador(U.op2!).conectar();
    await yo.open(cp.id);
    await otro.open(cp.id);
    await otro.save(draft('servidor v2'));
    await yo.save(draft('local'));
    expect((await yo.recoverServer()).name).toBe('servidor v2');
    expect(yo.view()).toMatchObject({ phase: 'saved', revision: 2, conflict: null });
    await otro.save(draft('servidor v3'));
    await yo.save(draft('local 2'));
    expect((await yo.duplicateAsNew()).name).toBe('servidor v3');
    expect(yo.view()?.localCopy?.name).toBe('local 2');
    expect(await enBase(cp.draftId)).toEqual({ revision: 3, name: 'servidor v3' });
  });

  it('INTERNAL_APPROVER abre pero no puede guardar: error visible, la base intacta; sin sesión no conecta', async () => {
    const cp = await campania();
    const ses = await navegador(U.apr!).conectar();
    await ses.open(cp.id);
    await expect(ses.save(draft('x'))).rejects.toMatchObject({ httpStatus: 403 });
    expect(ses.view()).toMatchObject({ phase: 'error', error: { code: expect.any(String) } });
    expect(await enBase(cp.draftId)).toEqual({ revision: 1, name: 'Launch' });
    await expect(navegador({ id: 'x', cookie: `${SESSION_COOKIE_DEV}=no-existe` }).conectar()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
