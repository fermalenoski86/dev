import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from './schema';
import { type ManifestEntry, createShowVersion } from './show-versions';

/** Datos de prueba mínimos y reales (sin mocks), por los caminos reales. Solo para tests. */
export const ARGON = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function seedUser(db: Kysely<Database>, email: string) {
  return db.insertInto('users').values({ name: email, email, password_hash: ARGON, organization: 'Affinitas' }).returning('id').executeTakeFirstOrThrow();
}

export async function seedContract(db: Kysely<Database>, opts: { fourEyes?: boolean } = {}) {
  const adv = await db.insertInto('advertisers').values({ legal_name: 'Arcos Dorados SA', tax_id: `30-${Math.random().toString().slice(2, 12)}-1`, contacts: '[]' }).returning('id').executeTakeFirstOrThrow();
  return db
    .insertInto('contracts')
    .values({ advertiser_id: adv.id, name: 'Takeover 2026', starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z', allowed_surfaces: ['screen_a', 'screen_b', 'horizontal'], four_eyes_required: opts.fourEyes ?? true, metadata: '{}' })
    .returning('id')
    .executeTakeFirstOrThrow();
}

export async function seedCampaignWithDraft(db: Kysely<Database>, contractId: string, userId: string) {
  return db.transaction().execute(async (trx) => {
    const c = await trx.insertInto('campaigns').values({ contract_id: contractId, name: 'Launch' }).returning('id').executeTakeFirstOrThrow();
    const d = await trx.insertInto('campaign_drafts').values({ campaign_id: c.id, takeover_draft: '{"name":"Launch"}', created_by: userId }).returning('id').executeTakeFirstOrThrow();
    await trx.updateTable('campaigns').set({ current_draft_id: d.id }).where('id', '=', c.id).execute();
    return { campaignId: c.id, draftId: d.id };
  });
}

export async function seedStoredObject(db: Kysely<Database>, contenido: string, mime = 'video/mp4') {
  const h = sha(contenido);
  const o = await db.insertInto('stored_objects').values({ sha256: h, storage_key: `sha256/${h.slice(0, 2)}/${h}`, mime_type: mime, size_bytes: 1000 }).returning('id').executeTakeFirstOrThrow();
  return { storedObjectId: o.id, sha256: h };
}

/** UPLOADING → VALIDATING → READY (o → REJECTED), como en la Fase B. */
export async function seedAsset(db: Kysely<Database>, userId: string, contenido: string, fin: 'READY' | 'REJECTED' = 'READY') {
  const a = await db.insertInto('assets').values({ original_filename: 'master.mp4', surface_type: 'towers_ab', created_by: userId }).returning('id').executeTakeFirstOrThrow();
  if (fin === 'REJECTED') {
    await db.updateTable('assets').set({ status: 'REJECTED', rejection_code: 'ASSET_BAD_FPS' }).where('id', '=', a.id).execute();
    return { assetId: a.id, sha256: sha(contenido), storedObjectId: null as string | null };
  }
  const o = await seedStoredObject(db, contenido);
  await db.updateTable('assets').set({ status: 'VALIDATING', stored_object_id: o.storedObjectId, sha256: o.sha256, container: 'MP4', mime_type: 'video/mp4', size_bytes: 1000, width: 2592, height: 576, fps: 25, codec: 'h264', duration_ms: 12000 }).where('id', '=', a.id).execute();
  await db.updateTable('assets').set({ status: 'READY' }).where('id', '=', a.id).execute();
  return { assetId: a.id, sha256: o.sha256, storedObjectId: o.storedObjectId as string | null };
}

const SIN_AUDITORIA = async () => {};

/** Crea una versión por el camino único. `audit` explícito; en tests de esquema, ninguno. */
export async function seedVersion(
  db: Kysely<Database>,
  args: { campaignId: string; draftId: string; submittedBy: string; assets?: ManifestEntry[]; versionHash?: string; revision?: number },
  audit: Parameters<typeof createShowVersion>[2] = SIN_AUDITORIA,
) {
  return db.transaction().execute((trx) =>
    createShowVersion(trx, {
      campaignId: args.campaignId, sourceDraftId: args.draftId, sourceDraftRevision: args.revision ?? 1, showPackage: { id: 's' },
      versionHash: args.versionHash ?? sha(`v-${Math.random()}`), hashAlgorithm: 'sha256', canonicalizationVersion: 'jcs-rfc8785/canonicalize@5.1.0',
      hashEnvelopeVersion: 1, showPackageSchemaVersion: 1, compilerVersion: '0.1.0', submittedBy: args.submittedBy, assets: args.assets ?? [],
    }, audit),
  );
}

/** Evidencia de UNA versión (0003). Por defecto un EMAIL (message/rfc822). */
export async function seedEvidence(db: Kysely<Database>, userId: string, versionId: string, contenido = `mail-${Math.random()}`) {
  const o = await seedStoredObject(db, contenido, 'message/rfc822');
  return db.insertInto('approval_evidence').values({ show_version_id: versionId, type: 'EMAIL', original_filename: 'ok-cliente.eml', stored_object_id: o.storedObjectId, uploaded_by: userId }).returning('id').executeTakeFirstOrThrow();
}

/** Decisión directa en la base, citando el hash real de la versión (0003). */
export async function seedApproval(db: Kysely<Database>, versionId: string, actorId: string, decision: 'APPROVED' | 'REJECTED' = 'APPROVED') {
  const ev = decision === 'APPROVED' ? await seedEvidence(db, actorId, versionId) : null;
  const v = await db.selectFrom('show_versions').select('version_hash').where('id', '=', versionId).executeTakeFirstOrThrow();
  return db.insertInto('approvals').values({ show_version_id: versionId, decision, actor_user_id: actorId, evidence_id: ev?.id ?? null, reason: decision === 'REJECTED' ? 'Cambiar el cierre' : null, version_hash: v.version_hash }).returning(['id', 'evidence_id']).executeTakeFirstOrThrow();
}
