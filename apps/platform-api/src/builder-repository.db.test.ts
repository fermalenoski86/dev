import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { ApiCampaignRepository, OfflineError, RepositoryError, SyncingCampaignRepository } from '@trust/builder-repository';
import { verifyChain } from '@trust/platform-audit';
import { type Role, createUser, issueSession } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedApproval, seedVersion, sha } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import { DRAFT_STORAGE_KEY, MemoryDraftStorage, PRESET_EMPTY, type TakeoverDraft, loadDraft } from '@trust/show-authoring';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_DEV, SessionActorProvider } from './actor';
import { buildApp } from './app';

/**
 * D2 — `@trust/builder-repository` contra la API REAL de D1: Fastify
 * escuchando en un puerto + PostgreSQL real + sesiones reales (cookie + CSRF).
 * El "sin conexión" se simula en el fetch inyectado (el backend sigue vivo, el
 * cliente no llega), que es exactamente lo que ve el navegador.
 */
let t: TestDatabase;
let root: string;
let app: FastifyInstance;
let base: string;
const logStream = new Writable({ write(_c, _e, cb) { cb(); } });
const PW = 'correct horse battery staple';
type Who = { id: string; cookie: string; csrf: string };
const U: Record<string, Who> = {};

async function usuario(nombre: string, roles: Array<{ role: Role; contractId?: string }>): Promise<Who> {
  const u = await createUser(t.app, { name: nombre, email: `${nombre}-${Math.random().toString(36).slice(2, 8)}@affinitas.com`, password: PW, organization: 'Affinitas', roles });
  const s = await issueSession(t.app, u.id, 60 * 60_000);
  return { id: u.id, cookie: `${SESSION_COOKIE_DEV}=${s.token}`, csrf: s.csrfToken };
}

beforeAll(async () => {
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-d2-'));
  const storage = await LocalDiskStorage.open(path.join(root, 'store'));
  U.admin = await usuario('admin', [{ role: 'ADMIN' }]);
  U.op = await usuario('op', [{ role: 'OPERATOR' }]);
  U.op2 = await usuario('op2', [{ role: 'OPERATOR' }]);
  U.apr = await usuario('apr', [{ role: 'INTERNAL_APPROVER' }]);
  app = await buildApp({
    db: t.app, storage, media: mediaRuntimeFromEnv({}), maxUploadBytes: 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName: SESSION_COOKIE_DEV, externalApprovalEnabled: false }), log: { stream: logStream },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await app?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

/** fetch del "navegador" de un usuario: cookie de sesión, y un interruptor de red. */
function navegador(who: Who) {
  const red = { online: true, perderRespuesta: false };
  const f: typeof fetch = async (input, init) => {
    if (!red.online) throw new TypeError('fetch failed');
    const headers = new Headers(init?.headers);
    headers.set('cookie', who.cookie);
    const res = await fetch(input, { ...init, headers });
    if (red.perderRespuesta) throw new TypeError('socket hang up'); // el servidor YA confirmó
    return res;
  };
  return { red, fetch: f, api: (csrf: string | null = who.csrf) => new ApiCampaignRepository({ baseUrl: base, fetch: f, csrfToken: () => csrf }) };
}

async function http(method: string, url: string, who: Who, body?: unknown) {
  const res = await fetch(`${base}${url}`, {
    method, headers: { cookie: who.cookie, 'x-csrf-token': who.csrf, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let n = 0;
async function campania(): Promise<{ id: string; draftId: string }> {
  const adv = await http('POST', '/api/v1/advertisers', U.admin!, { legalName: 'Arcos Dorados SA', taxId: `30-${Date.now()}${n++}-1` });
  expect(adv.status).toBe(201);
  const ct = await http('POST', '/api/v1/contracts', U.admin!, {
    advertiserId: adv.body.id, name: 'Takeover 2026', startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z', allowedSurfaces: ['screen_a', 'screen_b', 'horizontal'],
  });
  expect(ct.status).toBe(201);
  const cp = await http('POST', '/api/v1/campaigns', U.op!, { contractId: ct.body.id, name: 'Launch' });
  expect(cp.status).toBe(201);
  return { id: cp.body.id as string, draftId: (cp.body.currentDraft as { id: string }).id };
}
const draft = (nombre: string): TakeoverDraft => ({ ...PRESET_EMPTY(), name: nombre });
const enBase = async (draftId: string) => {
  const r = await t.app.selectFrom('campaign_drafts').select(['revision', 'takeover_draft']).where('id', '=', draftId).executeTakeFirstOrThrow();
  return { revision: r.revision, name: (r.takeover_draft as { name: string }).name };
};

describe('CRITERIO D2: ApiCampaignRepository contra la API real', () => {
  it('open (draft + revisión + aprobada §32) y save con expectedRevision, cookie y CSRF de C1', async () => {
    const cp = await campania();
    const v = await seedVersion(t.app, { campaignId: cp.id, draftId: cp.draftId, submittedBy: U.op!.id, versionHash: sha(`v-${Math.random()}`) });
    await seedApproval(t.app, v.id, U.apr!.id, 'APPROVED');
    await t.app.updateTable('campaigns').set({ latest_approved_version_id: v.id }).where('id', '=', cp.id).execute();
    const repo = navegador(U.op!).api();
    const o = await repo.open(cp.id);
    expect(o).toMatchObject({ campaignId: cp.id, revision: 1, source: 'server', approvedVersion: { id: v.id, versionNumber: 1 } });
    expect(await repo.save(draft('desde el repo'), 1)).toMatchObject({ kind: 'saved', revision: 2 });
    expect(await enBase(cp.draftId)).toEqual({ revision: 2, name: 'desde el repo' });
  });

  it('revisión vieja → conflict con serverRevision/clientRevision/serverUpdatedAt y la base intacta', async () => {
    const cp = await campania();
    const a = navegador(U.op!).api();
    const b = navegador(U.op2!).api();
    await a.open(cp.id);
    await b.open(cp.id);
    expect((await b.save(draft('B'), 1)).kind).toBe('saved');
    const c = await a.save(draft('A'), 1);
    expect(c.kind).toBe('conflict');
    if (c.kind !== 'conflict') return;
    expect(c.conflict).toMatchObject({ serverRevision: 2, clientRevision: 1 });
    expect(Number.isNaN(Date.parse(c.conflict.serverUpdatedAt))).toBe(false);
    expect(await enBase(cp.draftId)).toEqual({ revision: 2, name: 'B' });
  });

  it('sin CSRF → RepositoryError 403 CSRF_TOKEN_INVALID; INTERNAL_APPROVER → 403 FORBIDDEN; red caída → OfflineError', async () => {
    const cp = await campania();
    const sinCsrf = navegador(U.op!).api(null);
    await sinCsrf.open(cp.id);
    await expect(sinCsrf.save(draft('x'), 1)).rejects.toMatchObject({ httpStatus: 403, code: 'CSRF_TOKEN_INVALID' });
    const apr = navegador(U.apr!).api();
    await apr.open(cp.id);
    const e = await apr.save(draft('x'), 1).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RepositoryError);
    expect(e).toMatchObject({ httpStatus: 403 });
    const nav = navegador(U.op!);
    nav.red.online = false;
    await expect(nav.api().open(cp.id)).rejects.toBeInstanceOf(OfflineError);
    expect(await enBase(cp.draftId)).toEqual({ revision: 1, name: 'Launch' });
  });
});

describe('CRITERIO D2: SyncingCampaignRepository — ciclo offline → online → conflicto (§9) contra la API real', () => {
  it('offline guarda local; otro operador escribe; al volver, CONFLICTO sin pisar el servidor', async () => {
    const cp = await campania();
    const nav = navegador(U.op!);
    const st = new MemoryDraftStorage();
    const repo = new SyncingCampaignRepository({ storage: st, api: nav.api() });
    await repo.open(cp.id);
    expect(await repo.save(draft('online'), 1)).toMatchObject({ kind: 'saved', revision: 2 });

    nav.red.online = false;
    expect(await repo.save(draft('offline'), 2)).toEqual({ kind: 'pending', revision: 2 });
    expect(loadDraft(st)?.name).toBe('offline');
    expect(st.getItem(DRAFT_STORAGE_KEY)).toBe(JSON.stringify(draft('offline'))); // formato M2C intacto

    const otro = navegador(U.op2!).api();
    await otro.open(cp.id);
    expect(await otro.save(draft('del otro operador'), 2)).toMatchObject({ kind: 'saved', revision: 3 });

    nav.red.online = true;
    const c = await repo.sync();
    expect(c).toMatchObject({ kind: 'conflict', conflict: { serverRevision: 3, clientRevision: 2 } });
    expect(await enBase(cp.draftId)).toEqual({ revision: 3, name: 'del otro operador' });
    // seguir editando con el conflicto abierto no sube nada
    expect((await repo.save(draft('offline 2'), 2)).kind).toBe('conflict');
    expect(await enBase(cp.draftId)).toEqual({ revision: 3, name: 'del otro operador' });
    expect(repo.status()).toMatchObject({ connectivity: 'online', pending: true, conflict: { serverRevision: 3 } });
  });

  it('las tres salidas de §9: duplicar (sin escritura remota), mantener local y recuperar server', async () => {
    const cp = await campania();
    const nav = navegador(U.op!);
    const repo = new SyncingCampaignRepository({ storage: new MemoryDraftStorage(), api: nav.api() });
    const otro = navegador(U.op2!).api();
    await repo.open(cp.id);
    await otro.open(cp.id);

    // duplicar: copia local + vuelve al servidor, la base no cambia
    await otro.save(draft('remoto 1'), 1);
    expect((await repo.save(draft('local 1'), 1)).kind).toBe('conflict');
    const dup = await repo.duplicateAsNew();
    expect(dup.draft.name).toBe('local 1');
    expect(dup.server).toMatchObject({ revision: 2, source: 'server' });
    expect(await enBase(cp.draftId)).toEqual({ revision: 2, name: 'remoto 1' });

    // mantener local: decisión explícita sobre la revisión que mostró el conflicto
    await otro.save(draft('remoto 2'), 2);
    expect((await repo.save(draft('local 2'), 2)).kind).toBe('conflict');
    expect(await repo.keepLocal()).toMatchObject({ kind: 'saved', revision: 4 });
    expect(await enBase(cp.draftId)).toEqual({ revision: 4, name: 'local 2' });

    // recuperar server: descarta lo local
    await otro.save(draft('remoto 3'), 4);
    expect((await repo.save(draft('local 3'), 4)).kind).toBe('conflict');
    const rec = await repo.recoverServer();
    expect(rec.draft.name).toBe('remoto 3');
    expect(repo.status()).toMatchObject({ revision: 5, pending: false, conflict: null });
    expect(await enBase(cp.draftId)).toEqual({ revision: 5, name: 'remoto 3' });
    const audits = await t.app.selectFrom('audit_events').select('action').where('entity_id', '=', cp.draftId).where('action', '=', 'DRAFT_UPDATED').execute();
    expect(audits).toHaveLength(4); // remoto 1, remoto 2, local 2, remoto 3: nada más
  });

  it('PUT confirmado cuya respuesta se pierde: el reintento NO crea conflicto falso ni una segunda revisión', async () => {
    const cp = await campania();
    const nav = navegador(U.op!);
    const repo = new SyncingCampaignRepository({ storage: new MemoryDraftStorage(), api: nav.api() });
    await repo.open(cp.id);
    nav.red.perderRespuesta = true;
    expect(await repo.save(draft('una sola vez'), 1)).toEqual({ kind: 'pending', revision: 1 });
    expect(await enBase(cp.draftId)).toEqual({ revision: 2, name: 'una sola vez' });
    nav.red.perderRespuesta = false;
    expect(await repo.sync()).toMatchObject({ kind: 'saved', revision: 2 });
    expect(await enBase(cp.draftId)).toEqual({ revision: 2, name: 'una sola vez' });
    expect(repo.status()).toMatchObject({ pending: false, conflict: null });
  });

  it('reabrir el Builder con trabajo pendiente lo sincroniza; verifyChain OK', async () => {
    const cp = await campania();
    const nav = navegador(U.op!);
    const st = new MemoryDraftStorage();
    await new SyncingCampaignRepository({ storage: st, api: nav.api() }).open(cp.id);
    nav.red.online = false;
    const r1 = new SyncingCampaignRepository({ storage: st, api: nav.api() });
    await r1.open(cp.id);
    await r1.save(draft('antes de cerrar'), 1);
    nav.red.online = true;
    const r2 = new SyncingCampaignRepository({ storage: st, api: nav.api() });
    expect((await r2.open(cp.id)).draft.name).toBe('antes de cerrar');
    expect(r2.status()).toMatchObject({ pending: false, revision: 2 });
    expect(await enBase(cp.draftId)).toEqual({ revision: 2, name: 'antes de cerrar' });
    expect((await verifyChain(t.app)).problems).toEqual([]);
  });
});
