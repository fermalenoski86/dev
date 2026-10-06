import { type TestDatabase, createTestDatabase, seedAsset, seedCampaignWithDraft, seedContract, seedUser, seedVersion } from '@trust/platform-db/testing';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@trust/platform-db';
import { GENESIS_HASH, appendAuditEvent, verifyChain } from './index';

let t: TestDatabase;
let actor: string;
beforeAll(async () => {
  t = await createTestDatabase();
  actor = (await seedUser(t.app, 'auditor@affinitas.com')).id;
});
afterAll(async () => { await t?.close(); });

const falla = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { const x = e as { message: string; code?: string }; return `${x.code ?? ''} ${x.message}`; }
  return 'NO FALLÓ';
};
const append = (db: Kysely<Database>, n: number) =>
  db.transaction().execute((trx) => appendAuditEvent(trx, { actorUserId: actor, action: 'DRAFT_UPDATED', entityType: 'campaign_draft', entityId: null, metadata: { n } }));

describe('CRITERIO: cadena de auditoría', () => {
  it('append encadena desde el génesis y verifyChain la valida', async () => {
    const e1 = await append(t.app, 1);
    const e2 = await append(t.app, 2);
    expect(e1.seq).toBe(1);
    expect(e1.previousEventHash).toBe(GENESIS_HASH);
    expect(e2.previousEventHash).toBe(e1.eventHash);
    expect(await verifyChain(t.app)).toEqual({ ok: true, length: 2, problems: [] });
  });

  it('append fuera de una transacción se rechaza: el lock no serializaría nada', async () => {
    await expect(appendAuditEvent(t.app, { actorUserId: actor, action: 'DRAFT_UPDATED', entityType: 'x', entityId: null })).rejects.toThrow(/transacción/);
  });

  it('CRITERIO: concurrencia real — dos conexiones a la vez, nunca el mismo predecesor', async () => {
    // Dos pools separados = dos conexiones físicas compitiendo por la cabeza.
    const otra = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: t.appUrl, max: 4 }) }) });
    try {
      const antes = (await verifyChain(t.app)).length;
      const N = 15;
      const resultados = await Promise.all(
        Array.from({ length: N }, (_, i) => [append(t.app, 100 + i), append(otra, 200 + i)]).flat(),
      );
      const predecesores = resultados.map((r) => r.previousEventHash);
      expect(new Set(predecesores).size).toBe(predecesores.length);           // sin forks
      expect(resultados.map((r) => r.seq).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 2 * N }, (_, i) => antes + 1 + i),               // secuencia continua
      );
      expect(await verifyChain(t.app)).toEqual({ ok: true, length: antes + 2 * N, problems: [] });
    } finally { await otra.destroy(); }
  });

  it('la base rechaza un fork aunque el código lo intente', async () => {
    const e = await append(t.app, 300);
    // Un INSERT a mano que reusa un predecesor viejo: lo frena el trigger.
    const fork = t.app.transaction().execute((trx) => trx.insertInto('audit_events').values({
      seq: e.seq + 1, actor_user_id: actor, action: 'DRAFT_UPDATED', entity_type: 'x', occurred_at: new Date().toISOString(),
      metadata: '{}', previous_event_hash: e.previousEventHash, event_hash: 'a'.repeat(64),
    }).execute());
    expect(await falla(fork)).toMatch(/AUDIT_FORK|23505/);
    // Y una seq que saltea un número, también.
    const salto = t.app.transaction().execute((trx) => trx.insertInto('audit_events').values({
      seq: e.seq + 5, actor_user_id: actor, action: 'DRAFT_UPDATED', entity_type: 'x', occurred_at: new Date().toISOString(),
      metadata: '{}', previous_event_hash: e.eventHash, event_hash: 'b'.repeat(64),
    }).execute());
    expect(await falla(salto)).toMatch(/AUDIT_SEQ/);
  });

  it('runtime no puede UPDATE ni DELETE sobre audit_events (permisos)', async () => {
    expect(await falla(t.app.updateTable('audit_events').set({ action: 'X' }).where('seq', '=', '1').execute())).toMatch(/42501|permission denied/);
    expect(await falla(t.app.deleteFrom('audit_events').where('seq', '=', '1').execute())).toMatch(/42501|permission denied/);
    expect(await falla(sql`UPDATE audit_head SET last_seq = 0`.execute(t.app))).toMatch(/42501|permission denied/);
  });

  it('CRITERIO: una alteración directa (con control total de la base) se DETECTA', async () => {
    expect((await verifyChain(t.app)).ok).toBe(true);
    // Simula a alguien con control del esquema: desactiva la protección y edita.
    await sql`ALTER TABLE audit_events DISABLE TRIGGER audit_immutable`.execute(t.owner);
    await sql`UPDATE audit_events SET metadata = '{"n": 999}'::jsonb WHERE seq = 2`.execute(t.owner);
    await sql`ALTER TABLE audit_events ENABLE TRIGGER audit_immutable`.execute(t.owner);
    const r = await verifyChain(t.app);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/seq 2: eventHash no coincide/);
  });
});

describe('CRITERIO: createShowVersion registra su auditoría en la MISMA transacción', () => {
  // Base propia: el bloque anterior altera la cadena a propósito para probar la detección.
  let t: TestDatabase;
  beforeAll(async () => { t = await createTestDatabase(); });
  afterAll(async () => { await t?.close(); });
  const auditar = (actor: string) => (trx: Kysely<Database>, v: { id: string; versionNumber: number }) =>
    appendAuditEvent(trx, { actorUserId: actor, action: 'VERSION_SUBMITTED', entityType: 'show_version', entityId: v.id, metadata: { versionNumber: v.versionNumber } });

  it('versión creada ⇒ evento VERSION_SUBMITTED en la cadena, y la cadena sigue válida', async () => {
    const op = await seedUser(t.app, `op-${Math.random()}@affinitas.com`);
    const ct = await seedContract(t.app);
    const c = await seedCampaignWithDraft(t.app, ct.id, op.id);
    const a = await seedAsset(t.app, op.id, `m-${Math.random()}`);
    const v = await seedVersion(t.app, { campaignId: c.campaignId, draftId: c.draftId, submittedBy: op.id, assets: [{ logicalRef: 'masterAssetId', assetId: a.assetId, sha256: a.sha256 }] }, auditar(op.id));
    const ev = await t.app.selectFrom('audit_events').select(['action', 'entity_id']).where('entity_id', '=', v.id).execute();
    expect(ev).toEqual([{ action: 'VERSION_SUBMITTED', entity_id: v.id }]);
    expect((await verifyChain(t.app)).ok).toBe(true);
  });

  it('si el manifiesto falla, no queda versión NI evento de auditoría', async () => {
    const op = await seedUser(t.app, `op-${Math.random()}@affinitas.com`);
    const ct = await seedContract(t.app);
    const c = await seedCampaignWithDraft(t.app, ct.id, op.id);
    const malo = await seedAsset(t.app, op.id, `x-${Math.random()}`, 'REJECTED');
    const antes = (await verifyChain(t.app)).length;
    await expect(seedVersion(t.app, { campaignId: c.campaignId, draftId: c.draftId, submittedBy: op.id, assets: [{ logicalRef: 'masterAssetId', assetId: malo.assetId, sha256: malo.sha256 }] }, auditar(op.id))).rejects.toThrow(/ASSET_NOT_READY/);
    expect((await verifyChain(t.app)).length).toBe(antes);
    expect(await t.app.selectFrom('show_versions').select('id').where('campaign_id', '=', c.campaignId).execute()).toEqual([]);
  });
});
