import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { migrateUp } from './migrator';
import type { Database } from './schema';

/**
 * Corre SOLO desde scripts/bootstrap-smoke.sh, contra un cluster nuevo donde
 * los roles los creó bootstrap.sql vía psql. Sin esas variables, se omite: el
 * bootstrap no se da por validado por ningún otro camino.
 */
const OWNER = process.env.TRUST_SMOKE_OWNER_URL;
const APP = process.env.TRUST_SMOKE_APP_URL;
const conectar = (url: string) => new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 2 }) }) });
const falla = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { const x = e as { message: string; code?: string }; return `${x.code ?? ''} ${x.message}`; }
  return 'NO FALLÓ';
};

describe.skipIf(!OWNER || !APP)('CRITERIO: bootstrap.sql real (psql) → migraciones → runtime', () => {
  const owner = conectar(OWNER ?? 'postgres://x');
  const app = conectar(APP ?? 'postgres://x');
  afterAll(async () => { await app.destroy(); await owner.destroy(); });

  it('las contraseñas con comillas funcionan: ambos roles se autentican', async () => {
    expect((await sql<{ u: string }>`SELECT current_user AS u`.execute(owner)).rows[0]?.u).toBe('trust_owner');
    expect((await sql<{ u: string }>`SELECT current_user AS u`.execute(app)).rows[0]?.u).toBe('trust_app');
  });

  it('migraciones up como trust_owner', async () => {
    expect(await migrateUp(owner as never)).toEqual(['0001_initial:Success', '0002_asset_pipeline:Success', '0003_approval:Success']);
  });

  it('trust_app: sin DDL', async () => {
    expect(await falla(sql`CREATE TABLE intruso (x int)`.execute(app))).toMatch(/42501|permission denied/);
    expect(await falla(sql`ALTER TABLE users ADD COLUMN x int`.execute(app))).toMatch(/42501|must be owner/);
  });

  it('trust_app: sin UPDATE/DELETE de inmutables ni de la auditoría', async () => {
    // una columna real de cada tabla: el error tiene que ser de PERMISO, no de esquema
    const col: Record<string, string> = { show_versions: 'id', show_version_assets: 'logical_ref', approvals: 'id', approval_evidence: 'id', stored_objects: 'id', audit_events: 'id' };
    for (const [tabla, c] of Object.entries(col)) {
      expect(await falla(sql`UPDATE ${sql.table(tabla)} SET ${sql.ref(c)} = ${sql.ref(c)}`.execute(app)), tabla).toMatch(/42501|permission denied/);
      expect(await falla(sql`DELETE FROM ${sql.table(tabla)}`.execute(app)), tabla).toMatch(/42501|permission denied/);
    }
    expect(await falla(sql`INSERT INTO show_versions (campaign_id) VALUES (gen_random_uuid())`.execute(app))).toMatch(/42501|permission denied/);
  });

  it('trust_app: sí puede usar la función atómica de versiones', async () => {
    const r = await sql<{ ok: boolean }>`SELECT has_function_privilege('trust_app', 'trust_create_show_version(uuid, uuid, integer, jsonb, text, text, text, integer, integer, text, uuid, jsonb)', 'EXECUTE') AS ok`.execute(owner);
    expect(r.rows[0]?.ok).toBe(true);
  });

  it('nadie más que trust_owner crea objetos en el esquema', async () => {
    const r = await sql<{ owner: string; publico: boolean }>`
      SELECT pg_get_userbyid(nspowner) AS owner, has_schema_privilege('public', 'public', 'CREATE') AS publico
        FROM pg_namespace WHERE nspname = 'public'`.execute(owner);
    expect(r.rows[0]).toEqual({ owner: 'trust_owner', publico: false });
  });
});
