import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoginRateLimiter, createUser } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedApproval, seedCampaignWithDraft, seedContract, seedVersion, sha } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformApiError, PlatformClient, type VersionSummary } from '../../platform-web/src/lib/api';
import { appendPage } from '../../platform-web/src/lib/version-history';
import { SESSION_COOKIE_DEV, SessionActorProvider } from './actor';
import { buildApp } from './app';
import { navegador } from './navegador.testkit';

/**
 * BL-31 · el historial con el cliente de `apps/platform-web` contra la API REAL
 * (HTTP, CORS, cookie de sesión, PostgreSQL): recorre las páginas como lo hace
 * el componente, abre cada versión del historial y comprueba que un aprobador
 * externo no puede listar una campaña de otro contrato.
 */
const WEB = 'http://localhost:3002';
const PW = 'correct horse battery staple';

let t: TestDatabase;
let root: string;
let app: FastifyInstance;
let base: string;
let campA: string;
let campB: string;
const idsA: string[] = [];

async function sesion(email: string) {
  const nav = navegador(WEB, SESSION_COOKIE_DEV);
  const client = new PlatformClient({ baseUrl: base, fetch: nav.fetch });
  await client.login(email, PW);
  return client;
}

beforeAll(async () => {
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-bl31-web-'));
  const a = (await seedContract(t.app)).id;
  const b = (await seedContract(t.app)).id;
  await t.app.updateTable('contracts').set({ external_approval_enabled: true }).where('id', 'in', [a, b]).execute();
  const op = await createUser(t.app, { name: 'Operadora', email: 'op@affinitas.com', password: PW, organization: 'Affinitas', roles: [{ role: 'OPERATOR' }] });
  const ap = await createUser(t.app, { name: 'Aprobador', email: 'ap@affinitas.com', password: PW, organization: 'Affinitas', roles: [{ role: 'INTERNAL_APPROVER' }] });
  await createUser(t.app, { name: 'Externo', email: 'ext@cliente.com', password: PW, organization: 'Cliente', roles: [{ role: 'EXTERNAL_APPROVER', contractId: a }] });
  const cA = await seedCampaignWithDraft(t.app, a, op.id);
  const cB = await seedCampaignWithDraft(t.app, b, op.id);
  campA = cA.campaignId;
  campB = cB.campaignId;
  for (let i = 0; i < 25; i++) idsA.push((await seedVersion(t.app, { campaignId: campA, draftId: cA.draftId, submittedBy: op.id, versionHash: sha(`bl31-web-${i}`) })).id);
  await seedVersion(t.app, { campaignId: campB, draftId: cB.draftId, submittedBy: op.id });
  await seedApproval(t.app, idsA[24] as string, ap.id, 'APPROVED');
  app = await buildApp({
    db: t.app, storage: await LocalDiskStorage.open(path.join(root, 'store')), media: { ...mediaRuntimeFromEnv({}), scratchDir: path.join(root, 'scratch') },
    maxUploadBytes: 1024 * 1024, maxEvidenceBytes: 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName: SESSION_COOKIE_DEV, externalApprovalEnabled: true }),
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

async function todo(client: PlatformClient, campaignId: string): Promise<{ items: VersionSummary[]; paginas: number }> {
  let p = await client.listCampaignVersions(campaignId);
  let items = p.items;
  let paginas = 1;
  while (p.nextCursor && paginas < 10) {
    p = await client.listCampaignVersions(campaignId, { cursor: p.nextCursor });
    items = appendPage(items, p.items);
    paginas += 1;
  }
  return { items, paginas };
}

describe('BL-31 · platform-web contra la API real', () => {
  it('INTERNAL_APPROVER: recorre 25 versiones en 2 páginas (20 + 5), más nueva primero, y abre la aprobada desde el historial', async () => {
    const client = await sesion('ap@affinitas.com');
    const { items, paginas } = await todo(client, campA);
    expect(paginas).toBe(2);
    expect(items.map((v) => v.versionNumber)).toEqual(Array.from({ length: 25 }, (_x, i) => 25 - i));
    expect(items.map((v) => v.id)).toEqual([...idsA].reverse());
    expect(items[0]?.status).toBe('APPROVED');
    const v = await client.getVersion(items[0]!.id);
    expect([v.versionHash, v.status, v.campaignId]).toEqual([items[0]!.versionHash, 'APPROVED', campA]);
    await client.logout();
  });

  it('EXTERNAL_APPROVER del contrato A: ve el historial de A; el de B es 404 CAMPAIGN_NOT_FOUND (como una inexistente)', async () => {
    const client = await sesion('ext@cliente.com');
    expect((await todo(client, campA)).items).toHaveLength(25);
    const ajena = await client.listCampaignVersions(campB).catch((e: unknown) => e);
    expect(ajena).toBeInstanceOf(PlatformApiError);
    expect(ajena).toMatchObject({ status: 404, code: 'CAMPAIGN_NOT_FOUND' });
    await client.logout();
  });

  it('OPERATOR: un cursor de otra campaña da 400 INVALID_CURSOR, no filas ajenas', async () => {
    const client = await sesion('op@affinitas.com');
    const deB = (await client.listCampaignVersions(campB)).items[0]!.id;
    await expect(client.listCampaignVersions(campA, { cursor: deB })).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    await client.logout();
  });
});
