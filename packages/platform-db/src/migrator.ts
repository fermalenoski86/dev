import type { Kysely } from 'kysely';
import { type Migration, Migrator } from 'kysely/migration';
import * as m0001 from './migrations/0001_initial';

/**
 * Migraciones versionadas. Lista explícita (no se descubren del disco): el
 * orden y el contenido quedan fijados en el código revisado.
 */
interface MigrationModule extends Migration {
  reversible: boolean;
}
export const MIGRATIONS: Readonly<Record<string, MigrationModule>> = {
  '0001_initial': m0001,
};

export function migrator(db: Kysely<unknown>): Migrator {
  return new Migrator({ db, provider: { getMigrations: async () => ({ ...MIGRATIONS }) } });
}

export async function migrateUp(db: Kysely<unknown>): Promise<string[]> {
  const { error, results } = await migrator(db).migrateToLatest();
  if (error) throw error;
  return (results ?? []).map((r) => `${r.migrationName}:${r.status}`);
}

/**
 * Baja UNA migración, solo si se declaró reversible. En producción no se baja:
 * forward migration + backup. Esto es para el smoke test de CI.
 */
export async function migrateDownOne(db: Kysely<unknown>): Promise<string[]> {
  const ejecutadas = (await migrator(db).getMigrations()).filter((m) => m.executedAt);
  const ultima = ejecutadas.at(-1);
  if (!ultima) return [];
  if (!MIGRATIONS[ultima.name]?.reversible) throw new Error(`la migración ${ultima.name} no es reversible`);
  const { error, results } = await migrator(db).migrateDown();
  if (error) throw error;
  return (results ?? []).map((r) => `${r.migrationName}:${r.status}`);
}
