import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema';

/** Conexión Kysely sobre `pg`. El dominio nunca ve el driver. */
export function connect(connectionString: string, max = 5): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }),
  });
}
