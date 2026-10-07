import { connect } from '@trust/platform-db';
import { readPassword, runUserCreate } from '../src/cli/user-create';

if (!process.env.DATABASE_URL) throw new Error('falta DATABASE_URL');
const db = connect(process.env.DATABASE_URL);
try {
  const pw = await readPassword(process.env, process.stdin);
  const u = await runUserCreate(db, process.argv.slice(2).filter((a) => a !== '--'), pw);
  console.log(JSON.stringify({ created: u }));
} finally {
  await db.destroy();
}
