import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyChain } from '@trust/platform-audit';
import { type Role, createUser, issueSession } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedApproval, seedCampaignWithDraft, seedContract, seedVersion, sha } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_DEV, SessionActorProvider } from './actor';
import { buildApp } from './app';
import { ActiveVersionChangeResponseSchema, CampaignResponseSchema, ErrorResponseSchema, EvidenceResponseSchema, pageOf } from './contracts';

/**
 * F3(a) — versión vigente con cuatro ojos por HTTP: Fastify real + PostgreSQL
 * real + sesiones reales (cookie + CSRF). Criterios §6 del brief
 * `docs/briefs/F3A_REDEPLOY.md` (aprobado en #50).
 */
let t: TestDatabase;
let root: string;
let storage: LocalDiskStorage;
let app: FastifyInstance;
const PW = 'correct horse battery staple';

type Who = { id: string; cookie: string; csrf: string };
const U: Record<string, Who> = {};
let contrato: string;
let contratoSinCuatroOjos: string;

async function usuario(nombre: string, roles: Array<{ role: Role; contractId?: string }>): Promise<Who> {
  const us = await createUser(t.app, { name: nombre, email: `${nombre}-${Math.random().toString(36).slice(2, 8)}@affinitas.com`, password: PW, organization: 'Affinitas', roles });
  const s = await issueSession(t.app, us.id, 60 * 60_000);
  return { id: us.id, cookie: `${SESSION_COOKIE_DEV}=${s.token}`, csrf: s.csrfToken };
}

beforeAll(async () => {
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-f3a-'));
  storage = await LocalDiskStorage.open(path.join(root, 'store'));
  contrato = (await seedContract(t.app)).id;
  contratoSinCuatroOjos = (await seedContract(t.app, { fourEyes: false })).id;
  U.op = await usuario('op', [{ role: 'OPERATOR' }]);
  U.op2 = await usuario('op2', [{ role: 'OPERATOR' }]);
  U.apr = await usuario('apr', [{ role: 'INTERNAL_APPROVER' }]);
  U.apr2 = await usuario('apr2', [{ role: 'INTERNAL_APPROVER' }]);
  U.admin = await usuario('admin', [{ role: 'ADMIN' }]);
  // pide y confirma: tiene los dos roles, cuatro ojos lo frena igual
  U.opApr = await usuario('opapr', [{ role: 'OPERATOR' }, { role: 'INTERNAL_APPROVER' }]);
  U.ext = await usuario('ext', [{ role: 'EXTERNAL_APPROVER', contractId: contrato }]);
  app = await buildApp({
    db: t.app, storage, media: mediaRuntimeFromEnv({}), maxUploadBytes: 1024 * 1024, maxEvidenceBytes: 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName: SESSION_COOKIE_DEV, externalApprovalEnabled: true }), log: false,
  });
});
afterAll(async () => {
  await app?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

type V = { id: string; hash: string; number: number };
/** Campaña con versiones por el camino único; `decisiones[i]` decide la versión i+1. */
async function campania(decisiones: Array<'APPROVED' | 'REJECTED' | null>, contractId = contrato): Promise<{ id: string; draftId: string; vs: V[] }> {
  const { campaignId, draftId } = await seedCampaignWithDraft(t.app, contractId, U.op!.id);
  const vs: V[] = [];
  for (const d of decisiones) {
    const v = await seedVersion(t.app, { campaignId, draftId, submittedBy: U.op!.id, versionHash: sha(`v-${Math.random()}`) });
    if (d) await seedApproval(t.app, v.id, U.apr!.id, d);
    const { version_hash } = await t.app.selectFrom('show_versions').select('version_hash').where('id', '=', v.id).executeTakeFirstOrThrow();
    vs.push({ id: v.id, hash: version_hash, number: v.versionNumber });
  }
  return { id: campaignId, draftId, vs };
}

let n = 0;
const k = () => `f3a-${Date.now()}-${n++}`;
const auth = (w: Who, extra: Record<string, string> = {}) => ({ cookie: w.cookie, 'x-csrf-token': w.csrf, ...extra });
const json = { 'content-type': 'application/json' };
const esError = (b: unknown, code: string) => expect(ErrorResponseSchema.parse(b).code).toBe(code);

const pedir = (campaignId: string, who: Who, body: Record<string, unknown>, key: string | null = k()) =>
  app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/active-version-changes`, headers: auth(who, { ...json, ...(key ? { 'idempotency-key': key } : {}) }), payload: JSON.stringify(body) });
const confirmar = (changeId: string, who: Who, versionHash: string, key: string | null = k()) =>
  app.inject({ method: 'POST', url: `/api/v1/active-version-changes/${changeId}/confirm`, headers: auth(who, { ...json, ...(key ? { 'idempotency-key': key } : {}) }), payload: JSON.stringify({ versionHash }) });
const cancelar = (changeId: string, who: Who, key: string | null = k()) =>
  app.inject({ method: 'POST', url: `/api/v1/active-version-changes/${changeId}/cancel`, headers: auth(who, key ? { 'idempotency-key': key } : {}) });
const leerCampania = async (id: string, who: Who = U.op!) => CampaignResponseSchema.parse((await app.inject({ method: 'GET', url: `/api/v1/campaigns/${id}`, headers: { cookie: who.cookie } })).json());
const cuerpo = (to: V, expected: string | null, reason = 'volver a la anterior por un error de cierre') => ({ versionId: to.id, versionHash: to.hash, reason, expectedActiveVersionId: expected });

const vigente = async (campaignId: string) =>
  (await sql<{ a: string | null }>`SELECT active_version_id AS a FROM campaigns WHERE id = ${campaignId}::uuid`.execute(t.owner)).rows[0]?.a ?? null;
const eventos = async (entityIds: string[], acciones?: string[]) => {
  let q = t.app.selectFrom('audit_events').selectAll().where('entity_id', 'in', entityIds);
  if (acciones) q = q.where('action', 'in', acciones);
  return q.orderBy('seq').execute();
};
const estado = async (changeId: string) => (await t.app.selectFrom('active_version_changes').select('status').where('id', '=', changeId).executeTakeFirstOrThrow()).status;

/** Pedido + confirmación de otra persona: la forma ÚNICA de fijar la vigente. */
async function fijar(c: { id: string }, to: V, expected: string | null) {
  const p = await pedir(c.id, U.op!, cuerpo(to, expected));
  expect(p.statusCode, p.body).toBe(201);
  const ch = ActiveVersionChangeResponseSchema.parse(p.json());
  const r = await confirmar(ch.id, U.apr!, to.hash);
  expect(r.statusCode, r.body).toBe(200);
  return ch.id;
}

/** Fuerza el vencimiento de un pedido (solo test, como dueño): mueve sus fechas al pasado. */
async function vencer(changeId: string) {
  await sql`ALTER TABLE active_version_changes DISABLE TRIGGER avc_transition`.execute(t.owner);
  try {
    await sql`UPDATE active_version_changes SET requested_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' WHERE id = ${changeId}::uuid`.execute(t.owner);
  } finally {
    await sql`ALTER TABLE active_version_changes ENABLE TRIGGER avc_transition`.execute(t.owner);
  }
}

describe('CRITERIO F3(a) §6.1: rollback completo con cuatro ojos', () => {
  it('v1 y v2 aprobadas, vigente v2 → A pide v1, B confirma → vigente v1; audit con hashes; verifyChain ok', async () => {
    const c = await campania(['APPROVED', 'APPROVED']);
    const [v1, v2] = c.vs as [V, V];
    await fijar(c, v2, null);
    expect(await vigente(c.id)).toBe(v2.id);

    const p = await pedir(c.id, U.op!, cuerpo(v1, v2.id));
    expect(p.statusCode, p.body).toBe(201);
    expect(p.headers['idempotent-replayed']).toBe('false');
    const ch = ActiveVersionChangeResponseSchema.parse(p.json());
    expect(ch).toMatchObject({ campaignId: c.id, fromVersionId: v2.id, toVersionId: v1.id, toVersionHash: v1.hash, status: 'PENDING', requestedBy: U.op!.id, decidedBy: null });
    expect(Date.parse(ch.expiresAt) - Date.parse(ch.requestedAt)).toBe(24 * 60 * 60_000);
    // pedir no mueve nada; la campaña muestra el pendiente
    let cp = await leerCampania(c.id);
    expect(cp.activeVersion?.id).toBe(v2.id);
    expect(cp.pendingActiveVersionChange).toMatchObject({ id: ch.id, toVersionId: v1.id, requestedBy: U.op!.id });

    const r = await confirmar(ch.id, U.apr!, v1.hash);
    expect(r.statusCode, r.body).toBe(200);
    expect(ActiveVersionChangeResponseSchema.parse(r.json())).toMatchObject({ id: ch.id, status: 'CONFIRMED', decidedBy: U.apr!.id });
    expect(await vigente(c.id)).toBe(v1.id);
    cp = await leerCampania(c.id);
    expect(cp.activeVersion).toEqual({ id: v1.id, versionNumber: 1, versionHash: v1.hash });
    expect(cp.pendingActiveVersionChange).toBeNull();

    const ev = await eventos([ch.id, c.id], ['ACTIVE_VERSION_CHANGE_REQUESTED', 'ACTIVE_VERSION_CHANGED']);
    const pedido = ev.find((e) => e.entity_id === ch.id)!;
    const cambio = ev.filter((e) => e.action === 'ACTIVE_VERSION_CHANGED').at(-1)!;
    expect(pedido).toMatchObject({ action: 'ACTIVE_VERSION_CHANGE_REQUESTED', actor_user_id: U.op!.id, before_hash: v2.hash, after_hash: v1.hash });
    expect(cambio).toMatchObject({ actor_user_id: U.apr!.id, entity_type: 'campaign', entity_id: c.id, before_hash: v2.hash, after_hash: v1.hash });
    expect(cambio.metadata).toEqual({ campaignId: c.id, fromVersionId: v2.id, toVersionId: v1.id, requestId: ch.id, requestedBy: U.op!.id, reason: 'volver a la anterior por un error de cierre' });
    expect((await verifyChain(t.app)).ok).toBe(true);

    // historial: más nuevo primero, paginado
    const h1 = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${c.id}/active-version-changes?limit=1`, headers: { cookie: U.apr!.cookie } });
    const pg1 = pageOf(ActiveVersionChangeResponseSchema).parse(h1.json());
    expect(pg1.items.map((i) => i.id)).toEqual([ch.id]);
    const h2 = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${c.id}/active-version-changes?limit=1&cursor=${pg1.nextCursor}`, headers: { cookie: U.apr!.cookie } });
    const pg2 = pageOf(ActiveVersionChangeResponseSchema).parse(h2.json());
    expect(pg2.items).toHaveLength(1);
    expect(pg2.items[0]?.toVersionId).toBe(v2.id);
    expect(pg2.nextCursor).toBeNull();
  });
});

describe('CRITERIO F3(a) §6.2: cuatro ojos siempre', () => {
  it('quien pidió no confirma (aunque tenga el rol), también con four_eyes_required = false; nada cambia', async () => {
    for (const contractId of [contrato, contratoSinCuatroOjos]) {
      const c = await campania(['APPROVED'], contractId);
      const p = await pedir(c.id, U.opApr!, cuerpo(c.vs[0]!, null));
      expect(p.statusCode, p.body).toBe(201);
      const ch = ActiveVersionChangeResponseSchema.parse(p.json());
      const r = await confirmar(ch.id, U.opApr!, c.vs[0]!.hash);
      expect(r.statusCode, r.body).toBe(403);
      esError(r.json(), 'FOUR_EYES_VIOLATION');
      // la app lo frena ANTES de mirar el hash (primera barrera; la base es la segunda)
      const conOtroHash = await confirmar(ch.id, U.opApr!, sha('otro'));
      expect(conOtroHash.statusCode).toBe(403);
      esError(conOtroHash.json(), 'FOUR_EYES_VIOLATION');
      expect(await vigente(c.id)).toBeNull();
      expect(await estado(ch.id)).toBe('PENDING');
      expect(await eventos([c.id], ['ACTIVE_VERSION_CHANGED'])).toHaveLength(0);
      // otra persona sí
      expect((await confirmar(ch.id, U.apr!, c.vs[0]!.hash)).statusCode).toBe(200);
    }
  });

  it('roles: INTERNAL_APPROVER no pide; OPERATOR y EXTERNAL_APPROVER no confirman; cancela quien pidió o ADMIN', async () => {
    const c = await campania(['APPROVED']);
    const v = c.vs[0]!;
    expect((await pedir(c.id, U.apr!, cuerpo(v, null))).statusCode).toBe(403);
    expect((await pedir(c.id, U.ext!, cuerpo(v, null))).statusCode).toBe(403);
    const ch = ActiveVersionChangeResponseSchema.parse((await pedir(c.id, U.op!, cuerpo(v, null))).json());
    expect((await confirmar(ch.id, U.op2!, v.hash)).statusCode).toBe(403);
    expect((await confirmar(ch.id, U.ext!, v.hash)).statusCode).toBe(403);
    const otro = await cancelar(ch.id, U.op2!);
    expect(otro.statusCode).toBe(403);
    esError(otro.json(), 'FORBIDDEN');
    // sin CSRF o sin Idempotency-Key: nada
    expect((await app.inject({ method: 'POST', url: `/api/v1/active-version-changes/${ch.id}/cancel`, headers: { cookie: U.op!.cookie, 'idempotency-key': k() } })).statusCode).toBe(403);
    const sinKey = await cancelar(ch.id, U.op!, null);
    expect(sinKey.statusCode).toBe(400);
    esError(sinKey.json(), 'IDEMPOTENCY_KEY_REQUIRED');
    // auditoría F3A #2: un cuerpo presente se valida siempre, también el JSON null
    for (const payload of ['null', '{"x":1}', '[]']) {
      const r = await app.inject({ method: 'POST', url: `/api/v1/active-version-changes/${ch.id}/cancel`, headers: auth(U.op!, { ...json, 'idempotency-key': k() }), payload });
      expect(r.statusCode, payload).toBe(400);
      esError(r.json(), 'VALIDATION_ERROR');
    }
    expect(await estado(ch.id)).toBe('PENDING');
    const vacio = await app.inject({ method: 'POST', url: `/api/v1/active-version-changes/${ch.id}/cancel`, headers: auth(U.op2!, { ...json, 'idempotency-key': k() }), payload: '{}' });
    expect(vacio.statusCode).toBe(403); // `{}` es válido: llega al chequeo de quién cancela
    const adm = await cancelar(ch.id, U.admin!);
    expect(adm.statusCode, adm.body).toBe(200);
    expect(ActiveVersionChangeResponseSchema.parse(adm.json())).toMatchObject({ status: 'CANCELLED', decidedBy: U.admin!.id });
    expect(await eventos([ch.id], ['ACTIVE_VERSION_CHANGE_CANCELLED'])).toHaveLength(1);
    // ya terminado: ni confirmar ni cancelar
    const tarde = await confirmar(ch.id, U.apr!, v.hash);
    expect(tarde.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(tarde.json())).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { status: 'CANCELLED' } });
  });
});

describe('CRITERIO F3(a) §6.3: destino inválido', () => {
  it('SUBMITTED/REJECTED 409 · de otra campaña o inexistente 404 · hash 409 · ya vigente 409 · campaña archivada 409', async () => {
    const c = await campania(['APPROVED', 'REJECTED', null]);
    const otra = await campania(['APPROVED']);
    const [v1, v2, v3] = c.vs as [V, V, V];
    for (const [v, st] of [[v2, 'REJECTED'], [v3, 'SUBMITTED']] as const) {
      const r = await pedir(c.id, U.op!, cuerpo(v, null));
      expect(r.statusCode).toBe(409);
      expect(ErrorResponseSchema.parse(r.json())).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { status: st } });
    }
    const ajena = await pedir(c.id, U.op!, cuerpo(otra.vs[0]!, null));
    expect(ajena.statusCode).toBe(404);
    esError(ajena.json(), 'SHOW_VERSION_NOT_FOUND');
    const inexistente = await pedir(c.id, U.op!, { ...cuerpo(v1, null), versionId: '00000000-0000-4000-8000-000000000000' });
    expect(inexistente.statusCode).toBe(404);
    expect(inexistente.json().message).toBe(ajena.json().message);
    const hash = await pedir(c.id, U.op!, { ...cuerpo(v1, null), versionHash: otra.vs[0]!.hash });
    expect(hash.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(hash.json())).toMatchObject({ code: 'VERSION_HASH_MISMATCH', details: { versionHash: v1.hash } });
    expect((await pedir('00000000-0000-4000-8000-000000000000', U.op!, cuerpo(v1, null))).statusCode).toBe(404);
    // validación de cuerpo: strict, expected obligatorio (puede ser null), motivo 1–2000
    expect((await pedir(c.id, U.op!, { versionId: v1.id, versionHash: v1.hash, reason: 'x' })).statusCode).toBe(400);
    expect((await pedir(c.id, U.op!, { ...cuerpo(v1, null), extra: 1 })).statusCode).toBe(400);
    expect((await pedir(c.id, U.op!, cuerpo(v1, null, '   '))).statusCode).toBe(400);
    expect((await pedir(c.id, U.op!, cuerpo(v1, null, 'x'.repeat(2001)))).statusCode).toBe(400);
    expect(await t.app.selectFrom('active_version_changes').select('id').where('campaign_id', '=', c.id).execute()).toHaveLength(0);

    await fijar(c, v1, null);
    const igual = await pedir(c.id, U.op!, cuerpo(v1, v1.id));
    expect(igual.statusCode).toBe(409);
    esError(igual.json(), 'ACTIVE_VERSION_UNCHANGED');

    await t.app.updateTable('campaigns').set({ lifecycle_status: 'ARCHIVED' }).where('id', '=', otra.id).execute();
    const arch = await pedir(otra.id, U.op!, cuerpo(otra.vs[0]!, null));
    expect(arch.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(arch.json())).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { lifecycleStatus: 'ARCHIVED' } });
  });
});

describe('CRITERIO F3(a) §6.4: concurrencia', () => {
  it('dos pedidos simultáneos → uno 201 y otro 409 PENDING', async () => {
    const c = await campania(['APPROVED', 'APPROVED']);
    const rs = await Promise.all([pedir(c.id, U.op!, cuerpo(c.vs[0]!, null)), pedir(c.id, U.op2!, cuerpo(c.vs[1]!, null))]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const perdedor = rs.find((r) => r.statusCode === 409)!;
    const ganador = ActiveVersionChangeResponseSchema.parse(rs.find((r) => r.statusCode === 201)!.json());
    expect(ErrorResponseSchema.parse(perdedor.json())).toMatchObject({ code: 'ACTIVE_VERSION_CHANGE_PENDING', details: { changeId: ganador.id } });
  });

  it('dos confirmaciones simultáneas → una gana, la otra 409; un solo ACTIVE_VERSION_CHANGED', async () => {
    const c = await campania(['APPROVED']);
    const ch = ActiveVersionChangeResponseSchema.parse((await pedir(c.id, U.op!, cuerpo(c.vs[0]!, null))).json());
    const rs = await Promise.all([confirmar(ch.id, U.apr!, c.vs[0]!.hash), confirmar(ch.id, U.apr2!, c.vs[0]!.hash)]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    esError(rs.find((r) => r.statusCode === 409)!.json(), 'INVALID_STATE_TRANSITION');
    expect(await eventos([c.id], ['ACTIVE_VERSION_CHANGED'])).toHaveLength(1);
    expect(await vigente(c.id)).toBe(c.vs[0]!.id);
  });

  it('pedido con expected viejo → 409 ACTIVE_VERSION_CONFLICT con la vigente real', async () => {
    const c = await campania(['APPROVED', 'APPROVED']);
    await fijar(c, c.vs[1]!, null);
    // "primera selección" sobre una vigente ya fijada: el chequeo no puede ser "<>" (NULL)
    const r = await pedir(c.id, U.op!, cuerpo(c.vs[0]!, null));
    expect(r.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(r.json())).toMatchObject({ code: 'ACTIVE_VERSION_CONFLICT', details: { activeVersionId: c.vs[1]!.id } });
  });
});

describe('CRITERIO F3(a) §6.13 / §6.4 / §6.15: 409 con efecto persistido (COMMIT)', () => {
  it('vigente cambiada entre pedir y confirmar → 409, pedido CANCELLED, un evento, verifyChain ok; el retry repite el 409 sin otro evento', async () => {
    const c = await campania(['APPROVED', 'APPROVED', 'APPROVED']);
    const [v1, v2, v3] = c.vs as [V, V, V];
    await fijar(c, v1, null);
    const viejo = ActiveVersionChangeResponseSchema.parse((await pedir(c.id, U.op!, cuerpo(v2, v1.id))).json());
    // otro cambio se cruza: cancelan el viejo, se pide y confirma v3
    expect((await cancelar(viejo.id, U.op!)).statusCode).toBe(200);
    await fijar(c, v3, v1.id);
    // un pedido "colgado" desde v1 (como si se hubiera pedido antes) no puede crearse por la API: se arma como dueño
    const colgado = (await sql<{ id: string }>`INSERT INTO active_version_changes (campaign_id, from_version_id, to_version_id, to_version_hash, reason, requested_by, expires_at)
      VALUES (${c.id}::uuid, ${v1.id}::uuid, ${v2.id}::uuid, ${v2.hash}, 'pedido viejo', ${U.op!.id}::uuid, now() + interval '1 hour') RETURNING id`.execute(t.owner)).rows[0]!.id;

    const key = k();
    const r = await confirmar(colgado, U.apr!, v2.hash, key);
    expect(r.statusCode).toBe(409);
    expect(r.headers['idempotent-replayed']).toBe('false');
    const err = ErrorResponseSchema.parse(r.json());
    expect(err).toMatchObject({ code: 'ACTIVE_VERSION_CONFLICT', details: { changeId: colgado, status: 'CANCELLED', activeVersionId: v3.id } });
    // en OTRA conexión (la del dueño): quedó escrito
    const fila = (await sql<{ status: string; decided_by: string }>`SELECT status, decided_by FROM active_version_changes WHERE id = ${colgado}::uuid`.execute(t.owner)).rows[0];
    expect(fila).toEqual({ status: 'CANCELLED', decided_by: U.apr!.id });
    expect(await eventos([colgado], ['ACTIVE_VERSION_CHANGE_CANCELLED'])).toHaveLength(1);
    expect(await vigente(c.id)).toBe(v3.id);
    expect((await verifyChain(t.owner)).ok).toBe(true);

    const re = await confirmar(colgado, U.apr!, v2.hash, key);
    expect(re.statusCode).toBe(409);
    expect(re.headers['idempotent-replayed']).toBe('true');
    expect(re.json()).toEqual(r.json()); // mismo body, incluido su requestId original
    expect(await eventos([colgado], ['ACTIVE_VERSION_CHANGE_CANCELLED'])).toHaveLength(1);
  });

  it('§6.15: pedido de primera selección y vigente puesta por fuera → 409 CANCELLED; y al revés (from v1, vigente a NULL) → 409', async () => {
    const c = await campania(['APPROVED', 'APPROVED']);
    const [v1, v2] = c.vs as [V, V];
    const p = ActiveVersionChangeResponseSchema.parse((await pedir(c.id, U.op!, cuerpo(v2, null))).json());
    await sql`UPDATE campaigns SET active_version_id = ${v1.id}::uuid WHERE id = ${c.id}::uuid`.execute(t.owner);
    const r = await confirmar(p.id, U.apr!, v2.hash);
    expect(r.statusCode).toBe(409);
    esError(r.json(), 'ACTIVE_VERSION_CONFLICT');
    expect(await estado(p.id)).toBe('CANCELLED');
    expect(await vigente(c.id)).toBe(v1.id);

    const q = ActiveVersionChangeResponseSchema.parse((await pedir(c.id, U.op!, cuerpo(v2, v1.id))).json());
    expect(q.fromVersionId).toBe(v1.id);
    await sql`UPDATE campaigns SET active_version_id = NULL WHERE id = ${c.id}::uuid`.execute(t.owner);
    const s = await confirmar(q.id, U.apr!, v2.hash);
    expect(s.statusCode).toBe(409);
    esError(s.json(), 'ACTIVE_VERSION_CONFLICT');
    expect(await estado(q.id)).toBe('CANCELLED');
    expect(await vigente(c.id)).toBeNull();
  });

  it('§6.5: pedido vencido no se confirma: 409, queda EXPIRED con audit (persistido); el retry repite el 409', async () => {
    const c = await campania(['APPROVED']);
    const p = ActiveVersionChangeResponseSchema.parse((await pedir(c.id, U.op!, cuerpo(c.vs[0]!, null))).json());
    await vencer(p.id);
    expect((await leerCampania(c.id)).pendingActiveVersionChange).toBeNull();
    const key = k();
    const r = await confirmar(p.id, U.apr!, c.vs[0]!.hash, key);
    expect(r.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(r.json())).toMatchObject({ code: 'ACTIVE_VERSION_CHANGE_EXPIRED', details: { changeId: p.id, status: 'EXPIRED' } });
    expect(await estado(p.id)).toBe('EXPIRED');
    const ev = await eventos([p.id], ['ACTIVE_VERSION_CHANGE_EXPIRED']);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor_user_id: null, metadata: { campaignId: c.id, observedBy: U.apr!.id } });
    expect(await vigente(c.id)).toBeNull();
    const re = await confirmar(p.id, U.apr!, c.vs[0]!.hash, key);
    expect([re.statusCode, re.headers['idempotent-replayed']]).toEqual([409, 'true']);
    expect(re.json()).toEqual(r.json());
    expect(await eventos([p.id], ['ACTIVE_VERSION_CHANGE_EXPIRED'])).toHaveLength(1);
    expect((await verifyChain(t.owner)).ok).toBe(true);
  });

  it('§3.4: vencimiento perezoso al cancelar (409 EXPIRED) y al pedir otro (el viejo vence y el nuevo entra)', async () => {
    const c = await campania(['APPROVED', 'APPROVED']);
    const p = ActiveVersionChangeResponseSchema.parse((await pedir(c.id, U.op!, cuerpo(c.vs[0]!, null))).json());
    await vencer(p.id);
    const r = await cancelar(p.id, U.op!);
    expect(r.statusCode).toBe(409);
    esError(r.json(), 'ACTIVE_VERSION_CHANGE_EXPIRED');
    expect(await estado(p.id)).toBe('EXPIRED');

    const q = ActiveVersionChangeResponseSchema.parse((await pedir(c.id, U.op!, cuerpo(c.vs[1]!, null))).json());
    await vencer(q.id);
    const nuevo = await pedir(c.id, U.op2!, cuerpo(c.vs[0]!, null));
    expect(nuevo.statusCode, nuevo.body).toBe(201);
    expect(await estado(q.id)).toBe('EXPIRED');
    expect(await eventos([q.id], ['ACTIVE_VERSION_CHANGE_EXPIRED'])).toHaveLength(1);
  });
});

describe('CRITERIO F3(a) §6.7: A2.2 — aprobar nunca mueve la vigente', () => {
  const PDF = () => Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'), Buffer.from(`% ${Math.random()}\n`)]);
  async function aprobarPorHttp(versionId: string, hash: string) {
    const fd = new FormData();
    fd.append('type', 'PDF');
    fd.append('file', new Blob([new Uint8Array(PDF())]), 'ok.pdf');
    const req = new Request('http://local/', { method: 'POST', body: fd });
    const ev = await app.inject({
      method: 'POST', url: `/api/v1/show-versions/${versionId}/evidence`,
      headers: auth(U.apr!, { 'content-type': req.headers.get('content-type') as string, 'idempotency-key': k() }), payload: Buffer.from(await req.arrayBuffer()),
    });
    expect(ev.statusCode, ev.body).toBe(201);
    const evidence = EvidenceResponseSchema.parse(ev.json());
    const ap = await app.inject({
      method: 'POST', url: `/api/v1/show-versions/${versionId}/approve`, headers: auth(U.apr!, { ...json, 'idempotency-key': k() }),
      payload: JSON.stringify({ evidenceId: evidence.id, versionHash: hash }),
    });
    expect(ap.statusCode, ap.body).toBe(201);
  }

  it('aprobar v3 con la vigente en NULL, en v2 (= última aprobada) o en v1 → la vigente no cambia y no hay evento de vigente', async () => {
    for (const inicial of [null, 'v2', 'v1'] as const) {
      const c = await campania(['APPROVED', 'APPROVED']);
      const [v1, v2] = c.vs as [V, V];
      await t.app.updateTable('campaigns').set({ latest_approved_version_id: v2.id }).where('id', '=', c.id).execute();
      if (inicial === 'v2') await fijar(c, v2, null);
      if (inicial === 'v1') await fijar(c, v1, null);
      const antes = await vigente(c.id);
      const eventosAntes = (await eventos([c.id])).length;
      const v3 = await seedVersion(t.app, { campaignId: c.id, draftId: c.draftId, submittedBy: U.op!.id, versionHash: sha(`v3-${Math.random()}`) });
      const h3 = (await t.app.selectFrom('show_versions').select('version_hash').where('id', '=', v3.id).executeTakeFirstOrThrow()).version_hash;
      await aprobarPorHttp(v3.id, h3);
      const cp = await leerCampania(c.id);
      expect(cp.latestApprovedVersion?.id).toBe(v3.id); // la "última aprobada" sí avanza
      expect(await vigente(c.id)).toBe(antes);
      expect(cp.activeVersion?.id ?? null).toBe(antes);
      const nuevos = (await eventos([c.id])).slice(eventosAntes);
      expect(nuevos.filter((e) => e.action.startsWith('ACTIVE_VERSION'))).toHaveLength(0);
      // quedar vigente pide pedido + confirmación de otra persona
      await fijar(c, { id: v3.id, hash: h3, number: 3 }, antes);
      expect(await vigente(c.id)).toBe(v3.id);
    }
  });

  it('primera selección (expected null) funciona y queda auditada', async () => {
    const c = await campania(['APPROVED']);
    expect((await leerCampania(c.id)).activeVersion).toBeNull();
    const id = await fijar(c, c.vs[0]!, null);
    const ev = await eventos([id, c.id], ['ACTIVE_VERSION_CHANGE_REQUESTED', 'ACTIVE_VERSION_CHANGED']);
    expect(ev.map((e) => [e.action, e.before_hash, e.after_hash])).toEqual([
      ['ACTIVE_VERSION_CHANGE_REQUESTED', null, c.vs[0]!.hash],
      ['ACTIVE_VERSION_CHANGED', null, c.vs[0]!.hash],
    ]);
  });
});

describe('CRITERIO F3(a) §6.8: idempotencia, una prueba por operación', () => {
  it('pedir: misma key + mismo pedido → 201 y el mismo body, un solo pedido; otro pedido con la key → IDEMPOTENCY_KEY_REUSED', async () => {
    const c = await campania(['APPROVED', 'APPROVED']);
    const key = k();
    const a = await pedir(c.id, U.op!, cuerpo(c.vs[0]!, null), key);
    const b = await pedir(c.id, U.op!, cuerpo(c.vs[0]!, null), key);
    expect([a.statusCode, a.headers['idempotent-replayed']]).toEqual([201, 'false']);
    expect([b.statusCode, b.headers['idempotent-replayed']]).toEqual([201, 'true']);
    expect(b.json()).toEqual(a.json());
    expect(await t.app.selectFrom('active_version_changes').select('id').where('campaign_id', '=', c.id).execute()).toHaveLength(1);
    expect(await eventos([a.json().id], ['ACTIVE_VERSION_CHANGE_REQUESTED'])).toHaveLength(1);
    const otro = await pedir(c.id, U.op!, cuerpo(c.vs[1]!, null), key);
    expect(otro.statusCode).toBe(409);
    esError(otro.json(), 'IDEMPOTENCY_KEY_REUSED');
  });

  it('confirmar con respuesta perdida: el retry devuelve el mismo 200 y body (no 409); un solo ACTIVE_VERSION_CHANGED', async () => {
    const c = await campania(['APPROVED']);
    const ch = ActiveVersionChangeResponseSchema.parse((await pedir(c.id, U.op!, cuerpo(c.vs[0]!, null))).json());
    const key = k();
    const a = await confirmar(ch.id, U.apr!, c.vs[0]!.hash, key);
    const b = await confirmar(ch.id, U.apr!, c.vs[0]!.hash, key);
    expect([a.statusCode, b.statusCode, b.headers['idempotent-replayed']]).toEqual([200, 200, 'true']);
    expect(b.json()).toEqual(a.json());
    expect(await eventos([c.id], ['ACTIVE_VERSION_CHANGED'])).toHaveLength(1);
    expect(await vigente(c.id)).toBe(c.vs[0]!.id);
    const otro = await confirmar(ch.id, U.apr!, sha('otro'), key);
    expect(otro.statusCode).toBe(409);
    esError(otro.json(), 'IDEMPOTENCY_KEY_REUSED');
  });

  it('cancelar: misma key → el mismo 200 y body, un solo evento', async () => {
    const c = await campania(['APPROVED']);
    const ch = ActiveVersionChangeResponseSchema.parse((await pedir(c.id, U.op!, cuerpo(c.vs[0]!, null))).json());
    const key = k();
    const a = await cancelar(ch.id, U.op!, key);
    const b = await cancelar(ch.id, U.op!, key);
    expect([a.statusCode, b.statusCode, b.headers['idempotent-replayed']]).toEqual([200, 200, 'true']);
    expect(b.json()).toEqual(a.json());
    expect(await eventos([ch.id], ['ACTIVE_VERSION_CHANGE_CANCELLED'])).toHaveLength(1);
  });

  it('un 409 sin efecto no se guarda: rollback de la reserva; la misma key con el pedido corregido es OTRO fingerprint y corre', async () => {
    const c = await campania(['APPROVED']);
    const ch = ActiveVersionChangeResponseSchema.parse((await pedir(c.id, U.op!, cuerpo(c.vs[0]!, null))).json());
    const key = k();
    // hash equivocado: 409 con rollback (también de la reserva de la key)
    const a = await confirmar(ch.id, U.apr!, sha('no'), key);
    expect(a.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(a.json())).toMatchObject({ code: 'VERSION_HASH_MISMATCH', details: { versionHash: c.vs[0]!.hash } });
    expect(await estado(ch.id)).toBe('PENDING');
    const b = await confirmar(ch.id, U.apr!, c.vs[0]!.hash, key);
    expect([b.statusCode, b.headers['idempotent-replayed']]).toEqual([200, 'false']);
  });
});

describe('CRITERIO F3(a) §6.9: nada se reescribe', () => {
  it('ShowVersions, manifiestos, Approvals, evidencia, stored_objects y blobs idénticos antes y después de un rollback', async () => {
    const c = await campania(['APPROVED', 'APPROVED']);
    await fijar(c, c.vs[1]!, null);
    const foto = async () => ({
      versiones: await t.owner.selectFrom('show_versions').selectAll().orderBy('id').execute(),
      manifiestos: await t.owner.selectFrom('show_version_assets').selectAll().orderBy('show_version_id').orderBy('logical_ref').execute(),
      aprobaciones: await t.owner.selectFrom('approvals').selectAll().orderBy('id').execute(),
      evidencia: await t.owner.selectFrom('approval_evidence').selectAll().orderBy('id').execute(),
      objetos: await t.owner.selectFrom('stored_objects').selectAll().orderBy('id').execute(),
      latest: await t.owner.selectFrom('campaigns').select(['id', 'latest_approved_version_id', 'current_draft_id']).orderBy('id').execute(),
      blobs: await listarBlobs(),
    });
    const antes = await foto();
    await fijar(c, c.vs[0]!, c.vs[1]!.id);
    expect(await vigente(c.id)).toBe(c.vs[0]!.id);
    expect(await foto()).toEqual(antes);
  });
});

async function listarBlobs(): Promise<Array<{ key: string; sizeBytes: number; lastModified: string }>> {
  const out: Array<{ key: string; sizeBytes: number; lastModified: string }> = [];
  for await (const o of storage.listContentObjects()) out.push({ key: o.key, sizeBytes: o.sizeBytes, lastModified: o.lastModified.toISOString() });
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

describe('lectura e historial', () => {
  it('historial: campaña inexistente 404; cursor de otra campaña 400; EXTERNAL_APPROVER 403', async () => {
    const c = await campania(['APPROVED']);
    const otra = await campania(['APPROVED']);
    const ajeno = await fijar(otra, otra.vs[0]!, null);
    expect((await app.inject({ method: 'GET', url: '/api/v1/campaigns/00000000-0000-4000-8000-000000000000/active-version-changes', headers: { cookie: U.op!.cookie } })).statusCode).toBe(404);
    const r = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${c.id}/active-version-changes?cursor=${ajeno}`, headers: { cookie: U.op!.cookie } });
    expect(r.statusCode).toBe(400);
    esError(r.json(), 'INVALID_CURSOR');
    expect((await app.inject({ method: 'GET', url: `/api/v1/campaigns/${c.id}/active-version-changes`, headers: { cookie: U.ext!.cookie } })).statusCode).toBe(403);
    expect((await confirmar('00000000-0000-4000-8000-000000000000', U.apr!, c.vs[0]!.hash)).statusCode).toBe(404);
  });
});
