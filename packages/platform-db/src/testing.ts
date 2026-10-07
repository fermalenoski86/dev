import { randomBytes } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { migrateUp } from './migrator';
import type { Database } from './schema';

/**
 * Arnés de pruebas con PostgreSQL REAL. Nada de mocks: cada archivo de test
 * crea una base descartable, la migra como trust_owner y opera como trust_app,
 * con los mismos permisos que tendrá producción.
 */
const ADMIN_URL = process.env.TRUST_PG_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5433/postgres';
const OWNER_PW = process.env.TRUST_PG_OWNER_PASSWORD ?? 'trust_owner_dev';
const APP_PW = process.env.TRUST_PG_APP_PASSWORD ?? 'trust_app_dev';

const urlPara = (user: string, pw: string, db: string) => {
  const u = new URL(ADMIN_URL);
  u.username = user;
  u.password = pw;
  u.pathname = `/${db}`;
  return u.toString();
};
const pool = (url: string) => {
  const p = new pg.Pool({ connectionString: url, max: 6 });
  // close() hace DROP DATABASE … WITH (FORCE): si un cliente inactivo del pool
  // todavía está cerrándose, el servidor lo termina con 57P01. Eso es el
  // teardown, no un fallo de test; cualquier otro error sigue siendo fatal.
  p.on('error', (e: Error & { code?: string }) => {
    if (e.code !== '57P01') throw e;
  });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: p }) });
};

export interface TestDatabase {
  name: string;
  owner: Kysely<Database>;
  app: Kysely<Database>;
  appUrl: string;
  close(): Promise<void>;
}

export async function createTestDatabase(opts: { migrate?: boolean } = {}): Promise<TestDatabase> {
  const name = `trust_t_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trust_owner') THEN CREATE ROLE trust_owner LOGIN PASSWORD '${OWNER_PW}'; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trust_app') THEN CREATE ROLE trust_app LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
    END $$;`);
    await admin.query(`CREATE DATABASE ${name} OWNER trust_owner`);
    await admin.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC; GRANT CONNECT ON DATABASE ${name} TO trust_app`);
  } finally {
    await admin.end();
  }
  const owner = pool(urlPara('trust_owner', OWNER_PW, name));
  // Por defecto el esquema public es del superusuario: pasarlo al owner y
  // sacarle el CREATE a todos los demás (trust_app no hace DDL).
  const adminDb = new pg.Client({ connectionString: urlPara('postgres', new URL(ADMIN_URL).password, name) });
  await adminDb.connect();
  await adminDb.query('ALTER SCHEMA public OWNER TO trust_owner; REVOKE CREATE ON SCHEMA public FROM PUBLIC;');
  await adminDb.end();
  if (opts.migrate !== false) await migrateUp(owner as unknown as Kysely<unknown>);
  const appUrl = urlPara('trust_app', APP_PW, name);
  const app = pool(appUrl);
  return {
    name,
    owner,
    app,
    appUrl,
    async close() {
      await app.destroy();
      await owner.destroy();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
export * from './fixtures';
