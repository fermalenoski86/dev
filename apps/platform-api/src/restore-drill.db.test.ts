import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { appendAuditEvent, verifyChain } from '@trust/platform-audit';
import { createUser } from '@trust/platform-auth';
import { connect, migrateUp } from '@trust/platform-db';
import { type TestDatabase, createTestDatabase, seedAsset, seedCampaignWithDraft, seedContract, seedVersion } from '@trust/platform-db/testing';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E1 · §33 — el procedimiento de restore de docs/ops/BACKUPS.md, PROBADO:
 * los mismos comandos (`pg_dump -Fc` + `pg_restore --exit-on-error
 * --single-transaction`) contra el PostgreSQL local, sobre una base con datos
 * reales de cada tabla de negocio y cadena de auditoría. La base restaurada
 * tiene que: tener las mismas filas en cada tabla, pasar `verifyChain`, quedar
 * al día en migraciones (migrateUp = []), conservar los permisos de trust_app
 * y seguir rechazando mutaciones sobre lo inmutable.
 *
 * Procesos externos con execFile (sin shell); la contraseña va por PGPASSWORD.
 */
const run = promisify(execFile);
const ADMIN = new URL(process.env.TRUST_PG_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5433/postgres');
const pgEnv = { ...process.env, PGPASSWORD: decodeURIComponent(ADMIN.password) };
const conn = (db: string) => ['-h', ADMIN.hostname, '-p', ADMIN.port || '5432', '-U', decodeURIComponent(ADMIN.username), db];

let t: TestDatabase;
let dir: string;
const destino = `trust_restore_${Math.random().toString(16).slice(2, 10)}`;

beforeAll(async () => {
  t = await createTestDatabase();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-restore-'));
  // datos por los caminos reales: usuarios (con audit), contrato, campaña+draft, asset READY, versión
  const op = await createUser(t.app, { name: 'Op', email: 'op-restore@affinitas.com', password: 'restore password 123!', organization: 'Affinitas', roles: [{ role: 'OPERATOR' }] });
  await createUser(t.app, { name: 'Apr', email: 'apr-restore@affinitas.com', password: 'restore password 456!', organization: 'Affinitas', roles: [{ role: 'INTERNAL_APPROVER' }] });
  const c = await seedContract(t.app);
  const camp = await seedCampaignWithDraft(t.app, c.id, op.id);
  const a = await seedAsset(t.app, op.id, `restore-${Math.random()}`);
  await seedVersion(t.app, { campaignId: camp.campaignId, draftId: camp.draftId, submittedBy: op.id, assets: [{ logicalRef: 'master', assetId: a.assetId, sha256: a.sha256 }] });
  await t.app.transaction().execute((trx) => appendAuditEvent(trx, { actorUserId: op.id, action: 'CAMPAIGN_CREATED', entityType: 'campaign', entityId: camp.campaignId, metadata: { drill: true } }));
});
afterAll(async () => {
  await t?.close();
  await run('psql', [...conn('postgres'), '-tAc', `DROP DATABASE IF EXISTS ${destino} WITH (FORCE)`], { env: pgEnv }).catch(() => undefined);
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

async function conteos(db: ReturnType<typeof connect>): Promise<Record<string, number>> {
  const tablas = await sql<{ table_name: string }>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`.execute(db);
  const out: Record<string, number> = {};
  for (const { table_name } of tablas.rows) {
    const r = await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(table_name)}`.execute(db);
    out[table_name] = Number(r.rows[0]?.n);
  }
  return out;
}

describe('E1 · §33: restore probado contra el PostgreSQL local', () => {
  it('pg_dump -Fc → pg_restore en una base nueva: mismas filas, cadena OK, migraciones al día, permisos e inmutabilidad intactos', async () => {
    const origen = await conteos(t.owner as never);
    const cadenaOrigen = await verifyChain(t.app);
    expect(cadenaOrigen.ok).toBe(true);
    expect(cadenaOrigen.length).toBeGreaterThanOrEqual(3);
    expect(origen.audit_events).toBeGreaterThanOrEqual(3);
    for (const tabla of ['users', 'advertisers', 'contracts', 'campaigns', 'campaign_drafts', 'assets', 'stored_objects', 'show_versions', 'show_version_assets']) expect(origen[tabla], tabla).toBeGreaterThan(0);

    const archivo = path.join(dir, `${t.name}.dump`);
    const t0 = Date.now();
    await run('pg_dump', ['-Fc', '-f', archivo, ...conn(t.name)], { env: pgEnv });
    const tDump = Date.now() - t0;
    const bytes = (await fs.stat(archivo)).size;

    await run('psql', [...conn('postgres'), '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${destino} OWNER trust_owner`], { env: pgEnv });
    const t1 = Date.now();
    await run('pg_restore', ['--exit-on-error', '--single-transaction', '-d', destino, ...conn(destino).slice(0, -1), archivo], { env: pgEnv });
    const tRestore = Date.now() - t1;

    const restoredOwner = connect(t.appUrl.replace(/\/[^/]+$/, `/${destino}`).replace(/^postgres:\/\/trust_app:[^@]*@/, `postgres://trust_owner:${encodeURIComponent(process.env.TRUST_PG_OWNER_PASSWORD ?? 'trust_owner_dev')}@`), 1);
    const restoredApp = connect(t.appUrl.replace(/\/[^/]+$/, `/${destino}`), 1);
    try {
      expect(await conteos(restoredOwner)).toEqual(origen);
      const cadena = await verifyChain(restoredApp);
      expect(cadena).toEqual(cadenaOrigen);
      expect(await migrateUp(restoredOwner as never)).toEqual([]);
      // permisos de runtime conservados: trust_app lee, y lo inmutable sigue inmutable
      const n = await restoredApp.selectFrom('audit_events').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow();
      expect(n.n).toBe(origen.audit_events);
      await expect(sql`UPDATE audit_events SET action = action`.execute(restoredApp)).rejects.toThrow();
      await expect(sql`DELETE FROM stored_objects`.execute(restoredOwner)).rejects.toThrow(/IMMUTABLE_ROW/);
    } finally {
      await restoredOwner.destroy();
      await restoredApp.destroy();
    }
    process.stdout.write(`GATE restore-drill: dump ${bytes} bytes en ${tDump} ms · restore en ${tRestore} ms · ${Object.keys(origen).length} tablas · ${origen.audit_events} audit events · verifyChain ok\n`);
  });
});
