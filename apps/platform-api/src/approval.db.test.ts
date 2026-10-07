import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { verifyChain } from '@trust/platform-audit';
import { type Role, createUser, issueSession } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedCampaignWithDraft, seedContract, seedVersion, sha } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_DEV, SessionActorProvider } from './actor';
import { buildApp } from './app';
import { pngReal } from '@trust/platform-approval/testing';
import { ErrorResponseSchema, EvidenceResponseSchema, FourEyesResponseSchema, ShowVersionResponseSchema } from './contracts';

/**
 * C2 — evidencia, approve/reject y cuatro ojos por HTTP: Fastify real +
 * PostgreSQL real + LocalDiskStorage real + sesiones reales (cookie + CSRF).
 */
let t: TestDatabase;
let root: string;
let storage: LocalDiskStorage;
let app: FastifyInstance;
let appExt: FastifyInstance;
const logs: string[] = [];
const logStream = new Writable({ write(c, _e, cb) { logs.push(String(c)); cb(); } });
const PW = 'correct horse battery staple';

type Who = { id: string; cookie: string; csrf: string };
const U: Record<string, Who> = {};
let contratoA: string; // external_approval_enabled = true
let contratoB: string;

async function nuevaApp(o: { external?: boolean; maxEvidenceBytes?: number } = {}) {
  return buildApp({
    db: t.app, storage, media: mediaRuntimeFromEnv({}), maxUploadBytes: 1024 * 1024, maxEvidenceBytes: o.maxEvidenceBytes ?? 1024 * 1024, mediaBinariesOk: () => true,
    actors: new SessionActorProvider(t.app, { cookieName: SESSION_COOKIE_DEV, externalApprovalEnabled: o.external ?? false }),
    log: { stream: logStream },
  });
}

async function usuario(nombre: string, roles: Array<{ role: Role; contractId?: string }>): Promise<Who> {
  const u = await createUser(t.app, { name: nombre, email: `${nombre}-${Math.random().toString(36).slice(2, 8)}@affinitas.com`, password: PW, organization: 'Affinitas', roles });
  const s = await issueSession(t.app, u.id, 60 * 60_000);
  return { id: u.id, cookie: `${SESSION_COOKIE_DEV}=${s.token}`, csrf: s.csrfToken };
}

beforeAll(async () => {
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-c2-'));
  storage = await LocalDiskStorage.open(path.join(root, 'store'));
  contratoA = (await seedContract(t.app)).id;
  contratoB = (await seedContract(t.app)).id;
  await t.app.updateTable('contracts').set({ external_approval_enabled: true }).where('id', '=', contratoA).execute();
  // quien envía tiene LOS DOS roles: cuatro ojos lo frena igual (§18)
  U.op = await usuario('op', [{ role: 'OPERATOR' }, { role: 'INTERNAL_APPROVER' }]);
  U.soloOp = await usuario('soloop', [{ role: 'OPERATOR' }]);
  U.apr = await usuario('apr', [{ role: 'INTERNAL_APPROVER' }]);
  U.apr2 = await usuario('apr2', [{ role: 'INTERNAL_APPROVER' }]);
  U.admin = await usuario('admin', [{ role: 'ADMIN' }]);
  U.ext = await usuario('ext', [{ role: 'EXTERNAL_APPROVER', contractId: contratoA }]);
  // ve todo como OPERATOR, pero solo DECIDE en A como externo
  U.opExt = await usuario('opext', [{ role: 'OPERATOR' }, { role: 'EXTERNAL_APPROVER', contractId: contratoA }]);
  app = await nuevaApp();
  appExt = await nuevaApp({ external: true });
});
afterAll(async () => {
  await app?.close();
  await appExt?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

async function version(contractId = contratoA) {
  const { campaignId, draftId } = await seedCampaignWithDraft(t.app, contractId, U.op!.id);
  const v = await seedVersion(t.app, { campaignId, draftId, submittedBy: U.op!.id, versionHash: sha(`v-${Math.random()}`) });
  const { version_hash } = await t.app.selectFrom('show_versions').select('version_hash').where('id', '=', v.id).executeTakeFirstOrThrow();
  return { id: v.id, hash: version_hash, campaignId };
}

const auth = (w: Who, extra: Record<string, string> = {}) => ({ cookie: w.cookie, 'x-csrf-token': w.csrf, ...extra });
let n = 0;
const k = () => `key-${Date.now()}-${n++}`;
const esError = (b: unknown, code: string) => expect(ErrorResponseSchema.parse(b).code).toBe(code);

async function multipart(campos: Array<[string, string] | [string, Buffer, string, string?]>) {
  const fd = new FormData();
  for (const c of campos) {
    if (c.length === 2) fd.append(c[0], c[1]);
    else fd.append(c[0], new Blob([new Uint8Array(c[1])], c[3] ? { type: c[3] } : {}), c[2]);
  }
  const req = new Request('http://local/', { method: 'POST', body: fd });
  return { payload: Buffer.from(await req.arrayBuffer()), contentType: req.headers.get('content-type') as string };
}

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const EMAIL = Buffer.from('From: Cliente <ok@cliente.com>\r\nSubject: Aprobado\r\nDate: Wed, 7 Oct 2026 10:00:00 -0300\r\n\r\nAprobamos.\r\n');
const pdfUnico = () => Buffer.concat([PDF, Buffer.from(`% ${Math.random()}\n`)]);

async function subirEvidencia(versionId: string, who: Who, bytes: Buffer, o: { type?: string; key?: string | null; name?: string; mime?: string; target?: FastifyInstance; csrf?: boolean } = {}) {
  const mp = await multipart([['type', o.type ?? 'PDF'], ['file', bytes, o.name ?? 'ok-cliente.pdf', o.mime]]);
  const headers: Record<string, string> = { 'content-type': mp.contentType, cookie: who.cookie };
  if (o.csrf !== false) headers['x-csrf-token'] = who.csrf;
  const key = o.key === undefined ? k() : o.key;
  if (key !== null) headers['idempotency-key'] = key;
  return (o.target ?? app).inject({ method: 'POST', url: `/api/v1/show-versions/${versionId}/evidence`, headers, payload: mp.payload });
}

async function evidenciaOk(versionId: string, who: Who = U.apr!, target: FastifyInstance = app) {
  const r = await subirEvidencia(versionId, who, pdfUnico(), { target });
  expect(r.statusCode, r.body).toBe(201);
  return EvidenceResponseSchema.parse(r.json());
}

const decidir = (accion: 'approve' | 'reject', versionId: string, who: Who, body: Record<string, unknown>, key: string | null = k(), target: FastifyInstance = app) =>
  target.inject({
    method: 'POST', url: `/api/v1/show-versions/${versionId}/${accion}`,
    headers: auth(who, { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }), payload: JSON.stringify(body),
  });
const leer = (versionId: string, who: Who, target: FastifyInstance = app) => target.inject({ method: 'GET', url: `/api/v1/show-versions/${versionId}`, headers: { cookie: who.cookie } });
const cuenta = async (tabla: 'approvals' | 'approval_evidence' | 'stored_objects', versionId?: string) => {
  let q = t.app.selectFrom(tabla).select((eb) => eb.fn.countAll<string>().as('n'));
  if (versionId && tabla !== 'stored_objects') q = q.where('show_version_id', '=', versionId);
  return Number((await q.executeTakeFirstOrThrow()).n);
};

describe('CRITERIO C2: GET /api/v1/show-versions/:id', () => {
  it('SUBMITTED con hash exacto, metadatos de hash y sin Approval', async () => {
    const v = await version();
    const r = await leer(v.id, U.soloOp!);
    expect(r.statusCode).toBe(200);
    const b = ShowVersionResponseSchema.parse(r.json());
    expect(b).toMatchObject({ id: v.id, versionHash: v.hash, status: 'SUBMITTED', approval: null, evidence: [], contractId: contratoA, fourEyesRequired: true, submittedBy: U.op!.id });
  });

  it('sin sesión 401; inexistente 404', async () => {
    const v = await version();
    expect((await app.inject({ method: 'GET', url: `/api/v1/show-versions/${v.id}` })).statusCode).toBe(401);
    const r = await leer('00000000-0000-4000-8000-000000000000', U.apr!);
    expect(r.statusCode).toBe(404);
    esError(r.json(), 'SHOW_VERSION_NOT_FOUND');
  });
});

describe('CRITERIO C2: evidencia — bytes reales, allowlist, límite y descarga', () => {
  it('PDF real: 201 con MIME detectado, sha256 y tamaño; queda en la versión y en el audit', async () => {
    const v = await version();
    const bytes = pdfUnico();
    const r = await subirEvidencia(v.id, U.apr!, bytes, { mime: 'text/html' }); // MIME declarado falso, contenido PDF
    expect(r.statusCode, r.body).toBe(201);
    const ev = EvidenceResponseSchema.parse(r.json());
    expect(ev).toMatchObject({ showVersionId: v.id, type: 'PDF', mimeType: 'application/pdf', sizeBytes: bytes.length, uploadedBy: U.apr!.id });
    expect(ev.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const audit = await t.app.selectFrom('audit_events').select(['action', 'after_hash', 'metadata']).where('entity_id', '=', ev.id).execute();
    expect(audit).toEqual([expect.objectContaining({ action: 'EVIDENCE_UPLOADED', after_hash: ev.sha256 })]);
    expect(ShowVersionResponseSchema.parse((await leer(v.id, U.apr!)).json()).evidence.map((e) => e.id)).toEqual([ev.id]);
  });

  it('MIME declarado falso: HTML que dice ser application/pdf → 415 y no se persiste nada', async () => {
    const v = await version();
    const antes = [await cuenta('approval_evidence'), await cuenta('stored_objects')];
    const r = await subirEvidencia(v.id, U.apr!, Buffer.from('<html><script>alert(1)</script></html>'), { mime: 'application/pdf', name: 'aprobado.pdf' });
    expect(r.statusCode).toBe(415);
    esError(r.json(), 'EVIDENCE_UNSUPPORTED_CONTENT');
    expect([await cuenta('approval_evidence'), await cuenta('stored_objects')]).toEqual(antes);
  });

  it('contenido rechazado: ZIP/Office, ejecutable, firma JPEG + ejecutable (auditoría C2 #1) e imagen real → 415', async () => {
    const v = await version();
    const jpegFalso = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('MZ This is not a JPEG; arbitrary executable payload')]);
    for (const bytes of [Buffer.from('PK\x03\x04[Content_Types].xml', 'latin1'), Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1'), jpegFalso, pngReal()]) {
      const r = await subirEvidencia(v.id, U.apr!, bytes, { type: 'PDF', name: 'payload.exe', mime: 'image/jpeg' });
      expect(r.statusCode).toBe(415);
      esError(r.json(), 'EVIDENCE_UNSUPPORTED_CONTENT');
    }
  });

  it('OTHER no está habilitado en C2 → 400 antes de recibir el archivo', async () => {
    const v = await version();
    const r = await subirEvidencia(v.id, U.apr!, pngReal(), { type: 'OTHER', name: 'captura.png' });
    expect(r.statusCode).toBe(400);
    esError(r.json(), 'VALIDATION_ERROR');
    expect(await cuenta('approval_evidence', v.id)).toBe(0);
  });

  it('tipo declarado distinto del detectado → 422 EVIDENCE_TYPE_MISMATCH', async () => {
    const v = await version();
    const r = await subirEvidencia(v.id, U.apr!, pdfUnico(), { type: 'EMAIL' });
    expect(r.statusCode).toBe(422);
    expect(ErrorResponseSchema.parse(r.json())).toMatchObject({ code: 'EVIDENCE_TYPE_MISMATCH', details: { declared: 'EMAIL', detected: 'PDF' } });
    const ok = await subirEvidencia(v.id, U.apr!, EMAIL, { type: 'EMAIL', name: 'ok.eml' });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(EvidenceResponseSchema.parse(ok.json()).mimeType).toBe('message/rfc822');
  });

  it('tamaño: un byte más que el límite → 413; vacío → 422; el límite exacto entra', async () => {
    const chica = await nuevaApp({ maxEvidenceBytes: 200 });
    try {
      const v = await version();
      const base = Buffer.from('mensaje del cliente: ok\n');
      const exacto = Buffer.concat([base, Buffer.alloc(200 - base.length, 0x61)]);
      const ok = await subirEvidencia(v.id, U.apr!, exacto, { type: 'MESSAGE', name: 'chat.txt', target: chica });
      expect(ok.statusCode, ok.body).toBe(201);
      expect(EvidenceResponseSchema.parse(ok.json()).sizeBytes).toBe(200); // ni truncada por el parser ni cortada antes
      const grande = await subirEvidencia(v.id, U.apr!, Buffer.concat([exacto, Buffer.from('b')]), { type: 'MESSAGE', name: 'chat.txt', target: chica });
      expect(grande.statusCode).toBe(413);
      expect(ErrorResponseSchema.parse(grande.json())).toMatchObject({ code: 'EVIDENCE_TOO_LARGE', details: { limitBytes: 200 } });
      const vacia = await subirEvidencia(v.id, U.apr!, Buffer.alloc(0), { type: 'MESSAGE', target: chica });
      expect(vacia.statusCode).toBe(422);
      esError(vacia.json(), 'EVIDENCE_EMPTY');
    } finally { await chica.close(); }
  });

  it('roles, CSRF e Idempotency-Key: OPERATOR 403, sin CSRF 403, sin key 400', async () => {
    const v = await version();
    const op = await subirEvidencia(v.id, U.soloOp!, pdfUnico());
    expect(op.statusCode).toBe(403);
    esError(op.json(), 'FORBIDDEN');
    const sinCsrf = await subirEvidencia(v.id, U.apr!, pdfUnico(), { csrf: false });
    expect(sinCsrf.statusCode).toBe(403);
    esError(sinCsrf.json(), 'CSRF_TOKEN_INVALID');
    const sinKey = await subirEvidencia(v.id, U.apr!, pdfUnico(), { key: null });
    expect(sinKey.statusCode).toBe(400);
    esError(sinKey.json(), 'IDEMPOTENCY_KEY_REQUIRED');
  });

  it('retry con la misma key devuelve la misma evidencia (200); la key con otro contenido → 409', async () => {
    const v = await version();
    const bytes = pdfUnico();
    const key = k();
    const a = await subirEvidencia(v.id, U.apr!, bytes, { key });
    const b = await subirEvidencia(v.id, U.apr!, bytes, { key });
    expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(EvidenceResponseSchema.parse(b.json()).id).toBe(EvidenceResponseSchema.parse(a.json()).id);
    expect(await cuenta('approval_evidence', v.id)).toBe(1);
    const c = await subirEvidencia(v.id, U.apr!, pdfUnico(), { key });
    expect(c.statusCode).toBe(409);
    esError(c.json(), 'IDEMPOTENCY_KEY_REUSED');
  });

  it('descarga: attachment, nosniff, CSP sandbox, MIME detectado y los mismos bytes', async () => {
    const v = await version();
    const bytes = pdfUnico();
    const ev = EvidenceResponseSchema.parse((await subirEvidencia(v.id, U.apr!, bytes, { name: 'payload.exe' })).json());
    expect(ev.originalFilename).toBe('payload.exe'); // queda como metadata
    const r = await app.inject({ method: 'GET', url: `/api/v1/show-versions/${v.id}/evidence/${ev.id}`, headers: { cookie: U.soloOp!.cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    // auditoría C2 #1: el nombre de descarga lo genera el servidor con la extensión del MIME validado
    expect(r.headers['content-disposition']).toBe(`attachment; filename="evidence-${ev.id}.pdf"`);
    expect(String(r.headers['content-disposition'])).not.toContain('.exe');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(Buffer.compare(r.rawPayload, bytes)).toBe(0);
    // evidencia de OTRA versión por esta ruta → 404
    const otra = await version();
    const r2 = await app.inject({ method: 'GET', url: `/api/v1/show-versions/${otra.id}/evidence/${ev.id}`, headers: { cookie: U.apr!.cookie } });
    expect(r2.statusCode).toBe(404);
    esError(r2.json(), 'EVIDENCE_NOT_FOUND');
  });
});

describe('CRITERIO C2: aprobar', () => {
  it('cuatro ojos: quien envió (con los dos roles) no aprueba → 403 FOUR_EYES_VIOLATION', async () => {
    const v = await version();
    const ev = await evidenciaOk(v.id, U.op!);
    const r = await decidir('approve', v.id, U.op!, { evidenceId: ev.id, versionHash: v.hash });
    expect(r.statusCode).toBe(403);
    esError(r.json(), 'FOUR_EYES_VIOLATION');
    expect(await cuenta('approvals', v.id)).toBe(0);
  });

  it('sin evidencia → 400; evidencia de otra versión → 422; hash distinto → 409', async () => {
    const v = await version();
    const otra = await version();
    const evOtra = await evidenciaOk(otra.id);
    const sinEv = await decidir('approve', v.id, U.apr!, { versionHash: v.hash });
    expect(sinEv.statusCode).toBe(400);
    esError(sinEv.json(), 'VALIDATION_ERROR');
    const ajena = await decidir('approve', v.id, U.apr!, { evidenceId: evOtra.id, versionHash: v.hash });
    expect(ajena.statusCode).toBe(422);
    esError(ajena.json(), 'EVIDENCE_NOT_FOUND');
    const ev = await evidenciaOk(v.id);
    const hash = await decidir('approve', v.id, U.apr!, { evidenceId: ev.id, versionHash: sha('otra cosa') });
    expect(hash.statusCode).toBe(409);
    esError(hash.json(), 'VERSION_HASH_MISMATCH');
    expect(await cuenta('approvals', v.id)).toBe(0);
  });

  it('el cliente no elige contrato: un contractId en el cuerpo es 400', async () => {
    const v = await version();
    const ev = await evidenciaOk(v.id);
    const r = await decidir('approve', v.id, U.apr!, { evidenceId: ev.id, versionHash: v.hash, contractId: contratoB });
    expect(r.statusCode).toBe(400);
  });

  it('otra persona aprueba: 201 APPROVED sobre el hash exacto, última aprobada, audit en la misma transacción', async () => {
    const v = await version();
    const ev = await evidenciaOk(v.id);
    const r = await decidir('approve', v.id, U.apr!, { evidenceId: ev.id, versionHash: v.hash });
    expect(r.statusCode, r.body).toBe(201);
    const b = ShowVersionResponseSchema.parse(r.json());
    expect(b).toMatchObject({ status: 'APPROVED', approval: { decision: 'APPROVED', actorUserId: U.apr!.id, evidenceId: ev.id, versionHash: v.hash } });
    const cp = await t.app.selectFrom('campaigns').select('latest_approved_version_id').where('id', '=', v.campaignId).executeTakeFirstOrThrow();
    expect(cp.latest_approved_version_id).toBe(v.id);
    const audit = await t.app.selectFrom('audit_events').select(['action', 'actor_user_id', 'after_hash', 'metadata']).where('entity_id', '=', v.id).execute();
    expect(audit).toEqual([expect.objectContaining({ action: 'VERSION_APPROVED', actor_user_id: U.apr!.id, after_hash: v.hash })]);
    expect((audit[0]?.metadata as Record<string, unknown>).approvalId).toBe(b.approval?.id);
  });

  it('retry duplicado: misma key → 200 con la misma respuesta y UNA sola Approval; otra key → 409 INVALID_STATE_TRANSITION', async () => {
    const v = await version();
    const ev = await evidenciaOk(v.id);
    const key = k();
    const a = await decidir('approve', v.id, U.apr!, { evidenceId: ev.id, versionHash: v.hash }, key);
    const b = await decidir('approve', v.id, U.apr!, { evidenceId: ev.id, versionHash: v.hash }, key);
    expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.json()).toEqual(a.json());
    expect(await cuenta('approvals', v.id)).toBe(1);
    const c = await decidir('approve', v.id, U.apr2!, { evidenceId: ev.id, versionHash: v.hash });
    expect(c.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(c.json())).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { status: 'APPROVED' } });
    // transiciones inválidas desde APPROVED: rechazar y agregar evidencia
    const rej = await decidir('reject', v.id, U.apr2!, { reason: 'tarde', versionHash: v.hash });
    expect(rej.statusCode).toBe(409);
    esError(rej.json(), 'INVALID_STATE_TRANSITION');
    const evTarde = await subirEvidencia(v.id, U.apr2!, pdfUnico());
    expect(evTarde.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(evTarde.json())).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { status: 'APPROVED' } });
    expect(await t.app.selectFrom('audit_events').select('id').where('entity_id', '=', v.id).where('action', '=', 'VERSION_APPROVED').execute()).toHaveLength(1);
  });

  it('carrera: dos aprobadores a la vez con keys distintas → exactamente una Approval', async () => {
    const v = await version();
    const ev = await evidenciaOk(v.id);
    const rs = await Promise.all([U.apr!, U.apr2!].map((w) => decidir('approve', v.id, w, { evidenceId: ev.id, versionHash: v.hash })));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await cuenta('approvals', v.id)).toBe(1);
  });

  it('carrera: el mismo retry en paralelo (misma key) → una sola Approval', async () => {
    const v = await version();
    const ev = await evidenciaOk(v.id);
    const key = k();
    const rs = await Promise.all([1, 2, 3].map(() => decidir('approve', v.id, U.apr!, { evidenceId: ev.id, versionHash: v.hash }, key)));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
    expect(await cuenta('approvals', v.id)).toBe(1);
  });

  it('la última aprobada no retrocede: aprobar v1 después de v2 deja v2', async () => {
    const { campaignId, draftId } = await seedCampaignWithDraft(t.app, contratoA, U.op!.id);
    const mk = async () => {
      const s = await seedVersion(t.app, { campaignId, draftId, submittedBy: U.op!.id, versionHash: sha(`v-${Math.random()}`) });
      return { id: s.id, hash: (await t.app.selectFrom('show_versions').select('version_hash').where('id', '=', s.id).executeTakeFirstOrThrow()).version_hash };
    };
    const v1 = await mk();
    const v2 = await mk();
    for (const v of [v2, v1]) {
      const ev = await evidenciaOk(v.id);
      expect((await decidir('approve', v.id, U.apr!, { evidenceId: ev.id, versionHash: v.hash })).statusCode).toBe(201);
    }
    const cp = await t.app.selectFrom('campaigns').select('latest_approved_version_id').where('id', '=', campaignId).executeTakeFirstOrThrow();
    expect(cp.latest_approved_version_id).toBe(v2.id);
  });
});

describe('CRITERIO C2: rechazar', () => {
  it('motivo obligatorio → 400; con motivo → 201 REJECTED + VERSION_REJECTED; retry no duplica', async () => {
    const v = await version();
    const vacio = await decidir('reject', v.id, U.apr!, { reason: '   ', versionHash: v.hash });
    expect(vacio.statusCode).toBe(400);
    esError(vacio.json(), 'VALIDATION_ERROR');
    const sinMotivo = await decidir('reject', v.id, U.apr!, { versionHash: v.hash });
    expect(sinMotivo.statusCode).toBe(400);
    const key = k();
    const a = await decidir('reject', v.id, U.op!, { reason: 'Cambiar el cierre', versionHash: v.hash }, key); // cuatro ojos no aplica a rechazar
    const b = await decidir('reject', v.id, U.op!, { reason: 'Cambiar el cierre', versionHash: v.hash }, key);
    expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
    expect(ShowVersionResponseSchema.parse(a.json())).toMatchObject({ status: 'REJECTED', approval: { decision: 'REJECTED', reason: 'Cambiar el cierre', evidenceId: null, versionHash: v.hash } });
    expect(await cuenta('approvals', v.id)).toBe(1);
    const audit = await t.app.selectFrom('audit_events').select('action').where('entity_id', '=', v.id).execute();
    expect(audit.map((e) => e.action)).toEqual(['VERSION_REJECTED']);
    // REJECTED es terminal: aprobar después → 409
    const ev = await t.app.selectFrom('approval_evidence').select('id').where('show_version_id', '=', v.id).executeTakeFirst();
    expect(ev).toBeUndefined();
    const ap = await decidir('approve', v.id, U.apr!, { evidenceId: '00000000-0000-4000-8000-000000000000', versionHash: v.hash });
    expect(ap.statusCode).toBe(409);
    esError(ap.json(), 'INVALID_STATE_TRANSITION');
  });

  it('OPERATOR sin rol de aprobación no rechaza → 403; sin Idempotency-Key → 400', async () => {
    const v = await version();
    const r = await decidir('reject', v.id, U.soloOp!, { reason: 'no', versionHash: v.hash });
    expect(r.statusCode).toBe(403);
    const sinKey = await decidir('reject', v.id, U.apr!, { reason: 'no', versionHash: v.hash }, null);
    expect(sinKey.statusCode).toBe(400);
    esError(sinKey.json(), 'IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('CRITERIO C2: cuatro ojos por contrato — solo ADMIN, con audit explícito', () => {
  const put = (contractId: string, who: Who, fourEyesRequired: boolean) =>
    app.inject({ method: 'PUT', url: `/api/v1/contracts/${contractId}/four-eyes`, headers: auth(who, { 'content-type': 'application/json' }), payload: JSON.stringify({ fourEyesRequired }) });

  it('INTERNAL_APPROVER no puede desactivarlo (403); ADMIN sí → FOUR_EYES_DISABLED y el que envió puede aprobar', async () => {
    const ct = (await seedContract(t.app)).id;
    expect((await put(ct, U.apr!, false)).statusCode).toBe(403);
    const r = await put(ct, U.admin!, false);
    expect(r.statusCode).toBe(200);
    expect(FourEyesResponseSchema.parse(r.json())).toEqual({ contractId: ct, fourEyesRequired: false, changed: true });
    const ev1 = await t.app.selectFrom('audit_events').select(['action', 'actor_user_id', 'metadata']).where('entity_id', '=', ct).execute();
    expect(ev1).toEqual([expect.objectContaining({ action: 'FOUR_EYES_DISABLED', actor_user_id: U.admin!.id })]);
    // repetir no genera otro evento
    expect(FourEyesResponseSchema.parse((await put(ct, U.admin!, false)).json()).changed).toBe(false);

    const v = await version(ct);
    const ev = await evidenciaOk(v.id, U.op!);
    const ok = await decidir('approve', v.id, U.op!, { evidenceId: ev.id, versionHash: v.hash });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ShowVersionResponseSchema.parse(ok.json()).fourEyesRequired).toBe(false);

    expect((await put(ct, U.admin!, true)).statusCode).toBe(200);
    const acciones = (await t.app.selectFrom('audit_events').select('action').where('entity_id', '=', ct).orderBy('seq').execute()).map((e) => e.action);
    expect(acciones).toEqual(['FOUR_EYES_DISABLED', 'CONTRACT_UPDATED']);
  });

  it('contrato inexistente → 404', async () => {
    const r = await put('00000000-0000-4000-8000-000000000000', U.admin!, false);
    expect(r.statusCode).toBe(404);
    esError(r.json(), 'CONTRACT_NOT_FOUND');
  });
});

describe('CRITERIO C2: scope de contrato y EXTERNAL_APPROVER', () => {
  it('EXTERNAL_APPROVER con el flag apagado: sin ningún permiso (403)', async () => {
    const v = await version(contratoA);
    const r = await leer(v.id, U.ext!);
    expect(r.statusCode).toBe(403);
    esError(r.json(), 'FORBIDDEN');
    expect((await subirEvidencia(v.id, U.ext!, pdfUnico())).statusCode).toBe(403);
  });

  it('flag prendido: decide sobre SU contrato; el de otro contrato es 404 (acceso cruzado)', async () => {
    const enA = await version(contratoA);
    const enB = await version(contratoB);
    expect((await leer(enA.id, U.ext!, appExt)).statusCode).toBe(200);
    const ev = await evidenciaOk(enA.id, U.ext!, appExt);
    const ok = await decidir('approve', enA.id, U.ext!, { evidenceId: ev.id, versionHash: enA.hash }, k(), appExt);
    expect(ok.statusCode, ok.body).toBe(201);

    const leerB = await leer(enB.id, U.ext!, appExt);
    expect(leerB.statusCode).toBe(404);
    esError(leerB.json(), 'SHOW_VERSION_NOT_FOUND');
    expect((await subirEvidencia(enB.id, U.ext!, pdfUnico(), { target: appExt })).statusCode).toBe(404);
    const evB = await evidenciaOk(enB.id);
    const cruzado = await decidir('approve', enB.id, U.ext!, { evidenceId: evB.id, versionHash: enB.hash }, k(), appExt);
    expect(cruzado.statusCode).toBe(404);
    const rechazoCruzado = await decidir('reject', enB.id, U.ext!, { reason: 'no', versionHash: enB.hash }, k(), appExt);
    expect(rechazoCruzado.statusCode).toBe(404);
    const bajada = await appExt.inject({ method: 'GET', url: `/api/v1/show-versions/${enB.id}/evidence/${evB.id}`, headers: { cookie: U.ext!.cookie } });
    expect(bajada.statusCode).toBe(404);
    expect(await cuenta('approvals', enB.id)).toBe(0);
  });

  it('ver no es decidir: OPERATOR + EXTERNAL_APPROVER de A ve B pero no sube evidencia ni decide en B (403)', async () => {
    const enB = await version(contratoB);
    expect((await leer(enB.id, U.opExt!, appExt)).statusCode).toBe(200);
    const sub = await subirEvidencia(enB.id, U.opExt!, pdfUnico(), { target: appExt });
    expect(sub.statusCode).toBe(403);
    esError(sub.json(), 'FORBIDDEN');
    const evB = await evidenciaOk(enB.id);
    const ap = await decidir('approve', enB.id, U.opExt!, { evidenceId: evB.id, versionHash: enB.hash }, k(), appExt);
    expect(ap.statusCode).toBe(403);
    esError(ap.json(), 'FORBIDDEN');
    expect(await cuenta('approvals', enB.id)).toBe(0);
  });

  it('roles internos alcanzan a todos los contratos (decisión 4 de C1): INTERNAL_APPROVER decide en A y en B', async () => {
    for (const ct of [contratoA, contratoB]) {
      const v = await version(ct);
      const ev = await evidenciaOk(v.id);
      expect((await decidir('approve', v.id, U.apr!, { evidenceId: ev.id, versionHash: v.hash })).statusCode).toBe(201);
    }
  });
});

describe('CRITERIO C2: la cadena de audit queda íntegra', () => {
  it('verifyChain OK después de todo lo anterior y sin datos sensibles en los logs', async () => {
    const r = await verifyChain(t.app);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    const todo = logs.join('');
    for (const w of Object.values(U)) {
      expect(todo).not.toContain(w.cookie.split('=')[1] as string);
      expect(todo).not.toContain(w.csrf);
    }
  });
});
