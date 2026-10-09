import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { assetSourceFor } from '@trust/platform-approval';
import { verifyChain } from '@trust/platform-audit';
import { LoginRateLimiter, type Role, createUser } from '@trust/platform-auth';
import { type CampaignSession, connectBuilderBackend } from '@trust/builder-repository';
import { computeVersionHash } from '@trust/platform-contracts';
import { type TestDatabase, createTestDatabase } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { mediaFixtures } from '@trust/platform-media/fixtures';
import { LocalDiskStorage } from '@trust/platform-storage';
import { AssetRegistry, MemoryDraftStorage, PRESET_TAKEOVER_15S, type TakeoverDraft, validateDraft } from '@trust/show-authoring';
import { DEMO_SCENES, EL_TRUST } from '@trust/show-engine';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_DEV, SessionActorProvider } from './actor';
import { buildApp } from './app';
import { AssetResponseSchema, CampaignResponseSchema, EvidenceResponseSchema, ShowVersionResponseSchema } from './contracts';

/**
 * E2 — E2E de plataforma SIN navegador (master §41 y §48; brief E §E2).
 *
 * Un solo recorrido por HTTP REAL: Fastify escuchando en un puerto, PostgreSQL
 * real, ffprobe real sobre fixtures reales, login real con contraseña, cookie
 * y CSRF de C1. Cada paso lo ejecuta el rol que el backend exige y cada rol
 * entra y sale con su propio login/logout. Nada se siembra por la base salvo
 * los usuarios (no hay endpoint de alta de usuarios: es el CLI de C1).
 *
 * El draft se guarda con `@trust/builder-repository` (`connectBuilderBackend`
 * + `CampaignSession`): el mismo código que usa el Builder desde D3.
 *
 * La matriz de los 19 puntos de §48 (docs/reviews/M3A1_ACEPTACION.md) se GENERA desde los
 * tags `[§48.N]` de estos títulos (BL-23, scripts/acceptance/): renombrar un test o sacarle
 * el tag hace fallar CI.
 */
let t: TestDatabase;
let root: string;
let app: FastifyInstance;
let base: string;
let fx: (nombre: string) => string;
const rutas: Array<{ method: string; url: string }> = [];
const logStream = new Writable({ write(_c, _e, cb) { cb(); } });
const PW: Record<string, string> = { admin: 'admin passphrase 2026!', op: 'operator passphrase 2026!', apr: 'approver passphrase 2026!' };
const EMAIL: Record<string, string> = {};
const ID: Record<string, string> = {};

beforeAll(async () => {
  fx = mediaFixtures();
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-e2-'));
  const storage = await LocalDiskStorage.open(path.join(root, 'store'));
  const media = { ...mediaRuntimeFromEnv({}), scratchDir: path.join(root, 'scratch') };
  const usuarios: Array<[string, Role]> = [['admin', 'ADMIN'], ['op', 'OPERATOR'], ['apr', 'INTERNAL_APPROVER']];
  for (const [k, role] of usuarios) {
    EMAIL[k] = `${k}-e2-${Math.random().toString(36).slice(2, 8)}@affinitas.com`;
    ID[k] = (await createUser(t.app, { name: k, email: EMAIL[k]!, password: PW[k]!, organization: 'Affinitas', roles: [{ role }] })).id;
  }
  app = await buildApp({
    db: t.app, storage, media, maxUploadBytes: 20 * 1024 * 1024, maxEvidenceBytes: 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName: SESSION_COOKIE_DEV, externalApprovalEnabled: false }), log: { stream: logStream },
    auth: { limiter: new LoginRateLimiter(), sessionTtlMs: 60 * 60_000, cookieName: SESSION_COOKIE_DEV, secureCookie: false },
    onRoute: (r) => rutas.push({ method: r.method, url: r.url }),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await app?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

/* ── un "navegador" por rol: login real, cookie, CSRF, logout ─────────── */

interface Sesion {
  quien: string;
  cookie: string;
  csrf: string;
  fetch: typeof fetch;
  json: (method: string, url: string, body?: unknown, extra?: Record<string, string>) => Promise<{ status: number; body: unknown }>;
  logout: () => Promise<void>;
}

let n = 0;
const clave = () => `e2-${Date.now()}-${n++}`;

async function login(quien: 'admin' | 'op' | 'apr'): Promise<Sesion> {
  const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL[quien], password: PW[quien] }) });
  expect(r.status, `login ${quien}`).toBe(200);
  const me = (await r.json()) as { csrfToken: string; user: { id: string }; roles: string[] };
  expect(me.user.id).toBe(ID[quien]);
  const setCookie = r.headers.get('set-cookie') ?? '';
  const m = new RegExp(`${SESSION_COOKIE_DEV}=([^;]+)`).exec(setCookie);
  expect(m, 'cookie de sesión').not.toBeNull();
  expect(setCookie.toLowerCase()).toContain('httponly');
  const cookie = `${SESSION_COOKIE_DEV}=${m![1]}`;
  const f: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('cookie', cookie);
    return fetch(input, { ...init, headers });
  };
  const json: Sesion['json'] = async (method, url, body, extra = {}) => {
    const headers: Record<string, string> = { ...extra };
    if (method !== 'GET') headers['x-csrf-token'] = me.csrfToken;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await f(`${base}${url}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return {
    quien, cookie, csrf: me.csrfToken, fetch: f, json,
    logout: async () => {
      expect((await json('POST', '/api/v1/auth/logout')).status).toBe(204);
      // la sesión murió en el servidor: la misma cookie ya no sirve
      expect((await json('GET', '/api/v1/auth/me')).status).toBe(401);
    },
  };
}

async function multipart(s: Sesion, url: string, campos: Array<[string, string] | [string, Buffer, string, string?]>, key: string) {
  const fd = new FormData();
  for (const c of campos) {
    if (c.length === 2) fd.append(c[0], c[1]);
    else fd.append(c[0], new Blob([new Uint8Array(c[1])], c[3] ? { type: c[3] } : {}), c[2]);
  }
  const res = await s.fetch(`${base}${url}`, { method: 'POST', headers: { 'x-csrf-token': s.csrf, 'idempotency-key': key }, body: fd });
  return { status: res.status, body: (await res.json()) as unknown };
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const PDF = Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n% e2 ${Date.now()}\n`);

/** El hash que el servidor tiene que calcular, recomputado con el mismo compilador y preflight. */
function hashEsperado(draft: TakeoverDraft, assets: Array<{ slot: string; id: string; sha256: string; w: number; h: number; ms: number }>) {
  const reg = new AssetRegistry(assets.map((a) => ({ id: a.id, name: a.slot, type: 'video' as const, source: assetSourceFor(a.sha256), width: a.w, height: a.h, durationMs: a.ms, tags: [], unmanaged: false })));
  const v = validateDraft(draft, { building: EL_TRUST, assets: reg, sceneIds: new Set(DEMO_SCENES.keys()), preflight: { building: EL_TRUST, scenes: DEMO_SCENES } });
  return { exportable: v.exportable, hash: computeVersionHash(v.compile.showPackage, assets.map((a) => ({ logicalRef: a.slot, sha256: a.sha256 }))).versionHash };
}

/* ── el recorrido ─────────────────────────────────────────────────────── */

const E: {
  contractId?: string; campaignId?: string; draftId?: string;
  master?: { id: string; sha256: string; w: number; h: number; ms: number };
  horizontal?: { id: string; sha256: string; w: number; h: number; ms: number };
  draft?: TakeoverDraft; versionId?: string; versionHash?: string; evidenceId?: string; revisionSubmit?: number;
} = {};

describe('E2 · §41 por HTTP real, rol por rol (sin navegador)', () => {
  it('1 · ADMIN: login → Advertiser y Contract → logout', async () => {
    const admin = await login('admin');
    const adv = await admin.json('POST', '/api/v1/advertisers', { legalName: 'Arcos Dorados SA', taxId: `30-${Date.now()}-9` });
    expect(adv.status, JSON.stringify(adv.body)).toBe(201);
    const ct = await admin.json('POST', '/api/v1/contracts', {
      advertiserId: (adv.body as { id: string }).id, name: 'Takeover Noviembre', startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z',
      allowedSurfaces: ['screen_a', 'screen_b', 'horizontal'],
    });
    expect(ct.status, JSON.stringify(ct.body)).toBe(201);
    E.contractId = (ct.body as { id: string }).id;
    await admin.logout();
  });

  it('2 · OPERATOR: login → crea la Campaign → el Builder (builder-repository) guarda el draft; la revisión protege la concurrencia [§48.1] [§48.2] [§48.3]', async () => {
    const op = await login('op');
    const cp = await op.json('POST', '/api/v1/campaigns', { contractId: E.contractId, name: 'Lanzamiento' });
    expect(cp.status, JSON.stringify(cp.body)).toBe(201);
    const campania = CampaignResponseSchema.parse(cp.body);
    E.campaignId = campania.id;
    E.draftId = campania.currentDraft!.id;

    const ses: CampaignSession = await connectBuilderBackend({ baseUrl: base, fetch: op.fetch, storage: new MemoryDraftStorage() });
    await ses.open(E.campaignId);
    expect(await ses.save({ ...PRESET_TAKEOVER_15S(), name: 'primer guardado' })).toMatchObject({ kind: 'saved', revision: 2 });
    const enBase = await t.app.selectFrom('campaign_drafts').select(['revision', 'takeover_draft']).where('id', '=', E.draftId).executeTakeFirstOrThrow();
    expect(enBase.revision).toBe(2);
    expect((enBase.takeover_draft as { name: string }).name).toBe('primer guardado');

    // §48.3: un cliente con la revisión vieja recibe 409 y no escribe nada
    const viejo = await op.json('PUT', `/api/v1/campaigns/${E.campaignId}/draft`, { takeoverDraft: PRESET_TAKEOVER_15S(), expectedRevision: 1 });
    expect(viejo.status).toBe(409);
    expect(viejo.body).toMatchObject({ code: 'DRAFT_CONFLICT', details: { serverRevision: 2, clientRevision: 1 } });
    expect((await t.app.selectFrom('campaign_drafts').select('revision').where('id', '=', E.draftId).executeTakeFirstOrThrow()).revision).toBe(2);
    await op.logout();
  });

  it('3 · OPERATOR: sube assets válidos; ffprobe los valida de verdad; quedan identificados por SHA-256 [§48.4] [§48.5] [§48.6]', async () => {
    const op = await login('op');
    const subir = async (fixture: string, surfaceType: string) => {
      const bytes = readFileSync(fx(fixture));
      const r = await multipart(op, '/api/v1/assets', [['surfaceType', surfaceType], ['file', bytes, fixture, 'video/mp4']], clave());
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const a = AssetResponseSchema.parse(r.body);
      expect(a.status).toBe('READY');
      expect(a.sha256).toBe(sha256(bytes)); // §48.6: el id de contenido es el SHA-256 de los bytes subidos
      return { a, bytes };
    };
    const m = await subir('valid_towers_ab_25.mp4', 'towers_ab');
    const h = await subir('valid_horizontal_30.mp4', 'horizontal');
    // §48.5: los metadatos vienen de ffprobe sobre el archivo real
    expect(m.a).toMatchObject({ container: 'MP4', mimeType: 'video/mp4', width: 2592, height: 576, fps: 25, codec: 'H264' });
    expect(h.a).toMatchObject({ width: 1920, height: 412, fps: 30, codec: 'H264' });
    expect(m.a.durationMs).toBeGreaterThan(0);
    E.master = { id: m.a.id, sha256: m.a.sha256!, w: 2592, h: 576, ms: m.a.durationMs! };
    E.horizontal = { id: h.a.id, sha256: h.a.sha256!, w: 1920, h: 412, ms: h.a.durationMs! };

    // un archivo que no es video lo rechaza la validación real (no la extensión)
    const falso = await multipart(op, '/api/v1/assets', [['surfaceType', 'horizontal'], ['file', Buffer.from('no soy un mp4'), 'trucho.mp4', 'video/mp4']], clave());
    expect(falso.status).toBe(422);
    expect(falso.body).toMatchObject({ code: 'ASSET_CORRUPT', details: { asset: { status: 'REJECTED' } } });

    // el draft referencia los assets subidos; se guarda otra vez por el repositorio del Builder
    const d = PRESET_TAKEOVER_15S();
    E.draft = { ...d, name: 'para aprobar', surfaces: { ...d.surfaces, masterAssetId: E.master.id, horizontalAssetId: E.horizontal.id } };
    const ses = await connectBuilderBackend({ baseUrl: base, fetch: op.fetch, storage: new MemoryDraftStorage() });
    await ses.open(E.campaignId!);
    const r = await ses.save(E.draft);
    expect(r).toMatchObject({ kind: 'saved', revision: 3 });
    E.revisionSubmit = 3;
    await op.logout();
  });

  it('4 · OPERATOR: submit → el servidor recompila, corre el preflight y crea la ShowVersion con hash determinista [§48.7] [§48.8] [§48.9] [§48.10] [§48.11]', async () => {
    const op = await login('op');
    const r = await op.json('POST', `/api/v1/campaigns/${E.campaignId}/submit`, { draftRevision: E.revisionSubmit }, { 'idempotency-key': clave() });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const v = ShowVersionResponseSchema.parse(r.body);
    expect(v).toMatchObject({ campaignId: E.campaignId, contractId: E.contractId, versionNumber: 1, status: 'SUBMITTED', submittedBy: ID.op, sourceDraftId: E.draftId, sourceDraftRevision: 3, approval: null });
    expect(v.assets).toEqual([
      { logicalRef: 'horizontalAssetId', assetId: E.horizontal!.id, sha256: E.horizontal!.sha256 },
      { logicalRef: 'masterAssetId', assetId: E.master!.id, sha256: E.master!.sha256 },
    ]);
    // §48.8/9/11: el mismo compilador + preflight, corridos acá, dan el mismo hash
    const esperado = hashEsperado(E.draft!, [
      { slot: 'masterAssetId', ...E.master! },
      { slot: 'horizontalAssetId', ...E.horizontal! },
    ]);
    expect(esperado.exportable).toBe(true);
    expect(v.versionHash).toBe(esperado.hash);
    // el paquete guardado es el compilado por el servidor y referencia contenido, no ids
    const row = await t.app.selectFrom('show_versions').select('show_package').where('id', '=', v.id).executeTakeFirstOrThrow();
    expect(JSON.stringify(row.show_package)).toContain(assetSourceFor(E.master!.sha256));
    expect(JSON.stringify(row.show_package)).not.toContain(E.master!.id);
    E.versionId = v.id;
    E.versionHash = v.versionHash;
    // el submitter no puede aprobar su propia versión (cuatro ojos): ni siquiera tiene el rol
    const propio = await op.json('POST', `/api/v1/show-versions/${v.id}/approve`, { evidenceId: v.id, versionHash: v.versionHash }, { 'idempotency-key': clave() });
    expect(propio.status).toBe(403);
    await op.logout();
  });

  it('5 · INTERNAL_APPROVER (otro usuario): login → ve la versión → adjunta evidencia → aprueba el hash exacto → logout [§48.12] [§48.13] [§48.14]', async () => {
    const apr = await login('apr');
    const leida = await apr.json('GET', `/api/v1/show-versions/${E.versionId}`);
    expect(leida.status).toBe(200);
    expect(ShowVersionResponseSchema.parse(leida.body)).toMatchObject({ status: 'SUBMITTED', versionHash: E.versionHash });

    const ev = await multipart(apr, `/api/v1/show-versions/${E.versionId}/evidence`, [['type', 'PDF'], ['file', PDF, 'ok-cliente.pdf', 'application/pdf']], clave());
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    const evidencia = EvidenceResponseSchema.parse(ev.body);
    expect(evidencia.sha256).toBe(sha256(PDF));
    E.evidenceId = evidencia.id;

    // un hash que no es el de la versión no se aprueba (§48.14)
    const otroHash = await apr.json('POST', `/api/v1/show-versions/${E.versionId}/approve`, { evidenceId: E.evidenceId, versionHash: 'f'.repeat(64) }, { 'idempotency-key': clave() });
    expect(otroHash.status).toBe(409);

    const ok = await apr.json('POST', `/api/v1/show-versions/${E.versionId}/approve`, { evidenceId: E.evidenceId, versionHash: E.versionHash }, { 'idempotency-key': clave() });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const aprobada = ShowVersionResponseSchema.parse(ok.body);
    expect(aprobada).toMatchObject({ status: 'APPROVED', versionHash: E.versionHash, approval: { decision: 'APPROVED', actorUserId: ID.apr, evidenceId: E.evidenceId, versionHash: E.versionHash } });
    expect(ID.apr).not.toBe(ID.op);

    // §48.13: la evidencia queda congelada — la fila no se puede cambiar ni borrar, y el blob es el subido
    await expect(sql`UPDATE approval_evidence SET type = type WHERE id = ${E.evidenceId}`.execute(t.owner as never)).rejects.toThrow();
    await expect(sql`DELETE FROM approval_evidence WHERE id = ${E.evidenceId}`.execute(t.owner as never)).rejects.toThrow();
    const bajada = await apr.fetch(`${base}/api/v1/show-versions/${E.versionId}/evidence/${E.evidenceId}`);
    expect(bajada.status).toBe(200);
    expect(sha256(Buffer.from(await bajada.arrayBuffer()))).toBe(sha256(PDF));
    await apr.logout();
  });

  it('6 · OPERATOR: la campaña muestra APPROVED VERSION con el hash exacto y el WORKING DRAFT aparte [§48.16]', async () => {
    const op = await login('op');
    const c = await op.json('GET', `/api/v1/campaigns/${E.campaignId}`);
    const campania = CampaignResponseSchema.parse(c.body);
    expect(campania.latestApprovedVersion).toEqual({ id: E.versionId, versionNumber: 1, versionHash: E.versionHash });
    expect(campania.currentDraft).toMatchObject({ id: E.draftId, revision: 3 });
    expect(campania.currentDraft!.id).not.toBe(campania.latestApprovedVersion!.id);
    // lo mismo que ve el indicador del Builder (D3)
    const ses = await connectBuilderBackend({ baseUrl: base, fetch: op.fetch, storage: new MemoryDraftStorage() });
    await ses.open(E.campaignId!);
    expect(ses.view()).toMatchObject({ revision: 3, approvedVersion: { id: E.versionId, versionNumber: 1, versionHash: E.versionHash } });
    await op.logout();
  });

  it('7 · OPERATOR: edita la campaña; la versión aprobada NO cambia (ni la fila ni el hash) [§48.10] [§48.15] [§48.16]', async () => {
    const antes = await t.app.selectFrom('show_versions').selectAll().where('id', '=', E.versionId!).executeTakeFirstOrThrow();
    const aprobacionAntes = await t.app.selectFrom('approvals').selectAll().where('show_version_id', '=', E.versionId!).execute();
    const op = await login('op');
    const ses = await connectBuilderBackend({ baseUrl: base, fetch: op.fetch, storage: new MemoryDraftStorage() });
    await ses.open(E.campaignId!);
    expect(await ses.save({ ...E.draft!, name: 'segunda ola', notes: 'cambio después de aprobar' })).toMatchObject({ kind: 'saved', revision: 4 });
    const c = CampaignResponseSchema.parse((await op.json('GET', `/api/v1/campaigns/${E.campaignId}`)).body);
    expect(c.currentDraft).toMatchObject({ revision: 4 });
    expect(c.latestApprovedVersion).toEqual({ id: E.versionId, versionNumber: 1, versionHash: E.versionHash });
    expect(await t.app.selectFrom('show_versions').selectAll().where('id', '=', E.versionId!).executeTakeFirstOrThrow()).toEqual(antes);
    expect(await t.app.selectFrom('approvals').selectAll().where('show_version_id', '=', E.versionId!).execute()).toEqual(aprobacionAntes);
    const v = ShowVersionResponseSchema.parse((await op.json('GET', `/api/v1/show-versions/${E.versionId}`)).body);
    expect(v).toMatchObject({ status: 'APPROVED', versionHash: E.versionHash, sourceDraftRevision: 3 });
    await op.logout();
  });

  it('8 · audit: verifyChain OK y cada evento esperado con el actor del rol que corresponde [§48.17]', async () => {
    const cadena = await verifyChain(t.app);
    expect(cadena.ok).toBe(true);
    const ev = await t.app.selectFrom('audit_events').select(['action', 'actor_user_id', 'entity_id']).orderBy('seq').execute();
    const de = (action: string) => ev.filter((e) => e.action === action);
    const actores = (action: string) => [...new Set(de(action).map((e) => e.actor_user_id))];
    expect(actores('AUTH_LOGIN_SUCCEEDED').sort()).toEqual([ID.admin, ID.op, ID.apr].sort());
    expect(actores('ADVERTISER_CREATED')).toEqual([ID.admin]);
    expect(actores('CONTRACT_CREATED')).toEqual([ID.admin]);
    expect(actores('CAMPAIGN_CREATED')).toEqual([ID.op]);
    expect(de('DRAFT_UPDATED').filter((e) => e.entity_id === E.draftId)).toHaveLength(3); // rev 2, 3 y 4; el 409 no escribió
    expect(actores('DRAFT_UPDATED')).toEqual([ID.op]);
    expect(actores('ASSET_UPLOADED')).toEqual([ID.op]);
    expect(de('ASSET_VALIDATED').map((e) => e.entity_id)).toEqual(expect.arrayContaining([E.master!.id, E.horizontal!.id]));
    expect(de('VERSION_SUBMITTED')).toEqual([{ action: 'VERSION_SUBMITTED', actor_user_id: ID.op, entity_id: E.versionId }]);
    expect(actores('EVIDENCE_UPLOADED')).toEqual([ID.apr]);
    expect(de('VERSION_APPROVED')).toEqual([{ action: 'VERSION_APPROVED', actor_user_id: ID.apr, entity_id: E.versionId }]);
  });

  it('ningún endpoint puede modificar una ShowVersion, y la base lo rechaza aunque alguien lo intente [§48.18]', async () => {
    const sobreVersiones = rutas.filter((r) => r.url.startsWith('/api/v1/show-versions'));
    const escrituras = sobreVersiones.filter((r) => r.method !== 'GET' && r.method !== 'HEAD');
    // las únicas escrituras crean filas NUEVAS (evidencia, decisión); ninguna es PUT/PATCH/DELETE
    expect(escrituras.map((r) => `${r.method} ${r.url}`).sort()).toEqual([
      'POST /api/v1/show-versions/:id/approve',
      'POST /api/v1/show-versions/:id/evidence',
      'POST /api/v1/show-versions/:id/reject',
    ]);
    expect(rutas.some((r) => ['PUT', 'PATCH', 'DELETE'].includes(r.method) && r.url.includes('version'))).toBe(false);
    await expect(sql`UPDATE show_versions SET compiler_version = 'x' WHERE id = ${E.versionId}`.execute(t.owner as never)).rejects.toThrow();
    await expect(sql`DELETE FROM show_versions WHERE id = ${E.versionId}`.execute(t.owner as never)).rejects.toThrow();
  });
});
