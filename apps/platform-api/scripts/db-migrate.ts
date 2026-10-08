import { connect, migrateUp } from '@trust/platform-db';

/**
 * Migraciones hacia adelante como `trust_owner` (E1 · §35/§33). Nunca con el
 * usuario de runtime: `trust_app` no tiene DDL. En producción se migra solo
 * después de un backup verificado (docs/ops/BACKUPS.md).
 *
 *   TRUST_MIGRATION_DATABASE_URL=postgres://trust_owner:…@host:5432/trust pnpm db:migrate
 */
const url = process.env.TRUST_MIGRATION_DATABASE_URL;
if (!url) throw new Error('falta TRUST_MIGRATION_DATABASE_URL (usuario trust_owner)');
const db = connect(url, 1);
try {
  const r = await migrateUp(db as never);
  console.log(JSON.stringify({ migrated: r }));
} finally {
  await db.destroy();
}
