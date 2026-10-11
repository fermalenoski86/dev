import { connect } from '@trust/platform-db';
import { runStaleReport } from '../src/cli/assets-stale-report';

if (!process.env.DATABASE_URL) throw new Error('falta DATABASE_URL');
const db = connect(process.env.DATABASE_URL);
try {
  const r = await runStaleReport(db, process.argv.slice(2).filter((a) => a !== '--'), process.env);
  console.log(JSON.stringify(r, null, 2));
} finally {
  await db.destroy();
}
