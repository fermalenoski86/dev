/**
 * Smoke real con curl (M3A.1 Fase B §41: "un curl para subir un archivo").
 * Base PostgreSQL descartable + storage en tmp + createServer() desde el
 * entorno + curl de verdad contra el puerto. Imprime los comandos y las
 * respuestas. Uso: pnpm --filter @trust/platform-api smoke
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createTestDatabase, seedUser } from '@trust/platform-db/testing';
import { mediaFixtures } from '@trust/platform-media/fixtures';
import { createServer } from '../src/server';

const run = promisify(execFile);
const fx = mediaFixtures();
const t = await createTestDatabase();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-smoke-'));
const app = await createServer({
  ...process.env, NODE_ENV: 'development', TRUST_DEV_ACTOR_PROVIDER: 'enabled', DATABASE_URL: t.appUrl,
  STORAGE_DRIVER: 'local', LOCAL_STORAGE_ROOT: path.join(root, 'store'), MEDIA_SCRATCH_DIR: path.join(root, 'scratch'), LOG_LEVEL: 'warn',
});
try {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const actor = (await seedUser(t.app, 'smoke@trust.test')).id;
  const curl = async (titulo: string, args: string[]) => {
    const shown = args.map((a) => a.replace(actor, '<USER_UUID>')).join(' ');
    console.log(`\n### ${titulo}\n$ curl ${shown.replaceAll(base, '$API').replaceAll(path.dirname(fx('valid_horizontal_30.mp4')), '<fixtures>')}`);
    const { stdout } = await run('curl', ['-sS', '-w', '\nHTTP %{http_code}\n', ...args]);
    console.log(stdout.replaceAll(actor, '<USER_UUID>'));
  };
  await curl('health', [`${base}/health`]);
  await curl('ready', [`${base}/ready`]);
  await curl('upload READY', ['-H', `X-Dev-Actor: ${actor}`, '-H', 'Idempotency-Key: smoke-ready-0001', '-F', 'surfaceType=horizontal', '-F', `file=@${fx('valid_horizontal_30.mp4')};type=video/mp4`, `${base}/api/v1/assets`]);
  await curl('retry con la misma key (replay)', ['-i', '-H', `X-Dev-Actor: ${actor}`, '-H', 'Idempotency-Key: smoke-ready-0001', '-F', 'surfaceType=horizontal', '-F', `file=@${fx('valid_horizontal_30.mp4')};type=video/mp4`, `${base}/api/v1/assets`]);
  await curl('upload REJECTED (29.97 fps)', ['-H', `X-Dev-Actor: ${actor}`, '-H', 'Idempotency-Key: smoke-reject-0001', '-F', 'surfaceType=horizontal', '-F', `file=@${fx('bad_fps_2997.mp4')};type=video/mp4`, `${base}/api/v1/assets`]);
  await curl('sin actor', [`${base}/api/v1/assets`]);
} finally {
  await app.close();
  await t.close();
  await fs.rm(root, { recursive: true, force: true });
}
