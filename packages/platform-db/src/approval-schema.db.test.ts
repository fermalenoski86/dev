import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type TestDatabase, createTestDatabase, seedApproval, seedCampaignWithDraft, seedContract, seedEvidence, seedStoredObject, seedUser, seedVersion, sha,
} from './testing';

/** 0003 — evidencia atada a su versión, allowlist tipo↔MIME y hash exacto en la Approval. */
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.close(); });

const falla = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { const x = e as { message: string; code?: string }; return `${x.code ?? ''} ${x.message}`; }
  return 'NO FALLÓ';
};
const u = () => `${Math.random().toString(36).slice(2)}@affinitas.com`;

async function version() {
  const op = await seedUser(t.app, u());
  const apr = await seedUser(t.app, u());
  const ct = await seedContract(t.app);
  const { campaignId, draftId } = await seedCampaignWithDraft(t.app, ct.id, op.id);
  const v = await seedVersion(t.app, { campaignId, draftId, submittedBy: op.id, versionHash: sha(`h-${Math.random()}`) });
  const { version_hash } = await t.app.selectFrom('show_versions').select('version_hash').where('id', '=', v.id).executeTakeFirstOrThrow();
  return { op, apr, v, hash: version_hash, campaignId, draftId };
}
const evidencia = async (versionId: string, userId: string, type: 'EMAIL' | 'PDF' | 'MESSAGE' | 'OTHER', mime: string) => {
  const o = await seedStoredObject(t.app, `ev-${Math.random()}`, mime);
  return t.app.insertInto('approval_evidence').values({ show_version_id: versionId, type, original_filename: 'x', stored_object_id: o.storedObjectId, uploaded_by: userId }).returning('id').executeTakeFirstOrThrow();
};

describe('CRITERIO C2 (0003): evidencia', () => {
  it('cada tipo acepta solo su MIME de la allowlist cerrada', async () => {
    const { v, apr } = await version();
    await evidencia(v.id, apr.id, 'PDF', 'application/pdf');
    await evidencia(v.id, apr.id, 'EMAIL', 'message/rfc822');
    await evidencia(v.id, apr.id, 'MESSAGE', 'text/plain');
    // OTHER no tiene ningún MIME admitido en C2 (auditoría C2 #1)
    expect(await falla(evidencia(v.id, apr.id, 'OTHER', 'image/png'))).toMatch(/EVIDENCE_TYPE_MISMATCH/);
    expect(await falla(evidencia(v.id, apr.id, 'OTHER', 'image/jpeg'))).toMatch(/EVIDENCE_TYPE_MISMATCH/);
    expect(await falla(evidencia(v.id, apr.id, 'PDF', 'text/html'))).toMatch(/EVIDENCE_TYPE_MISMATCH/);
    expect(await falla(evidencia(v.id, apr.id, 'OTHER', 'video/mp4'))).toMatch(/EVIDENCE_TYPE_MISMATCH/);
    expect(await falla(evidencia(v.id, apr.id, 'EMAIL', 'application/pdf'))).toMatch(/EVIDENCE_TYPE_MISMATCH/);
  });

  it('la evidencia exige versión', async () => {
    const { apr } = await version();
    const o = await seedStoredObject(t.app, `ev-${Math.random()}`, 'application/pdf');
    expect(await falla(t.app.insertInto('approval_evidence').values({ type: 'PDF', original_filename: 'x', stored_object_id: o.storedObjectId, uploaded_by: apr.id } as never).execute())).toMatch(/23502|null value/);
  });

  it('no se agrega evidencia a una versión ya decidida', async () => {
    const { v, apr } = await version();
    await seedApproval(t.app, v.id, apr.id, 'REJECTED');
    expect(await falla(seedEvidence(t.app, apr.id, v.id))).toMatch(/EVIDENCE_AFTER_DECISION/);
  });
});

describe('CRITERIO C2 (0003): la Approval cita la versión exacta', () => {
  it('hash distinto del de la versión → APPROVAL_HASH_MISMATCH', async () => {
    const { v, apr } = await version();
    expect(await falla(t.app.insertInto('approvals').values({ show_version_id: v.id, decision: 'REJECTED', actor_user_id: apr.id, reason: 'no', version_hash: sha('otro') }).execute())).toMatch(/APPROVAL_HASH_MISMATCH/);
  });

  it('evidencia de OTRA versión no respalda la aprobación (FK compuesta)', async () => {
    const a = await version();
    const b = await version();
    const evB = await seedEvidence(t.app, b.apr.id, b.v.id);
    expect(await falla(t.app.insertInto('approvals').values({ show_version_id: a.v.id, decision: 'APPROVED', actor_user_id: a.apr.id, evidence_id: evB.id, version_hash: a.hash }).execute())).toMatch(/23503|approvals_evidence_same_version/);
    const evA = await seedEvidence(t.app, a.apr.id, a.v.id);
    await t.app.insertInto('approvals').values({ show_version_id: a.v.id, decision: 'APPROVED', actor_user_id: a.apr.id, evidence_id: evA.id, version_hash: a.hash }).execute();
  });
});
