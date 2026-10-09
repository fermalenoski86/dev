import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoginRateLimiter, createUser } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedContract } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { mediaFixtures } from '@trust/platform-media/fixtures';
import { LocalDiskStorage } from '@trust/platform-storage';
import { PRESET_TAKEOVER_15S } from '@trust/show-authoring';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformApiError, PlatformClient } from '../../platform-web/src/lib/api';
import { draftSlots, slotForAsset, withSlotAsset } from '../../platform-web/src/lib/draft-assets';
import { SESSION_COOKIE_DEV, SessionActorProvider } from './actor';
import { buildApp } from './app';
import { navegador } from './navegador.testkit';

/**
 * E3b · el flujo de §41 con el cliente de `apps/platform-web` contra la API
 * REAL (HTTP, PostgreSQL, ffprobe sobre fixtures reales, CORS, CSRF), rol por
 * rol, haciendo lo mismo que hacen los componentes:
 *   OPERATOR: campaña → (Builder guarda) → sube assets → los asigna al draft →
 *             envía → hash visible
 *   INTERNAL_APPROVER: ve la versión → adjunta evidencia → aprueba el hash
 *   OPERATOR: APPROVED VERSION + hash + working draft aparte → edita → la
 *             versión aprobada no cambia
 * El E2E de navegador (Playwright, hosts distintos, TLS) es E3c.
 */
const WEB = 'http://localhost:3002';
const PW = 'correct horse battery staple';
const PDF = Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n% e3b ${Date.now()}\n`);
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let t: TestDatabase;
let root: string;
let app: FastifyInstance;
let base: string;
let fx: (nombre: string) => string;
let contractId: string;
const S: { campaignId?: string; versionId?: string; versionHash?: string; evidenceId?: string; draftRevisionAprobada?: number } = {};

async function sesion(email: string) {
  const nav = navegador(WEB, SESSION_COOKIE_DEV);
  const client = new PlatformClient({ baseUrl: base, fetch: nav.fetch });
  await client.login(email, PW);
  return { client, nav };
}

beforeAll(async () => {
  fx = mediaFixtures();
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-e3b-'));
  await createUser(t.app, { name: 'Operadora', email: 'op@affinitas.com', password: PW, organization: 'Affinitas', roles: [{ role: 'OPERATOR' }] });
  await createUser(t.app, { name: 'Aprobador', email: 'ap@affinitas.com', password: PW, organization: 'Affinitas', roles: [{ role: 'INTERNAL_APPROVER' }] });
  contractId = (await seedContract(t.app)).id;
  const storage = await LocalDiskStorage.open(path.join(root, 'store'));
  app = await buildApp({
    db: t.app, storage, media: { ...mediaRuntimeFromEnv({}), scratchDir: path.join(root, 'scratch') }, maxUploadBytes: 20 * 1024 * 1024, maxEvidenceBytes: 1024 * 1024, mediaBinariesOk: () => true,
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

describe('E3b · §41 con el cliente de platform-web contra la API real', () => {
  it('OPERATOR: campaña → assets reales (READY y REJECTED) → asignados al draft → envío con hash visible → logout', async () => {
    const { client } = await sesion('op@affinitas.com');
    const c = await client.createCampaign({ contractId, name: 'Lanzamiento E3b' });
    S.campaignId = c.id;
    // lo que guarda el Builder (D3) por el repositorio: un show completo
    const inicial = await client.getDraft(c.id);
    await client.putDraft(c.id, { takeoverDraft: { ...PRESET_TAKEOVER_15S(), name: 'desde el Builder' }, expectedRevision: inicial.revision });

    const subir = async (fixture: string, surfaceType: string) => {
      const bytes = readFileSync(fx(fixture));
      const a = await client.uploadAsset({ surfaceType, file: new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), filename: fixture });
      return { a, bytes };
    };
    const master = await subir('valid_towers_ab_25.mp4', 'towers_ab');
    const horizontal = await subir('valid_horizontal_30.mp4', 'horizontal');
    for (const { a, bytes } of [master, horizontal]) {
      expect(a.status).toBe('READY');
      expect(a.sha256).toBe(sha256(bytes));
    }
    expect(master.a).toMatchObject({ width: 2592, height: 576, fps: 25, codec: 'H264' });
    // un archivo que no es video: la validación real lo rechaza y la UI lo recibe como asset REJECTED
    const roto = await client.uploadAsset({ surfaceType: 'horizontal', file: new Blob(['no soy un mp4']), filename: 'trucho.mp4' });
    expect(roto).toMatchObject({ status: 'REJECTED', rejection: { code: 'ASSET_CORRUPT' } });
    expect(roto.rejection?.remediation.summary).toBeTruthy();
    expect((await client.listAssets()).map((a) => a.status).sort()).toEqual(['READY', 'READY', 'REJECTED']);

    // "Usar en <ranura>": lo mismo que hace CampaignDetail (draft vigente + expectedRevision)
    for (const a of [master.a, horizontal.a]) {
      const slot = slotForAsset(a);
      expect(slot).not.toBeNull();
      const actual = await client.getDraft(c.id);
      await client.putDraft(c.id, { takeoverDraft: withSlotAsset(actual.takeoverDraft, slot!, a.id), expectedRevision: actual.revision });
    }
    const d = await client.getDraft(c.id);
    expect(draftSlots(d.takeoverDraft)).toMatchObject({ masterAssetId: master.a.id, horizontalAssetId: horizontal.a.id });
    expect((d.takeoverDraft as { name: string }).name).toBe('desde el Builder'); // el resto del draft no se tocó
    expect(slotForAsset(roto)).toBeNull();

    // asignar sobre una revisión vieja: 409 y no se pisa nada
    await expect(client.putDraft(c.id, { takeoverDraft: d.takeoverDraft, expectedRevision: d.revision - 1 })).rejects.toMatchObject({ status: 409, code: 'DRAFT_CONFLICT' });

    const v = await client.submit(c.id, d.revision);
    expect(v).toMatchObject({ campaignId: c.id, versionNumber: 1, status: 'SUBMITTED', sourceDraftRevision: d.revision, approval: null });
    expect(v.versionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(v.assets.map((a) => a.sha256).sort()).toEqual([master.a.sha256, horizontal.a.sha256].sort());
    S.versionId = v.id;
    S.versionHash = v.versionHash;
    S.draftRevisionAprobada = d.revision;

    // cuatro ojos desde la UI del operador: el servidor dice que no
    const e = await client.approve(v.id, { evidenceId: v.id, versionHash: v.versionHash }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PlatformApiError);
    expect((e as PlatformApiError).status).toBe(403);
    await client.logout();
  });

  it('INTERNAL_APPROVER (otro usuario): ve la versión → adjunta evidencia → un hash distinto da 409 → aprueba el hash exacto → logout', async () => {
    const { client, nav } = await sesion('ap@affinitas.com');
    const v = await client.getVersion(S.versionId!);
    expect(v.versionHash).toBe(S.versionHash);
    expect(v.status).toBe('SUBMITTED');

    const ev = await client.uploadEvidence(v.id, { type: 'PDF', file: new Blob([new Uint8Array(PDF)], { type: 'application/pdf' }), filename: 'ok-cliente.pdf' });
    expect(ev.sha256).toBe(sha256(PDF));
    S.evidenceId = ev.id;
    // la URL de descarga que muestra la UI baja exactamente esos bytes (con la cookie del host de la API)
    const bajada = await nav.fetch(client.evidenceUrl(v.id, ev.id), { method: 'GET', credentials: 'include' });
    expect(bajada.status).toBe(200);
    expect(sha256(Buffer.from(await bajada.arrayBuffer()))).toBe(sha256(PDF));

    await expect(client.approve(v.id, { evidenceId: ev.id, versionHash: 'f'.repeat(64) })).rejects.toMatchObject({ status: 409 });
    const aprobada = await client.approve(v.id, { evidenceId: ev.id, versionHash: v.versionHash });
    expect(aprobada).toMatchObject({ status: 'APPROVED', approval: { decision: 'APPROVED', evidenceId: ev.id, versionHash: S.versionHash } });
    await client.logout();
  });

  it('OPERATOR: APPROVED VERSION con el hash exacto y WORKING DRAFT aparte → edita → la versión aprobada no cambia', async () => {
    const { client } = await sesion('op@affinitas.com');
    const c = await client.getCampaign(S.campaignId!);
    expect(c.latestApprovedVersion).toEqual({ id: S.versionId, versionNumber: 1, versionHash: S.versionHash });
    const d = await client.getDraft(S.campaignId!);
    expect(d.revision).toBe(S.draftRevisionAprobada);
    const editado = await client.putDraft(S.campaignId!, { takeoverDraft: { ...d.takeoverDraft, name: 'edición después de aprobar' }, expectedRevision: d.revision });
    expect(editado.revision).toBe(d.revision + 1);
    const v = await client.getVersion(S.versionId!);
    expect(v).toMatchObject({ status: 'APPROVED', versionHash: S.versionHash, sourceDraftRevision: S.draftRevisionAprobada });
    expect((await client.getCampaign(S.campaignId!)).latestApprovedVersion?.versionHash).toBe(S.versionHash);
    await client.logout();
  });
});
