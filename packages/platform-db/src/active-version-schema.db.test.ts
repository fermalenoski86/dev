import { type Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDownOne, migrateUp, migrator } from './migrator';
import type { Database } from './schema';
import { type TestDatabase, createTestDatabase, seedApproval, seedCampaignWithDraft, seedContract, seedUser, seedVersion } from './testing';

/**
 * F3(a) · 0004 — la base como segunda barrera de la versión vigente
 * (brief §1, §6.6, §6.12, §6.14). PostgreSQL real; sin la app en el medio.
 */
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.close(); });

const falla = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { const x = e as { message: string; code?: string }; return `${x.code ?? ''} ${x.message}`; }
  return 'NO FALLÓ';
};
const u = () => `${Math.random().toString(36).slice(2)}@affinitas.com`;

async function campaniaCon(db: Kysely<Database>, decisiones: Array<'APPROVED' | 'REJECTED' | null>) {
  const op = await seedUser(db, u());
  const apr = await seedUser(db, u());
  const ct = await seedContract(db);
  const { campaignId, draftId } = await seedCampaignWithDraft(db, ct.id, op.id);
  const vs: Array<{ id: string; hash: string }> = [];
  for (const d of decisiones) {
    const v = await seedVersion(db, { campaignId, draftId, submittedBy: op.id });
    if (d) await seedApproval(db, v.id, apr.id, d);
    const { version_hash } = await db.selectFrom('show_versions').select('version_hash').where('id', '=', v.id).executeTakeFirstOrThrow();
    vs.push({ id: v.id, hash: version_hash });
  }
  return { op, apr, campaignId, vs };
}

const pedir = (db: Kysely<Database>, c: { campaignId: string; op: { id: string } }, to: { id: string; hash: string }, from: string | null = null) =>
  db.insertInto('active_version_changes').values({
    campaign_id: c.campaignId, from_version_id: from, to_version_id: to.id, to_version_hash: to.hash, reason: 'volver a la anterior',
    requested_by: c.op.id, expires_at: sql<string>`now() + interval '1 hour'` as unknown as string,
  }).returning('id').executeTakeFirstOrThrow();

const vigente = async (campaignId: string) =>
  (await sql<{ a: string | null }>`SELECT active_version_id AS a FROM campaigns WHERE id = ${campaignId}::uuid`.execute(t.owner)).rows[0]?.a ?? null;

describe('CRITERIO F3(a) §6.6: segunda barrera del puntero', () => {
  it('trust_app no puede escribir active_version_id (sin privilegio de columna)', async () => {
    const c = await campaniaCon(t.app, ['APPROVED']);
    expect(await falla(sql`UPDATE campaigns SET active_version_id = ${c.vs[0]!.id}::uuid WHERE id = ${c.campaignId}::uuid`.execute(t.app))).toMatch(/42501|permission denied/);
    // sí sigue pudiendo con las columnas de siempre
    await t.app.updateTable('campaigns').set({ name: 'Renombrada' }).where('id', '=', c.campaignId).execute();
    expect(await vigente(c.campaignId)).toBeNull();
  });

  it('ni el dueño fija una vigente SUBMITTED, REJECTED o de otra campaña', async () => {
    const c = await campaniaCon(t.app, [null, 'REJECTED', 'APPROVED']);
    const otra = await campaniaCon(t.app, ['APPROVED']);
    const upd = (v: string) => sql`UPDATE campaigns SET active_version_id = ${v}::uuid WHERE id = ${c.campaignId}::uuid`.execute(t.owner);
    expect(await falla(upd(c.vs[0]!.id))).toMatch(/ACTIVE_NOT_APPROVED/);
    expect(await falla(upd(c.vs[1]!.id))).toMatch(/ACTIVE_NOT_APPROVED/);
    expect(await falla(upd(otra.vs[0]!.id))).toMatch(/23503|campaigns_active_version_fk/);
    await upd(c.vs[2]!.id); // APPROVED de esta campaña: la base lo admite
    expect(await vigente(c.campaignId)).toBe(c.vs[2]!.id);
  });
});

describe('CRITERIO F3(a) §1.3: pedidos inmutables salvo la transición única', () => {
  it('un pedido nace PENDING, hacia una APPROVED con su hash exacto, uno solo por campaña', async () => {
    const c = await campaniaCon(t.app, ['APPROVED', null]);
    expect(await falla(pedir(t.app, c, c.vs[1]!))).toMatch(/ACTIVE_NOT_APPROVED/);
    expect(await falla(pedir(t.app, c, { id: c.vs[0]!.id, hash: c.vs[1]!.hash }))).toMatch(/VERSION_HASH_MISMATCH/);
    expect(await falla(sql`INSERT INTO active_version_changes (campaign_id, to_version_id, to_version_hash, reason, requested_by, expires_at, status)
      VALUES (${c.campaignId}::uuid, ${c.vs[0]!.id}::uuid, ${c.vs[0]!.hash}, 'x', ${c.op.id}::uuid, now() + interval '1 hour', 'CONFIRMED')`.execute(t.app))).toMatch(/INVALID_STATE_TRANSITION/);
    const p = await pedir(t.app, c, c.vs[0]!);
    expect(await falla(pedir(t.app, c, c.vs[0]!))).toMatch(/23505|avc_one_pending_per_campaign/);
    const fila = await t.app.selectFrom('active_version_changes').select(['status', 'requested_at', 'expires_at']).where('id', '=', p.id).executeTakeFirstOrThrow();
    expect(fila.status).toBe('PENDING');
  });

  it('CONFIRMED solo por la función; nada cambia fuera del estado; sin DELETE; no vence antes de tiempo', async () => {
    const c = await campaniaCon(t.app, ['APPROVED']);
    const p = await pedir(t.app, c, c.vs[0]!);
    const otro = await seedUser(t.app, u());
    expect(await falla(sql`UPDATE active_version_changes SET status = 'CONFIRMED', decided_by = ${otro.id}::uuid WHERE id = ${p.id}::uuid`.execute(t.app))).toMatch(/CONFIRM_ONLY_VIA_FUNCTION/);
    expect(await falla(sql`UPDATE active_version_changes SET reason = 'otro' WHERE id = ${p.id}::uuid`.execute(t.app))).toMatch(/INVALID_STATE_TRANSITION|IMMUTABLE_ROW/);
    expect(await falla(sql`UPDATE active_version_changes SET status = 'EXPIRED' WHERE id = ${p.id}::uuid`.execute(t.app))).toMatch(/NOT_EXPIRED/);
    expect(await falla(sql`DELETE FROM active_version_changes WHERE id = ${p.id}::uuid`.execute(t.app))).toMatch(/42501|permission denied/);
    expect(await falla(sql`DELETE FROM active_version_changes WHERE id = ${p.id}::uuid`.execute(t.owner))).toMatch(/IMMUTABLE_ROW/);
    // el dueño tampoco confirma su propio pedido (trigger + CHECK)
    expect(await falla(sql`UPDATE active_version_changes SET status = 'CONFIRMED', decided_by = ${c.op.id}::uuid WHERE id = ${p.id}::uuid`.execute(t.owner))).toMatch(/FOUR_EYES_VIOLATION/);
    await sql`UPDATE active_version_changes SET status = 'CANCELLED', decided_by = ${c.op.id}::uuid WHERE id = ${p.id}::uuid`.execute(t.app);
    expect(await falla(sql`UPDATE active_version_changes SET status = 'EXPIRED', decided_by = NULL WHERE id = ${p.id}::uuid`.execute(t.app))).toMatch(/INVALID_STATE_TRANSITION/);
  });

  it('la función, llamada directo por trust_app, frena al que pidió (cuatro ojos sin la app)', async () => {
    const c = await campaniaCon(t.app, ['APPROVED']);
    const p = await pedir(t.app, c, c.vs[0]!);
    // lo frena la FUNCIÓN (no el trigger que vendría después): el error sale de su propio RAISE
    const e = await sql`SELECT trust_confirm_active_version_change(${p.id}::uuid, ${c.op.id}::uuid, ${c.vs[0]!.hash})`.execute(t.app).then(() => null, (x: unknown) => x as { message: string; where?: string });
    expect(e?.message).toMatch(/^FOUR_EYES_VIOLATION/);
    expect(e?.where).toMatch(/function trust_confirm_active_version_change\(uuid,uuid,text\) line \d+ at RAISE/);
    expect(e?.where).not.toMatch(/trust_avc_transition/);
    expect(await falla(sql`SELECT trust_confirm_active_version_change(${p.id}::uuid, ${c.apr.id}::uuid, ${'0'.repeat(64)})`.execute(t.app))).toMatch(/VERSION_HASH_MISMATCH/);
    expect(await vigente(c.campaignId)).toBeNull();
    const r = await sql<{ o: string }>`SELECT trust_confirm_active_version_change(${p.id}::uuid, ${c.apr.id}::uuid, ${c.vs[0]!.hash}) AS o`.execute(t.app);
    expect(r.rows[0]?.o).toBe('CONFIRMED');
    expect(await vigente(c.campaignId)).toBe(c.vs[0]!.id);
    expect(await falla(sql`SELECT trust_confirm_active_version_change(${p.id}::uuid, ${c.apr.id}::uuid, ${c.vs[0]!.hash})`.execute(t.app))).toMatch(/INVALID_STATE_TRANSITION/);
  });

  it('§6.15 en la función: NULL de los dos lados se compara con IS NOT DISTINCT FROM', async () => {
    // pedido de primera selección (from NULL) y vigente puesta por fuera → CONFLICT
    const c = await campaniaCon(t.app, ['APPROVED', 'APPROVED']);
    const p = await pedir(t.app, c, c.vs[1]!, null);
    await sql`UPDATE campaigns SET active_version_id = ${c.vs[0]!.id}::uuid WHERE id = ${c.campaignId}::uuid`.execute(t.owner);
    const r = await sql<{ o: string }>`SELECT trust_confirm_active_version_change(${p.id}::uuid, ${c.apr.id}::uuid, ${c.vs[1]!.hash}) AS o`.execute(t.app);
    expect(r.rows[0]?.o).toBe('CONFLICT');
    expect(await vigente(c.campaignId)).toBe(c.vs[0]!.id);
    expect((await t.app.selectFrom('active_version_changes').select('status').where('id', '=', p.id).executeTakeFirstOrThrow()).status).toBe('CANCELLED');
  });
});

describe('CRITERIO F3(a) §6.14: función SECURITY DEFINER endurecida', () => {
  it('search_path termina en pg_temp; PUBLIC sin EXECUTE; trust_app con EXECUTE; sin UPDATE de la columna', async () => {
    const f = await sql<{ conf: string[] | null; acl: string | null; definer: boolean }>`
      SELECT proconfig AS conf, proacl::text AS acl, prosecdef AS definer FROM pg_proc WHERE proname = 'trust_confirm_active_version_change'`.execute(t.owner);
    const row = f.rows[0]!;
    expect(row.definer).toBe(true);
    const sp = (row.conf ?? []).find((c) => c.startsWith('search_path='));
    expect(sp?.replace(/\s/g, '')).toBe('search_path=public,pg_temp');
    // una entrada de ACL de PUBLIC empieza con "=" (sin rol): no tiene que haber ninguna
    expect(row.acl).not.toBeNull();
    expect((row.acl ?? '').replace(/^\{|\}$/g, '').split(',').some((e) => e.startsWith('='))).toBe(false);
    const p = await sql<{ app: boolean; col: boolean; otras: boolean }>`
      SELECT has_function_privilege('trust_app', 'trust_confirm_active_version_change(uuid, uuid, text)', 'EXECUTE') AS app,
             has_column_privilege('trust_app', 'campaigns', 'active_version_id', 'UPDATE') AS col,
             has_column_privilege('trust_app', 'campaigns', 'latest_approved_version_id', 'UPDATE') AS otras`.execute(t.owner);
    expect(p.rows[0]).toEqual({ app: true, col: false, otras: true });
  });
});

describe('CRITERIO F3(a) §6.12: migración 0004 con datos poblados', () => {
  it('todas las campañas quedan sin vigente (sin backfill); down y up de nuevo con el mismo resultado', async () => {
    const d = await createTestDatabase({ migrate: false });
    try {
      const { error } = await migrator(d.owner as unknown as Kysely<unknown>).migrateTo('0003_approval');
      if (error) throw error;
      const db = d.owner;
      const soloV2 = await campaniaCon(db, [null, 'APPROVED']);
      const v1v2v3 = await campaniaCon(db, ['APPROVED', 'APPROVED', null]);
      const sinAprob = await campaniaCon(db, [null, 'REJECTED']);
      await db.updateTable('campaigns').set({ latest_approved_version_id: soloV2.vs[1]!.id }).where('id', '=', soloV2.campaignId).execute();
      await db.updateTable('campaigns').set({ latest_approved_version_id: v1v2v3.vs[1]!.id }).where('id', '=', v1v2v3.campaignId).execute();
      const contar = async () => {
        const r = await sql<{ v: string; a: string; c: string }>`SELECT (SELECT count(*) FROM show_versions)::text AS v, (SELECT count(*) FROM approvals)::text AS a, (SELECT count(*) FROM campaigns WHERE latest_approved_version_id IS NOT NULL)::text AS c`.execute(db);
        return r.rows[0];
      };
      const antes = await contar();
      const vigentes = async () => (await sql<{ id: string; a: string | null }>`SELECT id, active_version_id AS a FROM campaigns`.execute(db)).rows;

      expect(await migrateUp(db as never)).toEqual(['0004_active_version:Success']);
      const v1 = await vigentes();
      expect(v1).toHaveLength(3);
      expect(v1.every((r) => r.a === null)).toBe(true);
      expect(v1.map((r) => r.id).sort()).toEqual([soloV2.campaignId, v1v2v3.campaignId, sinAprob.campaignId].sort());
      expect(await contar()).toEqual(antes);

      // un pedido y una vigente reales antes del down: el down los descarta sin tocar versiones ni aprobaciones
      await sql`UPDATE campaigns SET active_version_id = ${v1v2v3.vs[0]!.id}::uuid WHERE id = ${v1v2v3.campaignId}::uuid`.execute(db);
      await pedir(db, v1v2v3, v1v2v3.vs[1]!, v1v2v3.vs[0]!.id);
      expect(await migrateDownOne(db as never)).toEqual(['0004_active_version:Success']);
      expect(await contar()).toEqual(antes);
      const app = await sql<{ ok: boolean }>`SELECT has_table_privilege('trust_app', 'campaigns', 'UPDATE') AS ok`.execute(db);
      expect(app.rows[0]?.ok).toBe(true); // vuelve el UPDATE de tabla de 0001

      expect(await migrateUp(db as never)).toEqual(['0004_active_version:Success']);
      expect((await vigentes()).every((r) => r.a === null)).toBe(true);
      expect(await contar()).toEqual(antes);
      const n = await sql<{ n: string }>`SELECT count(*)::text AS n FROM active_version_changes`.execute(db);
      expect(n.rows[0]?.n).toBe('0');
    } finally {
      await d.close();
    }
  });
});
