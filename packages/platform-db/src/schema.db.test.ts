import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDownOne, migrateUp } from './migrator';
import {
  type TestDatabase, createTestDatabase, seedApproval, seedAsset, seedCampaignWithDraft, seedContract, seedEvidence,
  seedStoredObject, seedUser, seedVersion, sha,
} from './testing';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.close(); });

const falla = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { const x = e as { message: string; code?: string }; return `${x.code ?? ''} ${x.message}`; }
  return 'NO FALLÓ';
};
const u = () => `${Math.random().toString(36).slice(2)}@affinitas.com`;

async function campania(fourEyes = true) {
  const op = await seedUser(t.app, u());
  const apr = await seedUser(t.app, u());
  const ct = await seedContract(t.app, { fourEyes });
  const { campaignId, draftId } = await seedCampaignWithDraft(t.app, ct.id, op.id);
  return { op, apr, ct, campaignId, draftId };
}
async function conVersion(fourEyes = true) {
  const c = await campania(fourEyes);
  const v = await seedVersion(t.app, { campaignId: c.campaignId, draftId: c.draftId, submittedBy: c.op.id });
  return { ...c, v };
}
const entrada = (a: { assetId: string; sha256: string }, ref: string) => ({ logicalRef: ref, assetId: a.assetId, sha256: a.sha256 });

/* ══ 1. Versión + manifiesto: sellados ══════════════════════════════ */

describe('CRITERIO: ShowVersion y su manifiesto quedan sellados', () => {
  it('versión con 2 assets → commit → un tercer logicalRef es rechazado (runtime y dueño)', async () => {
    const c = await campania();
    const a1 = await seedAsset(t.app, c.op.id, `m-${Math.random()}`);
    const a2 = await seedAsset(t.app, c.op.id, `h-${Math.random()}`);
    const a3 = await seedAsset(t.app, c.op.id, `x-${Math.random()}`);
    const v = await seedVersion(t.app, { campaignId: c.campaignId, draftId: c.draftId, submittedBy: c.op.id, assets: [entrada(a1, 'masterAssetId'), entrada(a2, 'horizontalAssetId')] });
    const manifiesto = await t.app.selectFrom('show_version_assets').select(['logical_ref', 'stored_object_id']).where('show_version_id', '=', v.id).orderBy('logical_ref').execute();
    expect(manifiesto.map((m) => m.logical_ref)).toEqual(['horizontalAssetId', 'masterAssetId']);
    const tercero = { show_version_id: v.id, logical_ref: 'corrientesAssetId', asset_id: a3.assetId, stored_object_id: a3.storedObjectId!, sha256: a3.sha256 };
    expect(await falla(t.app.insertInto('show_version_assets').values(tercero).execute())).toMatch(/42501|permission denied/);
    expect(await falla(t.owner.insertInto('show_version_assets').values(tercero).execute())).toMatch(/VERSION_SEALED/);
  });

  it('versión APROBADA → agregar un asset es rechazado', async () => {
    const c = await campania();
    const a1 = await seedAsset(t.app, c.op.id, `m-${Math.random()}`);
    const a2 = await seedAsset(t.app, c.op.id, `x-${Math.random()}`);
    const v = await seedVersion(t.app, { campaignId: c.campaignId, draftId: c.draftId, submittedBy: c.op.id, assets: [entrada(a1, 'masterAssetId')] });
    await seedApproval(t.app, v.id, c.apr.id, 'APPROVED');
    expect(await falla(t.owner.insertInto('show_version_assets').values({ show_version_id: v.id, logical_ref: 'horizontalAssetId', asset_id: a2.assetId, stored_object_id: a2.storedObjectId!, sha256: a2.sha256 }).execute())).toMatch(/VERSION_SEALED/);
  });

  it('runtime no puede insertar versiones por fuera de la función atómica', async () => {
    const c = await campania();
    const directo = t.app.insertInto('show_versions').values({
      campaign_id: c.campaignId, source_draft_id: c.draftId, source_draft_revision: 1, version_number: 1, show_package: '{}', version_hash: sha('x'),
      hash_algorithm: 'sha256', canonicalization_version: 'x', hash_envelope_version: 1, show_package_schema_version: 1, compiler_version: '0.1.0', submitted_by: c.op.id,
    }).execute();
    expect(await falla(directo)).toMatch(/42501|permission denied/);
  });

  it('atómica: si un asset del manifiesto no sirve, no queda ni versión ni manifiesto a medias', async () => {
    const c = await campania();
    const bueno = await seedAsset(t.app, c.op.id, `ok-${Math.random()}`);
    const malo = await seedAsset(t.app, c.op.id, `bad-${Math.random()}`, 'REJECTED');
    const r = await falla(seedVersion(t.app, { campaignId: c.campaignId, draftId: c.draftId, submittedBy: c.op.id, assets: [entrada(bueno, 'masterAssetId'), { logicalRef: 'horizontalAssetId', assetId: malo.assetId, sha256: malo.sha256 }] }));
    expect(r).toMatch(/ASSET_NOT_READY/);
    expect(await t.app.selectFrom('show_versions').select('id').where('campaign_id', '=', c.campaignId).execute()).toEqual([]);
  });

  it('UPDATE, DELETE y TRUNCATE rechazados (runtime por permisos; dueño por trigger)', async () => {
    const { v } = await conVersion();
    expect(await falla(t.app.updateTable('show_versions').set({ compiler_version: 'x' }).where('id', '=', v.id).execute())).toMatch(/42501|permission denied/);
    expect(await falla(t.app.deleteFrom('show_versions').where('id', '=', v.id).execute())).toMatch(/42501|permission denied/);
    expect(await falla(t.owner.updateTable('show_versions').set({ compiler_version: 'x' }).where('id', '=', v.id).execute())).toMatch(/IMMUTABLE_ROW/);
    expect(await falla(t.owner.deleteFrom('show_versions').where('id', '=', v.id).execute())).toMatch(/IMMUTABLE_ROW/);
    expect(await falla(sql`TRUNCATE show_versions CASCADE`.execute(t.owner))).toMatch(/IMMUTABLE_ROW/);
  });

  it('no existe columna de estado: el resultado vive solo en Approval', async () => {
    const cols = await sql<{ column_name: string }>`SELECT column_name FROM information_schema.columns WHERE table_name = 'show_versions'`.execute(t.owner);
    expect(cols.rows.map((r) => r.column_name)).not.toContain('status');
  });

  it('el número de versión lo asigna la base, correlativo por campaña', async () => {
    const c = await campania();
    const v1 = await seedVersion(t.app, { campaignId: c.campaignId, draftId: c.draftId, submittedBy: c.op.id });
    const v2 = await seedVersion(t.app, { campaignId: c.campaignId, draftId: c.draftId, submittedBy: c.op.id });
    expect([v1.versionNumber, v2.versionNumber]).toEqual([1, 2]);
  });
});

/* ══ 2. Propiedad relacional: cruces campaña A / campaña B ═══════════ */

describe('CRITERIO: propiedad relacional entre campañas', () => {
  it('A) current_draft_id no puede apuntar al draft de otra campaña', async () => {
    const A = await campania();
    const B = await campania();
    expect(await falla(t.app.updateTable('campaigns').set({ current_draft_id: B.draftId }).where('id', '=', A.campaignId).execute())).toMatch(/23503|foreign key/);
  });

  it('B) latest_approved_version_id: de la misma campaña y con Approval APPROVED', async () => {
    const A = await conVersion();
    const B = await conVersion();
    await seedApproval(t.app, B.v.id, B.apr.id, 'APPROVED');
    // versión aprobada pero de OTRA campaña
    expect(await falla(t.app.updateTable('campaigns').set({ latest_approved_version_id: B.v.id }).where('id', '=', A.campaignId).execute())).toMatch(/23503|foreign key/);
    // versión propia sin aprobación
    expect(await falla(t.app.updateTable('campaigns').set({ latest_approved_version_id: A.v.id }).where('id', '=', A.campaignId).execute())).toMatch(/LATEST_NOT_APPROVED/);
    // versión propia RECHAZADA
    await seedApproval(t.app, A.v.id, A.apr.id, 'REJECTED');
    expect(await falla(t.app.updateTable('campaigns').set({ latest_approved_version_id: A.v.id }).where('id', '=', A.campaignId).execute())).toMatch(/LATEST_NOT_APPROVED/);
    // versión propia APROBADA: sí
    const v2 = await seedVersion(t.app, { campaignId: A.campaignId, draftId: A.draftId, submittedBy: A.op.id });
    await seedApproval(t.app, v2.id, A.apr.id, 'APPROVED');
    await t.app.updateTable('campaigns').set({ latest_approved_version_id: v2.id }).where('id', '=', A.campaignId).execute();
  });

  it('C) una versión no puede salir del draft de otra campaña', async () => {
    const A = await campania();
    const B = await campania();
    expect(await falla(seedVersion(t.app, { campaignId: A.campaignId, draftId: B.draftId, submittedBy: A.op.id }))).toMatch(/23503|foreign key/);
  });

  it('D) la versión fotografía la revisión EXACTA del draft; después el draft sigue', async () => {
    const A = await campania();
    await t.app.updateTable('campaign_drafts').set({ takeover_draft: '{"v":2}', revision: 2 }).where('id', '=', A.draftId).execute();
    expect(await falla(seedVersion(t.app, { campaignId: A.campaignId, draftId: A.draftId, submittedBy: A.op.id, revision: 1 }))).toMatch(/VERSION_DRAFT_REVISION_MISMATCH/);
    const v = await seedVersion(t.app, { campaignId: A.campaignId, draftId: A.draftId, submittedBy: A.op.id, revision: 2 });
    await t.app.updateTable('campaign_drafts').set({ takeover_draft: '{"v":3}', revision: 3 }).where('id', '=', A.draftId).execute();
    const fila = await t.app.selectFrom('show_versions').select('source_draft_revision').where('id', '=', v.id).executeTakeFirstOrThrow();
    expect(fila.source_draft_revision).toBe(2);
  });
});

/* ══ 3. Assets: transiciones y estados terminales ═══════════════════ */

describe('CRITERIO: Asset — transiciones permitidas y terminales inmutables', () => {
  it('un asset nace UPLOADING', async () => {
    const op = await seedUser(t.app, u());
    expect(await falla(t.app.insertInto('assets').values({ original_filename: 'a.mp4', surface_type: 'towers_ab', created_by: op.id, status: 'READY' }).execute())).toMatch(/ASSET_TRANSITION/);
  });

  it('no se saltea VALIDATING ni se vuelve atrás', async () => {
    const op = await seedUser(t.app, u());
    const a = await t.app.insertInto('assets').values({ original_filename: 'a.mp4', surface_type: 'towers_ab', created_by: op.id }).returning('id').executeTakeFirstOrThrow();
    const o = await seedStoredObject(t.app, `o-${Math.random()}`);
    const tecnicos = { stored_object_id: o.storedObjectId, mime_type: 'video/mp4', size_bytes: 1000, width: 2592, height: 576, fps: 25, codec: 'h264', duration_ms: 12000 };
    expect(await falla(t.app.updateTable('assets').set({ status: 'READY', ...tecnicos }).where('id', '=', a.id).execute())).toMatch(/ASSET_TRANSITION/);
    await t.app.updateTable('assets').set({ status: 'VALIDATING', ...tecnicos }).where('id', '=', a.id).execute();
    expect(await falla(t.app.updateTable('assets').set({ status: 'UPLOADING' }).where('id', '=', a.id).execute())).toMatch(/ASSET_TRANSITION/);
  });

  it('READY es terminal: ni contenido técnico ni estado cambian', async () => {
    const op = await seedUser(t.app, u());
    const a = await seedAsset(t.app, op.id, `r-${Math.random()}`);
    expect(await falla(t.app.updateTable('assets').set({ width: 1920 }).where('id', '=', a.assetId).execute())).toMatch(/ASSET_TERMINAL/);
    expect(await falla(t.app.updateTable('assets').set({ status: 'VALIDATING' }).where('id', '=', a.assetId).execute())).toMatch(/ASSET_TERMINAL/);
    const otro = await seedStoredObject(t.app, `otro-${Math.random()}`);
    expect(await falla(t.app.updateTable('assets').set({ stored_object_id: otro.storedObjectId }).where('id', '=', a.assetId).execute())).toMatch(/ASSET_TERMINAL/);
  });

  it('REJECTED es terminal: no vuelve a READY', async () => {
    const op = await seedUser(t.app, u());
    const a = await seedAsset(t.app, op.id, `j-${Math.random()}`, 'REJECTED');
    expect(await falla(t.app.updateTable('assets').set({ status: 'READY', rejection_code: null }).where('id', '=', a.assetId).execute())).toMatch(/ASSET_TERMINAL/);
  });

  it('el manifiesto guarda el objeto físico: Deploy no depende del Asset', async () => {
    const c = await campania();
    const a = await seedAsset(t.app, c.op.id, `d-${Math.random()}`);
    const v = await seedVersion(t.app, { campaignId: c.campaignId, draftId: c.draftId, submittedBy: c.op.id, assets: [entrada(a, 'masterAssetId')] });
    const fila = await t.app.selectFrom('show_version_assets').innerJoin('stored_objects', 'stored_objects.id', 'show_version_assets.stored_object_id')
      .select(['stored_objects.storage_key', 'show_version_assets.sha256']).where('show_version_id', '=', v.id).executeTakeFirstOrThrow();
    expect(fila.storage_key).toBe(`sha256/${a.sha256.slice(0, 2)}/${a.sha256}`);
    expect(fila.sha256).toBe(a.sha256);
  });

  it('el sha256 declarado tiene que ser el del objeto físico', async () => {
    const c = await campania();
    const a = await seedAsset(t.app, c.op.id, `s-${Math.random()}`);
    expect(await falla(seedVersion(t.app, { campaignId: c.campaignId, draftId: c.draftId, submittedBy: c.op.id, assets: [{ logicalRef: 'masterAssetId', assetId: a.assetId, sha256: sha('otro') }] }))).toMatch(/ASSET_SHA_MISMATCH/);
  });
});

/* ══ 4. version_hash no es único global ══════════════════════════════ */

describe('CRITERIO: mismo contenido en dos campañas = dos versiones con el mismo hash', () => {
  it('Campaign A v1 → hash X y Campaign B v1 → hash X conviven', async () => {
    const X = sha(`mismo-contenido-${Math.random()}`);
    const A = await campania();
    const B = await campania();
    const va = await seedVersion(t.app, { campaignId: A.campaignId, draftId: A.draftId, submittedBy: A.op.id, versionHash: X });
    const vb = await seedVersion(t.app, { campaignId: B.campaignId, draftId: B.draftId, submittedBy: B.op.id, versionHash: X });
    expect([va.versionNumber, vb.versionNumber]).toEqual([1, 1]);
    const idx = await sql<{ indexdef: string }>`SELECT indexdef FROM pg_indexes WHERE tablename = 'show_versions' AND indexdef LIKE '%version_hash%'`.execute(t.owner);
    expect(idx.rows.map((r) => r.indexdef).join(' ')).not.toMatch(/UNIQUE/);
  });
});

/* ══ aprobaciones y cuatro ojos (Fase A, se mantienen) ═══════════════ */

describe('aprobaciones — una decisión por versión, con evidencia o motivo', () => {
  it('APPROVED exige evidencia; REJECTED exige motivo', async () => {
    const { v, apr } = await conVersion();
    expect(await falla(t.app.insertInto('approvals').values({ show_version_id: v.id, decision: 'APPROVED', actor_user_id: apr.id }).execute())).toMatch(/23514|check/);
    expect(await falla(t.app.insertInto('approvals').values({ show_version_id: v.id, decision: 'REJECTED', actor_user_id: apr.id, reason: '   ' }).execute())).toMatch(/23514|check/);
  });
  it('una sola decisión final por versión', async () => {
    const { v, apr } = await conVersion();
    await seedApproval(t.app, v.id, apr.id, 'APPROVED');
    expect(await falla(seedApproval(t.app, v.id, apr.id, 'REJECTED'))).toMatch(/23505|duplicate/);
  });
  it('aprobación y evidencia son inmutables', async () => {
    const { v, apr } = await conVersion();
    const a = await seedApproval(t.app, v.id, apr.id, 'APPROVED');
    const ev = await seedEvidence(t.app, apr.id);
    expect(await falla(t.app.updateTable('approvals').set({ reason: 'x' }).where('id', '=', a.id).execute())).toMatch(/42501|permission denied/);
    expect(await falla(t.owner.updateTable('approval_evidence').set({ original_filename: 'otro.eml' }).where('id', '=', ev.id).execute())).toMatch(/IMMUTABLE_ROW/);
  });
});

describe('cuatro ojos POR CONTRATO', () => {
  it('con cuatro ojos: quien envió no aprueba, otra persona sí', async () => {
    const { v, op, apr } = await conVersion(true);
    expect(await falla(seedApproval(t.app, v.id, op.id, 'APPROVED'))).toMatch(/FOUR_EYES_VIOLATION/);
    await seedApproval(t.app, v.id, apr.id, 'APPROVED');
  });
  it('la política afecta solo a su contrato', async () => {
    const sin = await conVersion(false);
    const con = await conVersion(true);
    await seedApproval(t.app, sin.v.id, sin.op.id, 'APPROVED');
    expect(await falla(seedApproval(t.app, con.v.id, con.op.id, 'APPROVED'))).toMatch(/FOUR_EYES_VIOLATION/);
  });
  it('cuatro ojos viene activado por defecto', async () => {
    const col = await sql<{ d: string }>`SELECT column_default AS d FROM information_schema.columns WHERE table_name = 'contracts' AND column_name = 'four_eyes_required'`.execute(t.owner);
    expect(col.rows[0]?.d).toBe('true');
  });
});

describe('objetos físicos, drafts, identidad y permisos (Fase A, se mantienen)', () => {
  it('stored_objects: content-addressed e inmutable', async () => {
    const h = sha(`x-${Math.random()}`);
    expect(await falla(t.app.insertInto('stored_objects').values({ sha256: h, storage_key: 'uploads/master.mp4', mime_type: 'video/mp4', size_bytes: 10 }).execute())).toMatch(/23514|check/);
    const o = await t.app.insertInto('stored_objects').values({ sha256: h, storage_key: `sha256/${h.slice(0, 2)}/${h}.mp4`, mime_type: 'video/mp4', size_bytes: 10 }).returning('id').executeTakeFirstOrThrow();
    expect(await falla(t.owner.updateTable('stored_objects').set({ mime_type: 'x' }).where('id', '=', o.id).execute())).toMatch(/IMMUTABLE_ROW/);
    expect(await falla(t.app.insertInto('stored_objects').values({ sha256: h, storage_key: `sha256/${h.slice(0, 2)}/${h}`, mime_type: 'video/mp4', size_bytes: 10 }).execute())).toMatch(/23505|duplicate/);
  });
  it('revisión monotónica de drafts', async () => {
    const { draftId } = await campania();
    await t.app.updateTable('campaign_drafts').set({ takeover_draft: '{"v":2}', revision: 2 }).where('id', '=', draftId).execute();
    expect(await falla(t.app.updateTable('campaign_drafts').set({ takeover_draft: '{"v":3}', revision: 2 }).where('id', '=', draftId).execute())).toMatch(/DRAFT_REVISION/);
    expect(await falla(t.app.updateTable('campaign_drafts').set({ takeover_draft: '{"v":4}', revision: 4 }).where('id', '=', draftId).execute())).toMatch(/DRAFT_REVISION/);
  });
  it('password Argon2id; email normalizado y único', async () => {
    expect(await falla(t.app.insertInto('users').values({ name: 'x', email: u(), password_hash: 'texto-plano', organization: 'A' }).execute())).toMatch(/23514|check/);
    expect(await falla(t.app.insertInto('users').values({ name: 'x', email: 'Mayus@A.com', password_hash: '$argon2id$x', organization: 'A' }).execute())).toMatch(/23514|check/);
    await seedUser(t.app, 'unico@a.com');
    expect(await falla(seedUser(t.app, 'unico@a.com'))).toMatch(/23505|duplicate/);
  });
  it('aprobador externo solo atado a un contrato; internos nunca', async () => {
    const usr = await seedUser(t.app, u());
    const ct = await seedContract(t.app);
    expect(await falla(t.app.insertInto('user_roles').values({ user_id: usr.id, role: 'EXTERNAL_APPROVER', contract_id: null }).execute())).toMatch(/23514|check/);
    expect(await falla(t.app.insertInto('user_roles').values({ user_id: usr.id, role: 'OPERATOR', contract_id: ct.id }).execute())).toMatch(/23514|check/);
    await t.app.insertInto('user_roles').values({ user_id: usr.id, role: 'EXTERNAL_APPROVER', contract_id: ct.id }).execute();
  });
  it('runtime sin DDL ni TRUNCATE', async () => {
    expect(await falla(sql`CREATE TABLE intruso (x int)`.execute(t.app))).toMatch(/42501|permission denied/);
    expect(await falla(sql`TRUNCATE users CASCADE`.execute(t.app))).toMatch(/42501|permission denied/);
  });
});

describe('migraciones', () => {
  it('up sobre base vacía, down y up de nuevo (smoke test reversible)', async () => {
    const vacia = await createTestDatabase({ migrate: false });
    try {
      expect(await migrateUp(vacia.owner as never)).toEqual(['0001_initial:Success']);
      expect(await migrateDownOne(vacia.owner as never)).toEqual(['0001_initial:Success']);
      const n = await sql<{ n: string }>`SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'show_versions'`.execute(vacia.owner);
      expect(n.rows[0]?.n).toBe('0');
      expect(await migrateUp(vacia.owner as never)).toEqual(['0001_initial:Success']);
    } finally { await vacia.close(); }
  });
  it('con datos: volver a migrar no toca nada', async () => {
    const { v } = await conVersion();
    expect(await migrateUp(t.owner as never)).toEqual([]);
    expect(await t.app.selectFrom('show_versions').select('id').where('id', '=', v.id).executeTakeFirst()).toBeTruthy();
  });
});
