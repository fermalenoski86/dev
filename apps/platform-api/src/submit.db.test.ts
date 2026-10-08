import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { assetSourceFor } from '@trust/platform-approval';
import { AUDIT_LOCK_KEY, verifyChain } from '@trust/platform-audit';
import { type Role, createUser, issueSession } from '@trust/platform-auth';
import { computeVersionHash } from '@trust/platform-contracts';
import { LOCK_FILA, type TestDatabase, createTestDatabase, esperarBloqueados, retenerTransaccion, seedContract, seedStoredObject } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import { AssetRegistry, PRESET_TAKEOVER_15S, type TakeoverDraft, validateDraft } from '@trust/show-authoring';
import { DEMO_SCENES, EL_TRUST } from '@trust/show-engine';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_DEV, SessionActorProvider } from './actor';
import { buildApp } from './app';
import { ErrorResponseSchema, EvidenceResponseSchema, ShowVersionResponseSchema } from './contracts';

/**
 * C3 — submit server-side sobre un Draft persistido: Fastify real + PostgreSQL
 * real + compilador y preflight reales + sesiones reales. Sin UI (Fase D).
 */
let t: TestDatabase;
let root: string;
let app: FastifyInstance;
const logs: string[] = [];
const logStream = new Writable({ write(c, _e, cb) { logs.push(String(c)); cb(); } });
const PW = 'correct horse battery staple';
type Who = { id: string; cookie: string; csrf: string };
const U: Record<string, Who> = {};
let contrato: string;

async function usuario(nombre: string, roles: Array<{ role: Role; contractId?: string }>): Promise<Who> {
  const u = await createUser(t.app, { name: nombre, email: `${nombre}-${Math.random().toString(36).slice(2, 8)}@affinitas.com`, password: PW, organization: 'Affinitas', roles });
  const s = await issueSession(t.app, u.id, 60 * 60_000);
  return { id: u.id, cookie: `${SESSION_COOKIE_DEV}=${s.token}`, csrf: s.csrfToken };
}

beforeAll(async () => {
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-c3-'));
  const storage = await LocalDiskStorage.open(path.join(root, 'store'));
  contrato = (await seedContract(t.app)).id;
  U.op = await usuario('op', [{ role: 'OPERATOR' }]);
  U.op2 = await usuario('op2', [{ role: 'OPERATOR' }]);
  U.apr = await usuario('apr', [{ role: 'INTERNAL_APPROVER' }]);
  app = await buildApp({
    db: t.app, storage, media: mediaRuntimeFromEnv({}), maxUploadBytes: 1024 * 1024, maxEvidenceBytes: 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName: SESSION_COOKIE_DEV, externalApprovalEnabled: false }), log: { stream: logStream },
  });
});
afterAll(async () => {
  await app?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

/** Asset READY por el camino real de transiciones (UPLOADING → VALIDATING → READY). */
async function assetReady(surface: string, width: number, height: number, contenido = `m-${Math.random()}`, objeto?: { storedObjectId: string; sha256: string }) {
  const o = objeto ?? (await seedStoredObject(t.app, contenido));
  const a = await t.app.insertInto('assets').values({ original_filename: `${surface}.mp4`, surface_type: surface, created_by: U.op!.id }).returning('id').executeTakeFirstOrThrow();
  await t.app.updateTable('assets').set({ status: 'VALIDATING', stored_object_id: o.storedObjectId, sha256: o.sha256, container: 'MP4', mime_type: 'video/mp4', size_bytes: 1000, width, height, fps: 25, codec: 'h264', duration_ms: 30000 }).where('id', '=', a.id).execute();
  await t.app.updateTable('assets').set({ status: 'READY' }).where('id', '=', a.id).execute();
  return { id: a.id, sha256: o.sha256, storedObjectId: o.storedObjectId };
}
const master = (c?: string, o?: { storedObjectId: string; sha256: string }) => assetReady('towers_ab', 2592, 576, c, o);
const horizontal = (c?: string, o?: { storedObjectId: string; sha256: string }) => assetReady('horizontal', 1920, 412, c, o);

function draftCon(masterId: string, horizontalId: string, cambios: Partial<TakeoverDraft> = {}): TakeoverDraft {
  const d = PRESET_TAKEOVER_15S();
  return { ...d, ...cambios, surfaces: { ...d.surfaces, masterAssetId: masterId, horizontalAssetId: horizontalId, ...(cambios.surfaces ?? {}) } };
}

async function campania(draft: unknown, contractId = contrato) {
  return t.app.transaction().execute(async (trx) => {
    const c = await trx.insertInto('campaigns').values({ contract_id: contractId, name: 'Launch' }).returning('id').executeTakeFirstOrThrow();
    const d = await trx.insertInto('campaign_drafts').values({ campaign_id: c.id, takeover_draft: JSON.stringify(draft), created_by: U.op!.id }).returning('id').executeTakeFirstOrThrow();
    await trx.updateTable('campaigns').set({ current_draft_id: d.id }).where('id', '=', c.id).execute();
    return { campaignId: c.id, draftId: d.id };
  });
}
async function campaniaOk() {
  const m = await master();
  const h = await horizontal();
  const draft = draftCon(m.id, h.id);
  return { ...(await campania(draft)), m, h, draft };
}

let n = 0;
const k = () => `submit-${Date.now()}-${n++}`;
const enviar = (campaignId: string, who: Who, draftRevision: unknown = 1, key: string | null = k(), extra: Record<string, string> = {}) =>
  app.inject({
    method: 'POST', url: `/api/v1/campaigns/${campaignId}/submit`,
    headers: { cookie: who.cookie, 'x-csrf-token': who.csrf, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}), ...extra },
    payload: JSON.stringify({ draftRevision }),
  });
const esError = (b: unknown, code: string) => expect(ErrorResponseSchema.parse(b).code).toBe(code);
const versiones = async (campaignId: string) => (await t.app.selectFrom('show_versions').select(['id', 'version_number']).where('campaign_id', '=', campaignId).execute()).length;

/** Lo que el servidor tiene que calcular, recomputado acá con el mismo compilador/preflight. */
function hashEsperado(draft: TakeoverDraft, assets: Array<{ slot: string; id: string; sha256: string; w: number; h: number }>) {
  const reg = new AssetRegistry(assets.map((a) => ({ id: a.id, name: a.slot, type: 'video' as const, source: assetSourceFor(a.sha256), width: a.w, height: a.h, durationMs: 30000, tags: [], unmanaged: false })));
  const v = validateDraft(draft, { building: EL_TRUST, assets: reg, sceneIds: new Set(DEMO_SCENES.keys()), preflight: { building: EL_TRUST, scenes: DEMO_SCENES } });
  expect(v.exportable).toBe(true);
  return computeVersionHash(v.compile.showPackage, assets.map((a) => ({ logicalRef: a.slot, sha256: a.sha256 }))).versionHash;
}

describe('CRITERIO C3: POST /api/v1/campaigns/:id/submit — camino feliz', () => {
  it('compila y corre preflight server-side, crea la ShowVersion SUBMITTED con hash determinista, manifiesto y audit', async () => {
    const c = await campaniaOk();
    const r = await enviar(c.campaignId, U.op!);
    expect(r.statusCode, r.body).toBe(201);
    const v = ShowVersionResponseSchema.parse(r.json());
    expect(v).toMatchObject({ campaignId: c.campaignId, contractId: contrato, versionNumber: 1, status: 'SUBMITTED', submittedBy: U.op!.id, sourceDraftId: c.draftId, sourceDraftRevision: 1, compilerVersion: '0.1.0' });
    expect(v.assets).toEqual([
      { logicalRef: 'horizontalAssetId', assetId: c.h.id, sha256: c.h.sha256 },
      { logicalRef: 'masterAssetId', assetId: c.m.id, sha256: c.m.sha256 },
    ]);
    expect(v.versionHash).toBe(hashEsperado(c.draft, [
      { slot: 'masterAssetId', id: c.m.id, sha256: c.m.sha256, w: 2592, h: 576 },
      { slot: 'horizontalAssetId', id: c.h.id, sha256: c.h.sha256, w: 1920, h: 412 },
    ]));
    // el paquete guardado referencia el CONTENIDO, no UUIDs ni nombres
    const row = await t.app.selectFrom('show_versions').select('show_package').where('id', '=', v.id).executeTakeFirstOrThrow();
    const pkg = JSON.stringify(row.show_package);
    expect(pkg).toContain(assetSourceFor(c.m.sha256));
    expect(pkg).not.toContain(c.m.id);
    const audit = await t.app.selectFrom('audit_events').select(['action', 'actor_user_id', 'after_hash']).where('entity_id', '=', v.id).execute();
    expect(audit).toEqual([{ action: 'VERSION_SUBMITTED', actor_user_id: U.op!.id, after_hash: v.versionHash }]);
  });

  it('mismo draft y mismos bytes en dos campañas (assets distintos, mismo contenido) → mismo hash, dos versiones', async () => {
    const o1 = await seedStoredObject(t.app, `master-compartido-${Math.random()}`);
    const o2 = await seedStoredObject(t.app, `horizontal-compartido-${Math.random()}`);
    const hashes: string[] = [];
    for (let i = 0; i < 2; i++) {
      const m = await master(undefined, o1);
      const h = await horizontal(undefined, o2);
      const c = await campania(draftCon(m.id, h.id));
      const r = await enviar(c.campaignId, U.op!);
      expect(r.statusCode, r.body).toBe(201);
      hashes.push(ShowVersionResponseSchema.parse(r.json()).versionHash);
    }
    expect(hashes[0]).toBe(hashes[1]);
  });
});

describe('CRITERIO C3: idempotencia y transiciones', () => {
  it('retry con la misma key → 200 con la misma versión; en paralelo tampoco duplica', async () => {
    const c = await campaniaOk();
    const key = k();
    const a = await enviar(c.campaignId, U.op!, 1, key);
    const b = await enviar(c.campaignId, U.op!, 1, key);
    expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.json()).toEqual(a.json());
    expect(await versiones(c.campaignId)).toBe(1);

    const c2 = await campaniaOk();
    const key2 = k();
    const rs = await Promise.all([1, 2, 3].map(() => enviar(c2.campaignId, U.op!, 1, key2)));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
    expect(await versiones(c2.campaignId)).toBe(1);
  });

  it('la misma revisión con otra key → 409; otro operador a la vez → una sola versión', async () => {
    const c = await campaniaOk();
    expect((await enviar(c.campaignId, U.op!)).statusCode).toBe(201);
    const otra = await enviar(c.campaignId, U.op2!);
    expect(otra.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(otra.json())).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { versionNumber: 1 } });

    const c2 = await campaniaOk();
    const rs = await Promise.all([U.op!, U.op2!].map((w) => enviar(c2.campaignId, w)));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await versiones(c2.campaignId)).toBe(1);
  });

  it('revisión vieja → 409 DRAFT_REVISION_MISMATCH; editar el draft → nueva versión; la aprobada NO cambia', async () => {
    const c = await campaniaOk();
    const v1 = ShowVersionResponseSchema.parse((await enviar(c.campaignId, U.op!)).json());
    // aprobar v1 de verdad (evidencia + approve por otra persona)
    const fd = new FormData();
    fd.append('type', 'PDF');
    fd.append('file', new Blob([new Uint8Array(Buffer.from(`%PDF-1.7\n% ${Math.random()}\n%%EOF\n`))]), 'ok.pdf');
    const req = new Request('http://local/', { method: 'POST', body: fd });
    const ev = await app.inject({
      method: 'POST', url: `/api/v1/show-versions/${v1.id}/evidence`, payload: Buffer.from(await req.arrayBuffer()),
      headers: { 'content-type': req.headers.get('content-type') as string, cookie: U.apr!.cookie, 'x-csrf-token': U.apr!.csrf, 'idempotency-key': k() },
    });
    expect(ev.statusCode, ev.body).toBe(201);
    const ap = await app.inject({
      method: 'POST', url: `/api/v1/show-versions/${v1.id}/approve`, payload: JSON.stringify({ evidenceId: EvidenceResponseSchema.parse(ev.json()).id, versionHash: v1.versionHash }),
      headers: { 'content-type': 'application/json', cookie: U.apr!.cookie, 'x-csrf-token': U.apr!.csrf, 'idempotency-key': k() },
    });
    expect(ap.statusCode, ap.body).toBe(201);
    const antes = await t.app.selectFrom('show_versions').selectAll().where('id', '=', v1.id).executeTakeFirstOrThrow();

    // edición del draft (revisión 1 → 2)
    const editado = { ...c.draft, name: 'Takeover 15 s — v2', moments: c.draft.moments.map((m, i) => (i === 0 ? { ...m, durationMs: 4000 } : m)) };
    await t.app.updateTable('campaign_drafts').set({ takeover_draft: JSON.stringify(editado), revision: 2 }).where('id', '=', c.draftId).execute();
    const vieja = await enviar(c.campaignId, U.op!, 1);
    expect(vieja.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(vieja.json())).toMatchObject({ code: 'DRAFT_REVISION_MISMATCH', details: { currentRevision: 2 } });
    const r2 = await enviar(c.campaignId, U.op!, 2);
    expect(r2.statusCode, r2.body).toBe(201);
    const v2 = ShowVersionResponseSchema.parse(r2.json());
    expect(v2).toMatchObject({ versionNumber: 2, sourceDraftRevision: 2, status: 'SUBMITTED' });
    expect(v2.versionHash).not.toBe(v1.versionHash);

    const despues = await t.app.selectFrom('show_versions').selectAll().where('id', '=', v1.id).executeTakeFirstOrThrow();
    expect(despues).toEqual(antes);
    const cp = await t.app.selectFrom('campaigns').select('latest_approved_version_id').where('id', '=', c.campaignId).executeTakeFirstOrThrow();
    expect(cp.latest_approved_version_id).toBe(v1.id);
  });

  it('campaña archivada → 409; inexistente → 404; sin draft → 409 DRAFT_NOT_FOUND', async () => {
    const c = await campaniaOk();
    await t.app.updateTable('campaigns').set({ lifecycle_status: 'ARCHIVED' }).where('id', '=', c.campaignId).execute();
    const arch = await enviar(c.campaignId, U.op!);
    expect(arch.statusCode).toBe(409);
    esError(arch.json(), 'INVALID_STATE_TRANSITION');
    const nada = await enviar('00000000-0000-4000-8000-000000000000', U.op!);
    expect(nada.statusCode).toBe(404);
    esError(nada.json(), 'CAMPAIGN_NOT_FOUND');
    const sinDraft = await t.app.insertInto('campaigns').values({ contract_id: contrato, name: 'Vacía' }).returning('id').executeTakeFirstOrThrow();
    const r = await enviar(sinDraft.id, U.op!);
    expect(r.statusCode).toBe(409);
    esError(r.json(), 'DRAFT_NOT_FOUND');
  });
});

describe('CRITERIO C3: preflight y assets server-side — sin versión si falla', () => {
  it('escena de cierre inexistente → 422 PREFLIGHT_FAILED con el código del compilador; no hay versión ni audit', async () => {
    const m = await master();
    const h = await horizontal();
    const c = await campania(draftCon(m.id, h.id, { closingSceneId: 'escena_que_no_existe' }));
    const r = await enviar(c.campaignId, U.op!);
    expect(r.statusCode).toBe(422);
    const b = ErrorResponseSchema.parse(r.json());
    expect(b.code).toBe('PREFLIGHT_FAILED');
    expect((b.details?.errors as Array<{ code: string }>).map((e) => e.code)).toContain('CLOSING_SCENE_NOT_FOUND');
    expect(await versiones(c.campaignId)).toBe(0);
  });

  it('asset con aspecto equivocado para su superficie → 422 PREFLIGHT_FAILED (ASPECT_MISMATCH), aunque el compilador sí arme el paquete', async () => {
    // horizontal 16:9: el compilador produce un ShowPackage, pero la validación de assets lo bloquea
    const m = await master();
    const h = await assetReady('horizontal', 1920, 1080);
    const c = await campania(draftCon(m.id, h.id));
    const r = await enviar(c.campaignId, U.op!);
    expect(r.statusCode).toBe(422);
    const errs = (ErrorResponseSchema.parse(r.json()).details?.errors ?? []) as Array<{ code: string }>;
    expect(errs.map((e) => e.code)).toContain('ASPECT_MISMATCH');
    expect(await versiones(c.campaignId)).toBe(0);
  });

  it('asset REJECTED, inexistente o id que no es de la plataforma → 422 ASSET_NOT_READY', async () => {
    const h = await horizontal();
    const rech = await t.app.insertInto('assets').values({ original_filename: 'x.mp4', surface_type: 'towers_ab', created_by: U.op!.id }).returning('id').executeTakeFirstOrThrow();
    await t.app.updateTable('assets').set({ status: 'REJECTED', rejection_code: 'ASSET_BAD_FPS' }).where('id', '=', rech.id).execute();
    for (const masterId of [rech.id, '00000000-0000-4000-8000-000000000000', 'test_towers_master']) {
      const c = await campania(draftCon(masterId, h.id));
      const r = await enviar(c.campaignId, U.op!);
      expect(r.statusCode, masterId).toBe(422);
      expect(ErrorResponseSchema.parse(r.json())).toMatchObject({ code: 'ASSET_NOT_READY', details: { logicalRef: 'masterAssetId' } });
      expect(await versiones(c.campaignId)).toBe(0);
    }
  });

  it('asset VALIDATING con toda la metadata no entra: solo READY → 422 ASSET_NOT_READY', async () => {
    const h = await horizontal();
    const o = await seedStoredObject(t.app, `validando-${Math.random()}`);
    const a = await t.app.insertInto('assets').values({ original_filename: 'm.mp4', surface_type: 'towers_ab', created_by: U.op!.id }).returning('id').executeTakeFirstOrThrow();
    await t.app.updateTable('assets').set({ status: 'VALIDATING', stored_object_id: o.storedObjectId, sha256: o.sha256, container: 'MP4', mime_type: 'video/mp4', size_bytes: 1000, width: 2592, height: 576, fps: 25, codec: 'h264', duration_ms: 30000 }).where('id', '=', a.id).execute();
    const c = await campania(draftCon(a.id, h.id));
    const r = await enviar(c.campaignId, U.op!);
    expect(r.statusCode).toBe(422);
    expect(ErrorResponseSchema.parse(r.json())).toMatchObject({ code: 'ASSET_NOT_READY', details: { logicalRef: 'masterAssetId', status: 'VALIDATING' } });
  });

  it('asset de otra superficie en la ranura → 422 ASSET_SURFACE_MISMATCH', async () => {
    const h = await horizontal();
    const h2 = await horizontal();
    const c = await campania(draftCon(h2.id, h.id));
    const r = await enviar(c.campaignId, U.op!);
    expect(r.statusCode).toBe(422);
    expect(ErrorResponseSchema.parse(r.json())).toMatchObject({ code: 'ASSET_SURFACE_MISMATCH', details: { logicalRef: 'masterAssetId', expected: 'towers_ab', actual: 'horizontal' } });
  });

  it('§6 (D1): el contrato vigente no incluye una pantalla que el draft usa → 422 SURFACE_NOT_CONTRACTED, sin versión', async () => {
    const soloTorres = (await seedContract(t.app)).id;
    await t.app.updateTable('contracts').set({ allowed_surfaces: ['screen_a', 'screen_b'] }).where('id', '=', soloTorres).execute();
    const m = await master();
    const h = await horizontal();
    const c = await campania(draftCon(m.id, h.id), soloTorres);
    const r = await enviar(c.campaignId, U.op!);
    expect(r.statusCode).toBe(422);
    expect(ErrorResponseSchema.parse(r.json())).toMatchObject({ code: 'SURFACE_NOT_CONTRACTED', details: { screens: ['horizontal'] } });
    expect(await versiones(c.campaignId)).toBe(0);
  });

  it('§6 bajo concurrencia (AUDIT D1 P1): recorte sin confirmar del contrato → el submit espera el lock y, tras el commit, falla SURFACE_NOT_CONTRACTED', async () => {
    const ct = (await seedContract(t.app)).id;
    const m = await master();
    const h = await horizontal();
    const c = await campania(draftCon(m.id, h.id), ct);
    const recorte = await retenerTransaccion(t.app, (trx) =>
      trx.updateTable('contracts').set({ allowed_surfaces: ['screen_a', 'screen_b'] }).where('id', '=', ct).execute());
    let pendiente: ReturnType<typeof enviar> | undefined;
    try {
      pendiente = enviar(c.campaignId, U.op!);
      await esperarBloqueados(t.app, LOCK_FILA);
    } finally {
      await recorte.soltar();
    }
    const r = await pendiente!;
    expect(r.statusCode, r.body).toBe(422);
    expect(ErrorResponseSchema.parse(r.json())).toMatchObject({ code: 'SURFACE_NOT_CONTRACTED', details: { screens: ['horizontal'] } });
    expect(await versiones(c.campaignId)).toBe(0);
  });

  it('§6 bajo concurrencia (AUDIT D1 P1): submit en curso → el recorte del contrato espera su commit; queda serializado submit → recorte', async () => {
    const ct = (await seedContract(t.app)).id;
    const m = await master();
    const h = await horizontal();
    const c = await campania(draftCon(m.id, h.id), ct);
    // El lock del audit pausa al submit DESPUÉS de validar superficies y crear la versión, con el contrato en FOR SHARE.
    const audit = await retenerTransaccion(t.app, (trx) => sql`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`.execute(trx));
    let sub: ReturnType<typeof enviar> | undefined;
    let recorte: Promise<unknown> | undefined;
    try {
      sub = enviar(c.campaignId, U.op!);
      await esperarBloqueados(t.app, ['advisory']);
      // mismo SQL que el PATCH de contrato: FOR UPDATE de la fila y UPDATE
      recorte = t.app.transaction().execute(async (trx) => {
        await trx.selectFrom('contracts').select('id').where('id', '=', ct).forUpdate().execute();
        await trx.updateTable('contracts').set({ allowed_surfaces: ['screen_a', 'screen_b'] }).where('id', '=', ct).execute();
      });
      await esperarBloqueados(t.app, LOCK_FILA);
    } finally {
      await audit.soltar();
    }
    const r = await sub!;
    await recorte!;
    expect(r.statusCode, r.body).toBe(201);
    expect(await versiones(c.campaignId)).toBe(1);
    const fila = await t.app.selectFrom('contracts').select('allowed_surfaces').where('id', '=', ct).executeTakeFirstOrThrow();
    expect(fila.allowed_surfaces).toEqual(['screen_a', 'screen_b']);
  });

  it('draft guardado que no es un TakeoverDraft → 422 DRAFT_INVALID', async () => {
    const c = await campania({ name: 'no soy un draft' });
    const r = await enviar(c.campaignId, U.op!);
    expect(r.statusCode).toBe(422);
    esError(r.json(), 'DRAFT_INVALID');
  });
});

describe('CRITERIO C3: autorización y contrato HTTP', () => {
  it('INTERNAL_APPROVER no envía (403); sin CSRF 403; sin Idempotency-Key 400; revisión inválida 400', async () => {
    const c = await campaniaOk();
    const apr = await enviar(c.campaignId, U.apr!);
    expect(apr.statusCode).toBe(403);
    esError(apr.json(), 'FORBIDDEN');
    const sinCsrf = await app.inject({ method: 'POST', url: `/api/v1/campaigns/${c.campaignId}/submit`, headers: { cookie: U.op!.cookie, 'content-type': 'application/json', 'idempotency-key': k() }, payload: '{"draftRevision":1}' });
    expect(sinCsrf.statusCode).toBe(403);
    esError(sinCsrf.json(), 'CSRF_TOKEN_INVALID');
    const sinKey = await enviar(c.campaignId, U.op!, 1, null);
    expect(sinKey.statusCode).toBe(400);
    esError(sinKey.json(), 'IDEMPOTENCY_KEY_REQUIRED');
    expect((await enviar(c.campaignId, U.op!, 0)).statusCode).toBe(400);
    expect((await enviar(c.campaignId, U.op!, '1')).statusCode).toBe(400);
    expect(await versiones(c.campaignId)).toBe(0);
  });

  it('verifyChain OK al final', async () => {
    const r = await verifyChain(t.app);
    expect(r.problems).toEqual([]);
  });
});
