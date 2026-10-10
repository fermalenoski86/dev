import { type Role, createUser, issueSession } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedApproval, seedCampaignWithDraft, seedContract, seedVersion, sha } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_DEV, SessionActorProvider } from './actor';
import { buildApp } from './app';
import { ErrorResponseSchema, VersionSummaryResponseSchema, pageOf } from './contracts';

/**
 * BL-31 · historial de versiones por campaña: `GET /api/v1/campaigns/:id/versions`
 * con Fastify real, PostgreSQL real y sesiones reales.
 *
 *   · orden (más nueva primero) y paginación keyset sin duplicados ni huecos,
 *     aun si se crea una versión entre páginas;
 *   · resúmenes mínimos (sin paquete, evidencia, contrato ni actores);
 *   · negativos de enumeración (OWASP API1:2023): campaña ajena = inexistente,
 *     cursor ajeno = cursor inexistente, scope antes que cursor.
 */
let t: TestDatabase;
let root: string;
let app: FastifyInstance;
let appSinExternos: FastifyInstance;
const PW = 'correct horse battery staple';
const Pagina = pageOf(VersionSummaryResponseSchema);
const NADA = '00000000-0000-4000-8000-000000000000';

type Who = { id: string; cookie: string };
const W: Record<string, Who> = {};
let contratoA: string; // aprobación externa habilitada; ext es aprobador externo de A
let contratoB: string; // otro anunciante: ext no lo ve
let contratoC: string; // ext asociado, pero la aprobación externa está apagada
let campA: { campaignId: string; draftId: string };
let campA2: { campaignId: string; draftId: string };
let campB: { campaignId: string; draftId: string };
let campC: { campaignId: string; draftId: string };
let vacia: string;
const versionesA: string[] = []; // índice i = versión i+1
const versionesB: string[] = [];

async function usuario(nombre: string, roles: Array<{ role: Role; contractId?: string }>): Promise<Who> {
  const u = await createUser(t.app, { name: nombre, email: `${nombre}-${Math.random().toString(36).slice(2, 8)}@affinitas.com`, password: PW, organization: 'Affinitas', roles });
  const s = await issueSession(t.app, u.id, 60 * 60_000);
  return { id: u.id, cookie: `${SESSION_COOKIE_DEV}=${s.token}` };
}

async function nuevaApp(external: boolean) {
  return buildApp({
    db: t.app, storage: await LocalDiskStorage.open(path.join(root, `store-${external}`)), media: mediaRuntimeFromEnv({}), maxUploadBytes: 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName: SESSION_COOKIE_DEV, externalApprovalEnabled: external }),
    log: false,
  });
}

const versionDe = async (c: { campaignId: string; draftId: string }, by: string) => (await seedVersion(t.app, { campaignId: c.campaignId, draftId: c.draftId, submittedBy: by, versionHash: sha(`bl31-${Math.random()}`) })).id;

beforeAll(async () => {
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-bl31-'));
  contratoA = (await seedContract(t.app)).id;
  contratoB = (await seedContract(t.app)).id;
  contratoC = (await seedContract(t.app)).id;
  await t.app.updateTable('contracts').set({ external_approval_enabled: true }).where('id', 'in', [contratoA, contratoB]).execute();
  W.op = await usuario('op', [{ role: 'OPERATOR' }]);
  W.apr = await usuario('apr', [{ role: 'INTERNAL_APPROVER' }]);
  W.admin = await usuario('admin', [{ role: 'ADMIN' }]);
  W.ext = await usuario('ext', [{ role: 'EXTERNAL_APPROVER', contractId: contratoA }, { role: 'EXTERNAL_APPROVER', contractId: contratoC }]);
  W.extB = await usuario('extb', [{ role: 'EXTERNAL_APPROVER', contractId: contratoB }]);
  W.extC = await usuario('extc', [{ role: 'EXTERNAL_APPROVER', contractId: contratoC }]);
  W.sinRol = await usuario('sinrol', []);

  campA = await seedCampaignWithDraft(t.app, contratoA, W.op.id);
  campA2 = await seedCampaignWithDraft(t.app, contratoA, W.op.id);
  campB = await seedCampaignWithDraft(t.app, contratoB, W.op.id);
  campC = await seedCampaignWithDraft(t.app, contratoC, W.op.id);
  vacia = (await seedCampaignWithDraft(t.app, contratoA, W.op.id)).campaignId;
  for (let i = 0; i < 5; i++) versionesA.push(await versionDe(campA, W.op.id));
  for (let i = 0; i < 2; i++) versionesB.push(await versionDe(campB, W.op.id));
  await versionDe(campA2, W.op.id);
  await versionDe(campC, W.op.id);
  await seedApproval(t.app, versionesA[1] as string, W.apr.id, 'APPROVED'); // v2
  await seedApproval(t.app, versionesA[2] as string, W.apr.id, 'REJECTED'); // v3

  app = await nuevaApp(true);
  appSinExternos = await nuevaApp(false);
});
afterAll(async () => {
  await app?.close();
  await appSinExternos?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const listar = (who: Who | null, campaignId: string, query = '', target: FastifyInstance = app) =>
  target.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/versions${query}`, headers: who ? { cookie: who.cookie } : {} });
const sinRequestId = (b: string) => {
  const e = ErrorResponseSchema.parse(JSON.parse(b));
  return { code: e.code, message: e.message, details: e.details };
};

describe('BL-31 · historial de versiones por campaña', () => {
  it('orden: la más nueva primero; estado derivado de la decisión; resumen con exactamente los campos mínimos', async () => {
    const r = await listar(W.op!, campA.campaignId);
    expect(r.statusCode, r.body).toBe(200);
    const crudo = JSON.parse(r.body) as { items: Array<Record<string, unknown>>; nextCursor: unknown };
    for (const it of crudo.items) expect(Object.keys(it).sort()).toEqual(['id', 'sourceDraftRevision', 'status', 'submittedAt', 'versionHash', 'versionNumber']);
    const p = Pagina.parse(crudo);
    expect(p.items.map((v) => v.versionNumber)).toEqual([5, 4, 3, 2, 1]);
    expect(p.items.map((v) => v.id)).toEqual([...versionesA].reverse());
    expect(p.items.map((v) => v.status)).toEqual(['SUBMITTED', 'SUBMITTED', 'REJECTED', 'APPROVED', 'SUBMITTED']);
    expect(p.nextCursor).toBeNull();
    // el hash del resumen es el de la versión
    const v1 = await t.app.selectFrom('show_versions').select('version_hash').where('id', '=', versionesA[0] as string).executeTakeFirstOrThrow();
    expect(p.items.at(-1)?.versionHash).toBe(v1.version_hash);
    // no se mezclan versiones de otra campaña del MISMO contrato
    expect(p.items.every((v) => versionesA.includes(v.id))).toBe(true);
  });

  it('paginación keyset: páginas de 2 cubren todo sin duplicados ni huecos; la última trae nextCursor null', async () => {
    const vistas: number[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const r = await listar(W.apr!, campA.campaignId, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(r.statusCode, r.body).toBe(200);
      const p = Pagina.parse(r.json());
      expect(p.items.length).toBeLessThanOrEqual(2);
      vistas.push(...p.items.map((v) => v.versionNumber));
      cursor = p.nextCursor;
      paginas += 1;
    } while (cursor && paginas < 10);
    expect(vistas).toEqual([5, 4, 3, 2, 1]);
    expect(paginas).toBe(3);
  });

  it('una versión nueva entre páginas no duplica ni saltea las viejas (cursor por número, no por offset)', async () => {
    const c = await seedCampaignWithDraft(t.app, contratoA, W.op!.id);
    for (let i = 0; i < 3; i++) await versionDe(c, W.op!.id);
    const p1 = Pagina.parse((await listar(W.admin!, c.campaignId, '?limit=2')).json());
    expect(p1.items.map((v) => v.versionNumber)).toEqual([3, 2]);
    await versionDe(c, W.op!.id); // v4 llega entre página 1 y 2
    const p2 = Pagina.parse((await listar(W.admin!, c.campaignId, `?limit=2&cursor=${p1.nextCursor}`)).json());
    expect(p2.items.map((v) => v.versionNumber)).toEqual([1]);
    expect(p2.nextCursor).toBeNull();
    expect(Pagina.parse((await listar(W.admin!, c.campaignId)).json()).items.map((v) => v.versionNumber)).toEqual([4, 3, 2, 1]);
  });

  it('campaña sin versiones: página vacía (200), no 404', async () => {
    const r = await listar(W.op!, vacia);
    expect(r.statusCode, r.body).toBe(200);
    expect(Pagina.parse(r.json())).toEqual({ items: [], nextCursor: null });
  });

  it('límite: default 20, 1..100; fuera de rango, parámetros extra o cursor no-UUID → 400', async () => {
    const c = await seedCampaignWithDraft(t.app, contratoA, W.op!.id);
    for (let i = 0; i < 21; i++) await versionDe(c, W.op!.id);
    const def = Pagina.parse((await listar(W.op!, c.campaignId)).json());
    expect(def.items.map((v) => v.versionNumber)).toEqual(Array.from({ length: 20 }, (_x, i) => 21 - i));
    expect(def.nextCursor).toBe(def.items.at(-1)?.id);
    expect(Pagina.parse((await listar(W.op!, c.campaignId, '?limit=100')).json()).items).toHaveLength(21);
    for (const q of ['?limit=0', '?limit=101', '?limit=1.5', '?limit=abc', '?cursor=no-es-uuid', '?offset=2', `?contractId=${contratoA}`]) {
      const r = await listar(W.op!, c.campaignId, q);
      expect(r.statusCode, `${q}: ${r.body}`).toBe(400);
    }
    expect((await listar(W.op!, 'no-es-uuid')).statusCode).toBe(400);
  });

  it('roles internos ven el historial de cualquier contrato; sin sesión 401; sin rol 403', async () => {
    for (const who of [W.op!, W.apr!, W.admin!]) {
      for (const c of [campA.campaignId, campB.campaignId]) expect((await listar(who, c)).statusCode).toBe(200);
    }
    const anon = await listar(null, campA.campaignId);
    expect([anon.statusCode, sinRequestId(anon.body).code]).toEqual([401, 'UNAUTHENTICATED']);
    const sinRol = await listar(W.sinRol!, campA.campaignId);
    expect([sinRol.statusCode, sinRequestId(sinRol.body).code]).toEqual([403, 'FORBIDDEN']);
  });

  it('EXTERNAL_APPROVER: ve el historial de SU contrato y nada más; campaña ajena = campaña inexistente (mismo cuerpo)', async () => {
    const propio = Pagina.parse((await listar(W.ext!, campA.campaignId)).json());
    expect(propio.items).toHaveLength(5);
    const ajena = await listar(W.ext!, campB.campaignId);
    const inexistente = await listar(W.ext!, NADA);
    expect(ajena.statusCode).toBe(404);
    expect(inexistente.statusCode).toBe(404);
    expect(sinRequestId(ajena.body)).toEqual(sinRequestId(inexistente.body));
    expect(sinRequestId(ajena.body).code).toBe('CAMPAIGN_NOT_FOUND');
    expect(ajena.body).not.toContain(versionesB[0]);
    // y al revés: extB no ve A
    expect((await listar(W.extB!, campA.campaignId)).statusCode).toBe(404);
    expect(Pagina.parse((await listar(W.extB!, campB.campaignId)).json()).items.map((v) => v.id)).toEqual([...versionesB].reverse());
  });

  it('scope antes que cursor: campaña ajena con cursor (válido o no) responde el mismo 404, sin oráculo por el cursor', async () => {
    const conCursorAjeno = await listar(W.ext!, campB.campaignId, `?cursor=${versionesB[1]}`);
    const conCursorPropio = await listar(W.ext!, campB.campaignId, `?cursor=${versionesA[3]}`);
    const conCursorNada = await listar(W.ext!, campB.campaignId, `?cursor=${NADA}`);
    const base = await listar(W.ext!, NADA);
    for (const r of [conCursorAjeno, conCursorPropio, conCursorNada]) {
      expect(r.statusCode).toBe(404);
      expect(sinRequestId(r.body)).toEqual(sinRequestId(base.body));
    }
  });

  it('cursor de otra campaña (aunque sea visible) = cursor inexistente: 400 INVALID_CURSOR idéntico y sin filas ajenas', async () => {
    const deOtraVisible = await listar(W.op!, campA.campaignId, `?cursor=${versionesB[1]}`);
    const deOtraMismoContrato = await listar(W.ext!, campA.campaignId, `?cursor=${versionesB[0]}`);
    const inexistente = await listar(W.op!, campA.campaignId, `?cursor=${NADA}`);
    const deCampania = await listar(W.op!, campA.campaignId, `?cursor=${campB.campaignId}`);
    for (const r of [deOtraVisible, deOtraMismoContrato, inexistente, deCampania]) {
      expect(r.statusCode, r.body).toBe(400);
      expect(sinRequestId(r.body)).toEqual({ code: 'INVALID_CURSOR', message: 'El cursor no corresponde a este historial.', details: undefined });
      expect(r.body).not.toMatch(/version_number|versionNumber|campaign_id|SELECT/i);
    }
  });

  it('aprobación externa apagada (contrato o servidor): el externo pierde el rol → 403, igual que en GET /show-versions/:id', async () => {
    // contrato C no habilita aprobación externa: extC (solo C) no tiene rol efectivo → 403;
    // ext (A habilitado + C) tiene el rol por A, pero C queda fuera de scope → 404
    expect((await listar(W.extC!, campC.campaignId)).statusCode).toBe(403);
    expect((await listar(W.ext!, campC.campaignId)).statusCode).toBe(404);
    // servidor sin aprobación externa: ningún externo tiene rol
    const r = await listar(W.ext!, campA.campaignId, '', appSinExternos);
    expect([r.statusCode, sinRequestId(r.body).code]).toEqual([403, 'FORBIDDEN']);
    // coherencia: la misma decisión que la lectura de una versión
    const v = await appSinExternos.inject({ method: 'GET', url: `/api/v1/show-versions/${versionesA[0]}`, headers: { cookie: W.ext!.cookie } });
    expect(v.statusCode).toBe(403);
  });

  it('cada id del historial abre con GET /show-versions/:id para el mismo actor (misma autorización por objeto)', async () => {
    const p = Pagina.parse((await listar(W.ext!, campA.campaignId)).json());
    for (const it of p.items) {
      const r = await app.inject({ method: 'GET', url: `/api/v1/show-versions/${it.id}`, headers: { cookie: W.ext!.cookie } });
      expect(r.statusCode, r.body).toBe(200);
      expect((r.json() as { versionHash: string }).versionHash).toBe(it.versionHash);
    }
  });
});
