import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyChain } from '@trust/platform-audit';
import { LoginRateLimiter, createUser } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedApproval, seedCampaignWithDraft, seedContract, seedVersion, sha } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ActiveVersionRequestPayload, type FetchLike, PlatformClient } from '../../platform-web/src/lib/api';
import { Intent } from '../../platform-web/src/lib/intent';
import { todasLasVersiones } from '../../platform-web/src/lib/version-history';
import { SESSION_COOKIE_DEV, SessionActorProvider } from './actor';
import { buildApp } from './app';
import { navegador } from './navegador.testkit';

/**
 * F3(a) UI · el cliente de `apps/platform-web` y su "intención" contra la API
 * REAL (HTTP, CORS, cookie, CSRF, PostgreSQL) — brief `docs/briefs/F3A_UI.md`
 * §5 y §6.3. Lo central: la operación se APLICA en el servidor y el cliente
 * pierde la respuesta (cuerpo cortado, o un 502/504 interpuesto después de que
 * la API respondió); el reintento de la MISMA intención devuelve el status y
 * el body originales, con un solo cambio y un solo evento de audit.
 */
const WEB = 'http://localhost:3002';
const PW = 'correct horse battery staple';

let t: TestDatabase;
let root: string;
let app: FastifyInstance;
let base: string;
let contrato: string;
const U: Record<string, string> = {};

type Falla = 'cortar' | '502' | '504';
/**
 * "Navegador" + intermediario de prueba: deja pasar la solicitud a la API real
 * y, si se le pidió, pierde la respuesta del siguiente POST de la API (lo
 * consume entero, así la operación ya hizo COMMIT) y devuelve otra cosa.
 */
async function sesion(email: string) {
  const nav = navegador(WEB, SESSION_COOKIE_DEV);
  let falla: Falla | null = null;
  const posts: Array<{ url: string; key: string | null; body: string | null; status: number }> = [];
  const fetch: FetchLike = async (url, init) => {
    const res = await nav.fetch(url, init);
    if (init.method !== 'POST' || url.endsWith('/auth/login')) return res;
    const body = await res.text();
    posts.push({ url, key: new Headers(init.headers).get('idempotency-key'), body: typeof init.body === 'string' ? init.body : null, status: res.status });
    const f = falla;
    falla = null;
    if (f === 'cortar') return new Response(new ReadableStream({ start(c) { c.error(new Error('body connection reset')); } }), { status: res.status });
    if (f === '502') return new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } });
    if (f === '504') return new Response('<html>504 Gateway Timeout</html>', { status: 504, headers: { 'content-type': 'text/html' } });
    return new Response(body, { status: res.status, headers: res.headers });
  };
  const client = new PlatformClient({ baseUrl: base, fetch });
  await client.login(email, PW);
  return { client, posts, perder: (f: Falla) => { falla = f; } };
}

beforeAll(async () => {
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-f3a-web-'));
  contrato = (await seedContract(t.app)).id;
  const usuario = async (k: string, roles: Array<{ role: 'OPERATOR' | 'INTERNAL_APPROVER' | 'ADMIN' }>) => {
    U[k] = (await createUser(t.app, { name: k, email: `${k}@affinitas.com`, password: PW, organization: 'Affinitas', roles })).id;
  };
  await usuario('op', [{ role: 'OPERATOR' }]);
  await usuario('ap', [{ role: 'INTERNAL_APPROVER' }]);
  await usuario('opap', [{ role: 'OPERATOR' }, { role: 'INTERNAL_APPROVER' }]);
  app = await buildApp({
    db: t.app, storage: await LocalDiskStorage.open(path.join(root, 'store')), media: { ...mediaRuntimeFromEnv({}), scratchDir: path.join(root, 'scratch') },
    maxUploadBytes: 1024 * 1024, maxEvidenceBytes: 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName: SESSION_COOKIE_DEV, externalApprovalEnabled: false }),
    auth: { limiter: new LoginRateLimiter(), sessionTtlMs: 60 * 60_000, cookieName: SESSION_COOKIE_DEV, secureCookie: false },
    corsOrigins: [WEB], log: false,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await app?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

type V = { id: string; hash: string };
async function campania(n: number): Promise<{ id: string; vs: V[] }> {
  const { campaignId, draftId } = await seedCampaignWithDraft(t.app, contrato, U.op!);
  const vs: V[] = [];
  for (let i = 0; i < n; i++) {
    const v = await seedVersion(t.app, { campaignId, draftId, submittedBy: U.op!, versionHash: sha(`f3a-web-${Math.random()}`) });
    await seedApproval(t.app, v.id, U.ap!, 'APPROVED');
    vs.push({ id: v.id, hash: (await t.app.selectFrom('show_versions').select('version_hash').where('id', '=', v.id).executeTakeFirstOrThrow()).version_hash });
  }
  return { id: campaignId, vs };
}
const eventos = async (entityId: string, action: string) =>
  Number((await t.app.selectFrom('audit_events').select((eb) => eb.fn.countAll<string>().as('n')).where('entity_id', '=', entityId).where('action', '=', action).executeTakeFirstOrThrow()).n);
const pedidos = async (campaignId: string) => t.app.selectFrom('active_version_changes').selectAll().where('campaign_id', '=', campaignId).execute();
const vigente = async (campaignId: string) => (await sql<{ a: string | null }>`SELECT active_version_id AS a FROM campaigns WHERE id = ${campaignId}::uuid`.execute(t.owner)).rows[0]?.a ?? null;

const intentPedir = (client: PlatformClient, campaignId: string) =>
  new Intent<ActiveVersionRequestPayload, unknown>((pl, key) => client.requestActiveVersionChange(campaignId, pl, key));
const intentConfirmar = (client: PlatformClient) =>
  new Intent<{ changeId: string; versionHash: string }, unknown>((pl, key) => client.confirmActiveVersionChange(pl.changeId, { versionHash: pl.versionHash }, key));
const intentCancelar = (client: PlatformClient) => new Intent<{ changeId: string }, unknown>((pl, key) => client.cancelActiveVersionChange(pl.changeId, key));

describe('F3(a) UI · cliente contra la API real', () => {
  it('flujo: OPERATOR pide, INTERNAL_APPROVER confirma, la vigente cambia; el historial lo muestra', async () => {
    const c = await campania(2);
    const op = await sesion('op@affinitas.com');
    const pedir = await intentPedir(op.client, c.id).start({ versionId: c.vs[0]!.id, versionHash: c.vs[0]!.hash, reason: 'primera selección', expectedActiveVersionId: null });
    expect(pedir.kind).toBe('ok');
    const camp = await op.client.getCampaign(c.id);
    expect(camp.activeVersion).toBeNull();
    expect(camp.pendingActiveVersionChange?.toVersionId).toBe(c.vs[0]!.id);
    const ap = await sesion('ap@affinitas.com');
    const r = await intentConfirmar(ap.client).start({ changeId: camp.pendingActiveVersionChange!.id, versionHash: camp.pendingActiveVersionChange!.toVersionHash });
    expect(r).toMatchObject({ kind: 'ok', value: { status: 'CONFIRMED', decidedBy: U.ap } });
    expect((await ap.client.getCampaign(c.id)).activeVersion?.id).toBe(c.vs[0]!.id);
    expect((await ap.client.listActiveVersionChanges(c.id)).items.map((h) => h.status)).toEqual(['CONFIRMED']);
  });

  it('cuatro ojos: quien pidió (con los dos roles) no confirma → 403 definitivo; la intención se descarta', async () => {
    const c = await campania(1);
    const s = await sesion('opap@affinitas.com');
    await intentPedir(s.client, c.id).start({ versionId: c.vs[0]!.id, versionHash: c.vs[0]!.hash, reason: 'x', expectedActiveVersionId: null });
    const pend = (await s.client.getCampaign(c.id)).pendingActiveVersionChange!;
    const conf = intentConfirmar(s.client);
    const r = await conf.start({ changeId: pend.id, versionHash: pend.toVersionHash });
    expect(r.kind).toBe('definitive-error');
    expect(r.kind === 'definitive-error' && [r.error.status, r.error.code]).toEqual([403, 'FOUR_EYES_VIOLATION']);
    expect(conf.snapshot).toBeNull();
    expect(await vigente(c.id)).toBeNull();
  });

  it('conflicto al confirmar: 409 definitivo y el pedido queda CANCELLED (persistido)', async () => {
    const c = await campania(2);
    const op = await sesion('op@affinitas.com');
    await intentPedir(op.client, c.id).start({ versionId: c.vs[1]!.id, versionHash: c.vs[1]!.hash, reason: 'x', expectedActiveVersionId: null });
    const pend = (await op.client.getCampaign(c.id)).pendingActiveVersionChange!;
    await sql`UPDATE campaigns SET active_version_id = ${c.vs[0]!.id}::uuid WHERE id = ${c.id}::uuid`.execute(t.owner); // se cruza otro cambio
    const ap = await sesion('ap@affinitas.com');
    const r = await intentConfirmar(ap.client).start({ changeId: pend.id, versionHash: pend.toVersionHash });
    expect(r.kind === 'definitive-error' && [r.error.status, r.error.code]).toEqual([409, 'ACTIVE_VERSION_CONFLICT']);
    expect((await pedidos(c.id))[0]?.status).toBe('CANCELLED');
  });

  for (const falla of ['cortar', '502', '504'] as const) {
    describe(`respuesta perdida DESPUÉS del COMMIT (${falla === 'cortar' ? 'cuerpo cortado' : `${falla} interpuesto`})`, () => {
      it('pedir: incierto → reintento con la misma key y payload → 201 original, un solo pedido y un solo evento', async () => {
        const c = await campania(1);
        const op = await sesion('op@affinitas.com');
        const intent = intentPedir(op.client, c.id);
        op.perder(falla);
        const r1 = await intent.start({ versionId: c.vs[0]!.id, versionHash: c.vs[0]!.hash, reason: 'perdida', expectedActiveVersionId: null });
        expect(r1.kind).toBe('uncertain');
        expect(await pedidos(c.id)).toHaveLength(1); // se aplicó
        const r2 = await intent.retry();
        expect(r2.kind).toBe('ok');
        expect(op.posts.map((p) => [p.status, p.key])).toEqual([[201, op.posts[0]!.key], [201, op.posts[0]!.key]]);
        expect(op.posts[1]!.body).toBe(op.posts[0]!.body); // mismo payload, sin reconstruir
        expect(r2.kind === 'ok' && r2.value).toMatchObject({ id: (await pedidos(c.id))[0]!.id, status: 'PENDING' });
        expect(await pedidos(c.id)).toHaveLength(1);
        expect(await eventos((await pedidos(c.id))[0]!.id, 'ACTIVE_VERSION_CHANGE_REQUESTED')).toBe(1);
      });

      it('confirmar: incierto → reintento → el mismo 200 (no 409), un solo cambio y un solo ACTIVE_VERSION_CHANGED', async () => {
        const c = await campania(1);
        const op = await sesion('op@affinitas.com');
        await intentPedir(op.client, c.id).start({ versionId: c.vs[0]!.id, versionHash: c.vs[0]!.hash, reason: 'x', expectedActiveVersionId: null });
        const pend = (await op.client.getCampaign(c.id)).pendingActiveVersionChange!;
        const ap = await sesion('ap@affinitas.com');
        const intent = intentConfirmar(ap.client);
        ap.perder(falla);
        expect((await intent.start({ changeId: pend.id, versionHash: pend.toVersionHash })).kind).toBe('uncertain');
        expect(await vigente(c.id)).toBe(c.vs[0]!.id); // se aplicó
        const r2 = await intent.retry();
        expect(r2).toMatchObject({ kind: 'ok', value: { id: pend.id, status: 'CONFIRMED' } });
        expect(ap.posts.map((p) => p.status)).toEqual([200, 200]);
        expect(ap.posts[1]!.key).toBe(ap.posts[0]!.key);
        expect(await eventos(c.id, 'ACTIVE_VERSION_CHANGED')).toBe(1);
        expect((await verifyChain(t.owner)).ok).toBe(true);
      });

      it('cancelar: incierto → reintento → el mismo 200, un solo ACTIVE_VERSION_CHANGE_CANCELLED', async () => {
        const c = await campania(1);
        const op = await sesion('op@affinitas.com');
        await intentPedir(op.client, c.id).start({ versionId: c.vs[0]!.id, versionHash: c.vs[0]!.hash, reason: 'x', expectedActiveVersionId: null });
        const pend = (await op.client.getCampaign(c.id)).pendingActiveVersionChange!;
        const intent = intentCancelar(op.client);
        op.perder(falla);
        expect((await intent.start({ changeId: pend.id })).kind).toBe('uncertain');
        expect((await pedidos(c.id))[0]?.status).toBe('CANCELLED');
        expect((await intent.retry())).toMatchObject({ kind: 'ok', value: { status: 'CANCELLED' } });
        expect(op.posts.slice(-2).map((p) => [p.status, p.key])).toEqual([[200, op.posts.at(-2)!.key], [200, op.posts.at(-2)!.key]]);
        expect(await eventos(pend.id, 'ACTIVE_VERSION_CHANGE_CANCELLED')).toBe(1);
      });
    });
  }

  it('una intención DISTINTA usa otra key y no es un replay: tras el pedido, otro pedido da 409 PENDING (definitivo)', async () => {
    const c = await campania(2);
    const op = await sesion('op@affinitas.com');
    const intent = intentPedir(op.client, c.id);
    expect((await intent.start({ versionId: c.vs[0]!.id, versionHash: c.vs[0]!.hash, reason: 'a', expectedActiveVersionId: null })).kind).toBe('ok');
    const r = await intent.start({ versionId: c.vs[1]!.id, versionHash: c.vs[1]!.hash, reason: 'b', expectedActiveVersionId: null });
    expect(r.kind === 'definitive-error' && r.error.code).toBe('ACTIVE_VERSION_CHANGE_PENDING');
    expect(new Set(op.posts.map((p) => p.key)).size).toBe(2);
  });

  it('detalle de un pedido viejo: la versión destino está en la página 2 y se resuelve recorriendo las páginas por id', async () => {
    const c = await campania(25); // v1 queda en la segunda página (limit 20)
    const op = await sesion('op@affinitas.com');
    await intentPedir(op.client, c.id).start({ versionId: c.vs[0]!.id, versionHash: c.vs[0]!.hash, reason: 'a la primera', expectedActiveVersionId: null });
    const pend = (await op.client.getCampaign(c.id)).pendingActiveVersionChange!;
    const primera = await op.client.listCampaignVersions(c.id);
    expect(primera.items.some((v) => v.id === pend.toVersionId)).toBe(false);
    const todas = await todasLasVersiones((cursor) => op.client.listCampaignVersions(c.id, { cursor, limit: 20 }));
    expect(todas).toHaveLength(25);
    expect(todas.find((v) => v.id === pend.toVersionId)).toMatchObject({ versionNumber: 1, versionHash: pend.toVersionHash });
  });
});
