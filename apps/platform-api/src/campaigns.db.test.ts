import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { draftHash } from '@trust/platform-campaigns';
import { AUDIT_LOCK_KEY, verifyChain } from '@trust/platform-audit';
import { type Role, createUser, issueSession } from '@trust/platform-auth';
import { sql } from 'kysely';
import { LOCK_FILA, type TestDatabase, createTestDatabase, esperarBloqueados, retenerTransaccion, seedApproval, seedVersion, sha } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import { PRESET_EMPTY, PRESET_TAKEOVER_15S, type TakeoverDraft } from '@trust/show-authoring';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_DEV, SessionActorProvider } from './actor';
import { buildApp } from './app';
import {
  AdvertiserResponseSchema,
  CampaignResponseSchema,
  ContractResponseSchema,
  DraftResponseSchema,
  ErrorResponseSchema,
  pageOf,
} from './contracts';

/**
 * D1 — Advertiser / Contract / Campaign / Draft por HTTP: Fastify real +
 * PostgreSQL real + sesiones reales (cookie + CSRF). Concurrencia optimista (§8–9)
 * y superficies del contrato (§6).
 */
let t: TestDatabase;
let root: string;
let app: FastifyInstance;
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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-d1-'));
  const storage = await LocalDiskStorage.open(path.join(root, 'store'));
  U.admin = await usuario('admin', [{ role: 'ADMIN' }]);
  U.op = await usuario('op', [{ role: 'OPERATOR' }]);
  U.op2 = await usuario('op2', [{ role: 'OPERATOR' }]);
  U.apr = await usuario('apr', [{ role: 'INTERNAL_APPROVER' }]);
  app = await buildApp({
    db: t.app, storage, media: mediaRuntimeFromEnv({}), maxUploadBytes: 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName: SESSION_COOKIE_DEV, externalApprovalEnabled: false }), log: { stream: logStream },
  });
});
afterAll(async () => {
  await app?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, who: Who, body?: unknown, o: { csrf?: boolean } = {}) =>
  app.inject({
    method, url,
    headers: { cookie: who.cookie, ...(o.csrf === false ? {} : { 'x-csrf-token': who.csrf }), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
const esError = (b: unknown, code: string) => expect(ErrorResponseSchema.parse(b).code).toBe(code);
let n = 0;
const cuit = () => `30-${Date.now()}${n++}-1`;

async function anunciante() {
  const r = await req('POST', '/api/v1/advertisers', U.admin!, { legalName: 'Arcos Dorados SA', taxId: cuit() });
  expect(r.statusCode, r.body).toBe(201);
  return AdvertiserResponseSchema.parse(r.json());
}
async function contrato(allowedSurfaces = ['screen_a', 'screen_b', 'horizontal']) {
  const adv = await anunciante();
  const r = await req('POST', '/api/v1/contracts', U.admin!, { advertiserId: adv.id, name: 'Takeover 2026', startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z', allowedSurfaces });
  expect(r.statusCode, r.body).toBe(201);
  return ContractResponseSchema.parse(r.json());
}
async function campania(contractId: string, takeoverDraft?: unknown, who: Who = U.op!) {
  return req('POST', '/api/v1/campaigns', who, { contractId, name: 'Launch', ...(takeoverDraft !== undefined ? { takeoverDraft } : {}) });
}
async function campaniaOk(surfaces?: string[], takeoverDraft?: unknown) {
  const ct = await contrato(surfaces);
  const r = await campania(ct.id, takeoverDraft);
  expect(r.statusCode, r.body).toBe(201);
  return { ct, cp: CampaignResponseSchema.parse(r.json()) };
}
const leerDraft = async (campaignId: string) => DraftResponseSchema.parse((await req('GET', `/api/v1/campaigns/${campaignId}/draft`, U.op!)).json());
const putDraft = (campaignId: string, takeoverDraft: unknown, expectedRevision: unknown, who: Who = U.op!) =>
  req('PUT', `/api/v1/campaigns/${campaignId}/draft`, who, { takeoverDraft, expectedRevision });
const sinHorizontal = (): TakeoverDraft => {
  const d = PRESET_TAKEOVER_15S();
  return { ...d, moments: d.moments.map((m) => ({ ...m, screens: { ...m.screens, horizontal: { mode: 'hold' as const } } })) };
};
const audits = (entityId: string) => t.app.selectFrom('audit_events').select(['action', 'actor_user_id', 'before_hash', 'after_hash', 'metadata']).where('entity_id', '=', entityId).orderBy('seq').execute();

describe('CRITERIO D1: advertisers y contracts (§5, §6) — ADMIN escribe, internos leen', () => {
  it('ADMIN crea anunciante (201, audit sin datos comerciales); OPERATOR 403; CUIT repetido 409', async () => {
    const a = await anunciante();
    expect(await audits(a.id)).toEqual([expect.objectContaining({ action: 'ADVERTISER_CREATED', actor_user_id: U.admin!.id, metadata: {} })]);
    const op = await req('POST', '/api/v1/advertisers', U.op!, { legalName: 'X', taxId: cuit() });
    expect(op.statusCode).toBe(403);
    const dup = await req('POST', '/api/v1/advertisers', U.admin!, { legalName: 'Otro', taxId: a.taxId });
    expect(dup.statusCode).toBe(409);
    esError(dup.json(), 'ADVERTISER_EXISTS');
  });

  it('listas paginadas por cursor, más nuevos primero', async () => {
    for (let i = 0; i < 3; i++) await anunciante();
    const p1 = pageOf(AdvertiserResponseSchema).parse((await req('GET', '/api/v1/advertisers?limit=2', U.apr!)).json());
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBe(p1.items[1]?.id);
    const p2 = pageOf(AdvertiserResponseSchema).parse((await req('GET', `/api/v1/advertisers?limit=2&cursor=${p1.nextCursor}`, U.apr!)).json());
    expect(p2.items.map((x) => x.id)).not.toContain(p1.items[0]?.id);
  });

  it('contrato: superficies normalizadas contra el edificio, fechas válidas, anunciante existente', async () => {
    const adv = await anunciante();
    const base = { advertiserId: adv.id, name: 'C', startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z' };
    const ok = await req('POST', '/api/v1/contracts', U.admin!, { ...base, allowedSurfaces: ['screen_b', 'screen_a', 'screen_a'] });
    expect(ok.statusCode, ok.body).toBe(201);
    const c = ContractResponseSchema.parse(ok.json());
    expect(c).toMatchObject({ allowedSurfaces: ['screen_a', 'screen_b'], status: 'DRAFT', fourEyesRequired: true, externalApprovalEnabled: false });
    expect(await audits(c.id)).toEqual([expect.objectContaining({ action: 'CONTRACT_CREATED' })]);
    const mala = await req('POST', '/api/v1/contracts', U.admin!, { ...base, allowedSurfaces: ['screen_a', 'reloj'] });
    expect(mala.statusCode).toBe(422);
    expect(ErrorResponseSchema.parse(mala.json())).toMatchObject({ code: 'CONTRACT_INVALID', details: { invalid: ['reloj'] } });
    const fechas = await req('POST', '/api/v1/contracts', U.admin!, { ...base, endsAt: base.startsAt, allowedSurfaces: ['screen_a'] });
    expect(fechas.statusCode).toBe(422);
    const sinAdv = await req('POST', '/api/v1/contracts', U.admin!, { ...base, advertiserId: '00000000-0000-4000-8000-000000000000', allowedSurfaces: ['screen_a'] });
    expect(sinAdv.statusCode).toBe(404);
    expect((await req('POST', '/api/v1/contracts', U.op!, { ...base, allowedSurfaces: ['screen_a'] })).statusCode).toBe(403);
  });

  it('PATCH: ADMIN cambia nombre y superficies con CONTRACT_UPDATED; el anunciante no se cambia (400)', async () => {
    const c = await contrato();
    const r = await req('PATCH', `/api/v1/contracts/${c.id}`, U.admin!, { name: 'Renovado', allowedSurfaces: ['screen_a', 'screen_b'] });
    expect(r.statusCode, r.body).toBe(200);
    expect(ContractResponseSchema.parse(r.json())).toMatchObject({ name: 'Renovado', allowedSurfaces: ['screen_a', 'screen_b'] });
    const ev = await audits(c.id);
    expect(ev.map((e) => e.action)).toEqual(['CONTRACT_CREATED', 'CONTRACT_UPDATED']);
    expect((ev[1]?.metadata as { fields: string[] }).fields).toEqual(['allowedSurfaces', 'name']);
    expect((await req('PATCH', `/api/v1/contracts/${c.id}`, U.admin!, { advertiserId: c.advertiserId })).statusCode).toBe(400);
    expect((await req('PATCH', `/api/v1/contracts/${c.id}`, U.op!, { name: 'x' })).statusCode).toBe(403);
  });
});

describe('CRITERIO D1: campaigns (§7, §32)', () => {
  it('OPERATOR crea campaña con su draft inicial (rev 1) en la misma transacción; sin versión aprobada', async () => {
    const { ct, cp } = await campaniaOk();
    expect(cp).toMatchObject({ contractId: ct.id, name: 'Launch', lifecycleStatus: 'ACTIVE', currentDraft: { revision: 1 }, latestApprovedVersion: null });
    const d = await leerDraft(cp.id);
    expect(d).toMatchObject({ draftId: cp.currentDraft?.id, revision: 1 });
    expect(await audits(cp.id)).toEqual([expect.objectContaining({ action: 'CAMPAIGN_CREATED', actor_user_id: U.op!.id, after_hash: draftHash(d.takeoverDraft) })]);
  });

  it('INTERNAL_APPROVER no crea (403); contrato inexistente 404; draft inválido 422', async () => {
    const ct = await contrato();
    expect((await campania(ct.id, undefined, U.apr!)).statusCode).toBe(403);
    expect((await campania('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    const mala = await campania(ct.id, { no: 'soy un draft' });
    expect(mala.statusCode).toBe(422);
    esError(mala.json(), 'DRAFT_INVALID');
  });

  it('§6: crear con un draft que usa la horizontal en un contrato de solo torres → 422 SURFACE_NOT_CONTRACTED', async () => {
    const ct = await contrato(['screen_a', 'screen_b']);
    const r = await campania(ct.id, PRESET_TAKEOVER_15S());
    expect(r.statusCode).toBe(422);
    expect(ErrorResponseSchema.parse(r.json())).toMatchObject({ code: 'SURFACE_NOT_CONTRACTED', details: { screens: ['horizontal'] } });
    expect((await campania(ct.id, sinHorizontal())).statusCode).toBe(201);
  });

  it('§32: GET muestra la última versión APROBADA y, aparte, el draft de trabajo', async () => {
    const { cp } = await campaniaOk();
    const v = await seedVersion(t.app, { campaignId: cp.id, draftId: cp.currentDraft!.id, submittedBy: U.op!.id, versionHash: sha(`v-${Math.random()}`) });
    await seedApproval(t.app, v.id, U.apr!.id, 'APPROVED');
    await t.app.updateTable('campaigns').set({ latest_approved_version_id: v.id }).where('id', '=', cp.id).execute();
    const editado = await putDraft(cp.id, { ...PRESET_EMPTY(), name: 'después de aprobar' }, 1);
    expect(editado.statusCode, editado.body).toBe(200);
    const g = CampaignResponseSchema.parse((await req('GET', `/api/v1/campaigns/${cp.id}`, U.apr!)).json());
    expect(g).toMatchObject({ latestApprovedVersion: { id: v.id, versionNumber: 1 }, currentDraft: { id: cp.currentDraft!.id, revision: 2 } });
    const lista = pageOf(CampaignResponseSchema).parse((await req('GET', `/api/v1/campaigns?contractId=${cp.contractId}`, U.op!)).json());
    expect(lista.items.map((x) => x.id)).toEqual([cp.id]);
  });
});

describe('CRITERIO D1: draft con concurrencia optimista (§8, §9)', () => {
  it('PUT con la revisión vigente → rev+1 y DRAFT_UPDATED con hashes antes/después (nunca el JSON)', async () => {
    const { cp } = await campaniaOk();
    const antes = await leerDraft(cp.id);
    const nuevo = { ...PRESET_EMPTY(), name: 'v2' };
    const r = await putDraft(cp.id, nuevo, 1);
    expect(r.statusCode, r.body).toBe(200);
    expect(DraftResponseSchema.parse(r.json())).toMatchObject({ revision: 2, takeoverDraft: { name: 'v2' } });
    const ev = (await audits(cp.currentDraft!.id)).filter((e) => e.action === 'DRAFT_UPDATED');
    expect(ev).toEqual([expect.objectContaining({ actor_user_id: U.op!.id, before_hash: draftHash(antes.takeoverDraft), after_hash: draftHash(DraftResponseSchema.parse(r.json()).takeoverDraft) })]);
    expect(JSON.stringify(ev[0]?.metadata)).not.toContain('v2');
  });

  it('revisión vieja → 409 DRAFT_CONFLICT con serverRevision, clientRevision y serverUpdatedAt; el servidor NO se pisa', async () => {
    const { cp } = await campaniaOk();
    const ok = DraftResponseSchema.parse((await putDraft(cp.id, { ...PRESET_EMPTY(), name: 'del servidor' }, 1)).json());
    const viejo = await putDraft(cp.id, { ...PRESET_EMPTY(), name: 'offline' }, 1, U.op2!);
    expect(viejo.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(viejo.json())).toMatchObject({ code: 'DRAFT_CONFLICT', details: { serverRevision: 2, clientRevision: 1, serverUpdatedAt: ok.updatedAt } });
    const d = await leerDraft(cp.id);
    expect(d).toMatchObject({ revision: 2, takeoverDraft: { name: 'del servidor' } });
    // revisión del futuro también es conflicto, no un salto
    const futuro = await putDraft(cp.id, { ...PRESET_EMPTY(), name: 'x' }, 7);
    expect(futuro.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(futuro.json()).details).toMatchObject({ serverRevision: 2, clientRevision: 7 });
  });

  it('dos escrituras simultáneas sobre la misma revisión: exactamente una gana', async () => {
    const { cp } = await campaniaOk();
    const rs = await Promise.all([U.op!, U.op2!].map((w, i) => putDraft(cp.id, { ...PRESET_EMPTY(), name: `w${i}` }, 1, w)));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await leerDraft(cp.id)).revision).toBe(2);
  });

  it('draft inválido → 422 y la revisión no avanza; sin expectedRevision → 400', async () => {
    const { cp } = await campaniaOk();
    const r = await putDraft(cp.id, { moments: 'no' }, 1);
    expect(r.statusCode).toBe(422);
    esError(r.json(), 'DRAFT_INVALID');
    expect((await req('PUT', `/api/v1/campaigns/${cp.id}/draft`, U.op!, { takeoverDraft: PRESET_EMPTY() })).statusCode).toBe(400);
    expect((await leerDraft(cp.id)).revision).toBe(1);
  });

  it('§6 en PUT; reducir las superficies del contrato no reescribe el draft, pero la próxima escritura aplica la regla', async () => {
    const { ct, cp } = await campaniaOk(['screen_a', 'screen_b', 'horizontal'], PRESET_TAKEOVER_15S());
    expect((await putDraft(cp.id, PRESET_TAKEOVER_15S(), 1)).statusCode).toBe(200);
    const recorte = await req('PATCH', `/api/v1/contracts/${ct.id}`, U.admin!, { allowedSurfaces: ['screen_a', 'screen_b'] });
    expect(recorte.statusCode).toBe(200);
    const d = await leerDraft(cp.id);
    expect(d.revision).toBe(2); // nada se reescribió
    const r = await putDraft(cp.id, PRESET_TAKEOVER_15S(), 2);
    expect(r.statusCode).toBe(422);
    expect(ErrorResponseSchema.parse(r.json())).toMatchObject({ code: 'SURFACE_NOT_CONTRACTED', details: { screens: ['horizontal'] } });
    expect((await putDraft(cp.id, sinHorizontal(), 2)).statusCode).toBe(200);
  });

  it('§6 bajo concurrencia (AUDIT D1 P1): recorte sin confirmar del contrato → el PUT espera el lock y, tras el commit, falla SURFACE_NOT_CONTRACTED', async () => {
    const { ct, cp } = await campaniaOk(['screen_a', 'screen_b', 'horizontal'], PRESET_TAKEOVER_15S());
    // T2: el recorte toma la fila del contrato y NO confirma todavía.
    const recorte = await retenerTransaccion(t.app, (trx) =>
      trx.updateTable('contracts').set({ allowed_surfaces: ['screen_a', 'screen_b'] }).where('id', '=', ct.id).execute());
    let pendiente: ReturnType<typeof putDraft> | undefined;
    try {
      pendiente = putDraft(cp.id, PRESET_TAKEOVER_15S(), 1);
      // El PUT queda esperando la fila del contrato (FOR SHARE vs. la escritura de T2): no valida contra la lista vieja.
      await esperarBloqueados(t.app, LOCK_FILA);
    } finally {
      await recorte.soltar();
    }
    const r = await pendiente!;
    expect(r.statusCode, r.body).toBe(422);
    expect(ErrorResponseSchema.parse(r.json())).toMatchObject({ code: 'SURFACE_NOT_CONTRACTED', details: { screens: ['horizontal'] } });
    expect((await leerDraft(cp.id)).revision).toBe(1);
  });

  it('§6 bajo concurrencia (AUDIT D1 P1): PUT en curso → el PATCH que recorta espera su commit; queda serializado PUT → recorte', async () => {
    const { ct, cp } = await campaniaOk(['screen_a', 'screen_b', 'horizontal'], PRESET_TAKEOVER_15S());
    // Retener el lock del audit pausa al PUT DESPUÉS de validar y escribir, con el contrato ya en FOR SHARE.
    const audit = await retenerTransaccion(t.app, (trx) => sql`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`.execute(trx));
    let put: ReturnType<typeof putDraft> | undefined;
    let patch: ReturnType<typeof req> | undefined;
    try {
      put = putDraft(cp.id, PRESET_TAKEOVER_15S(), 1);
      await esperarBloqueados(t.app, ['advisory']);
      patch = req('PATCH', `/api/v1/contracts/${ct.id}`, U.admin!, { allowedSurfaces: ['screen_a', 'screen_b'] });
      // El PATCH espera la FILA del contrato (no el audit): no puede confirmar el recorte antes que el PUT.
      await esperarBloqueados(t.app, LOCK_FILA);
    } finally {
      await audit.soltar();
    }
    const [rp, rc] = await Promise.all([put!, patch!]);
    expect(rp.statusCode, rp.body).toBe(200);
    expect(rc.statusCode, rc.body).toBe(200);
    expect(ContractResponseSchema.parse(rc.json()).allowedSurfaces).toEqual(['screen_a', 'screen_b']);
    const ev = await t.app.selectFrom('audit_events').select(['action', 'seq']).where('entity_id', 'in', [ct.id, cp.currentDraft!.id]).where('action', 'in', ['DRAFT_UPDATED', 'CONTRACT_UPDATED']).orderBy('seq').execute();
    expect(ev.map((e) => e.action)).toEqual(['DRAFT_UPDATED', 'CONTRACT_UPDATED']);
    // y desde ahí, la regla aplica al próximo PUT
    const r = await putDraft(cp.id, PRESET_TAKEOVER_15S(), 2);
    expect(r.statusCode).toBe(422);
    esError(r.json(), 'SURFACE_NOT_CONTRACTED');
  });

  it('autorización y estado: INTERNAL_APPROVER 403, sin CSRF 403, campaña archivada 409, inexistente 404', async () => {
    const { cp } = await campaniaOk();
    expect((await putDraft(cp.id, PRESET_EMPTY(), 1, U.apr!)).statusCode).toBe(403);
    const sinCsrf = await req('PUT', `/api/v1/campaigns/${cp.id}/draft`, U.op!, { takeoverDraft: PRESET_EMPTY(), expectedRevision: 1 }, { csrf: false });
    expect(sinCsrf.statusCode).toBe(403);
    esError(sinCsrf.json(), 'CSRF_TOKEN_INVALID');
    await t.app.updateTable('campaigns').set({ lifecycle_status: 'ARCHIVED' }).where('id', '=', cp.id).execute();
    const arch = await putDraft(cp.id, PRESET_EMPTY(), 1);
    expect(arch.statusCode).toBe(409);
    esError(arch.json(), 'INVALID_STATE_TRANSITION');
    expect((await putDraft('00000000-0000-4000-8000-000000000000', PRESET_EMPTY(), 1)).statusCode).toBe(404);
  });

  it('verifyChain OK al final', async () => {
    expect((await verifyChain(t.app)).problems).toEqual([]);
  });
});
