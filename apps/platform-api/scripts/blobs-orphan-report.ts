import { connect } from '@trust/platform-db';
import { storageFromEnv } from '@trust/platform-storage';
import { runOrphanReport } from '../src/cli/blobs-orphan-report';

if (!process.env.DATABASE_URL) throw new Error('falta DATABASE_URL');
const storage = await storageFromEnv(process.env);
const db = connect(process.env.DATABASE_URL);
try {
  const r = await runOrphanReport(db, storage, process.argv.slice(2).filter((a) => a !== '--'), process.env);
  console.log(JSON.stringify(r, null, 2));
} finally {
  await db.destroy();
}
