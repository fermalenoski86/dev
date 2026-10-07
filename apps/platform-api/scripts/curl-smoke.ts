/**
 * Smoke real con curl (M3A.1 Fase B §41: "un curl para subir un archivo").
 * Base PostgreSQL descartable + storage en tmp + createServer() desde el
 * entorno + curl de verdad contra el puerto. Imprime los comandos y las
 * respuestas. Desde C1 se loguea de verdad (cookie jar + X-CSRF-Token).
 * Uso: pnpm --filter @trust/platform-api smoke
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createUser } from '@trust/platform-auth';
import { createTestDatabase } from '@trust/platform-db/testing';
import { mediaFixtures } from '@trust/platform-media/fixtures';
import { createServer } from '../src/server';

const run = promisify(execFile);
const fx = mediaFixtures();
const t = await createTestDatabase();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-smoke-'));
const app = await createServer({
  ...process.env, NODE_ENV: 'development', TRUST_COOKIE_SECURE: 'false', DATABASE_URL: t.appUrl,
  STORAGE_DRIVER: 'local', LOCAL_STORAGE_ROOT: path.join(root, 'store'), MEDIA_SCRATCH_DIR: path.join(root, 'scratch'), LOG_LEVEL: 'warn',
});
try {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const PW = 'smoke password larga 2026';
  const actor = (await createUser(t.app, { name: 'Smoke', email: 'smoke@trust.test', password: PW, organization: 'Affinitas', roles: [{ role: 'OPERATOR' }] })).id;
  const jar = path.join(root, 'cookies.txt');
  let csrf = '<sin sesión>';
  const tapar = (x: string) => x.replaceAll(actor, '<USER_UUID>').replaceAll(csrf, '<CSRF>').replaceAll(PW, '<PASSWORD>');
  const curl = async (titulo: string, args: string[]) => {
    const shown = tapar(args.join(' '));
    console.log(`\n### ${titulo}\n$ curl ${shown.replaceAll(base, '$API').replaceAll(path.dirname(fx('valid_horizontal_30.mp4')), '<fixtures>').replaceAll(jar, '<jar>')}`);
    const { stdout } = await run('curl', ['-sS', '-w', '\nHTTP %{http_code}\n', ...args]);
    console.log(tapar(stdout).replace(/trust_session=[A-Za-z0-9_-]{43}/g, 'trust_session=<TOKEN>'));
    return stdout;
  };
  await curl('health', [`${base}/health`]);
  await curl('ready', [`${base}/ready`]);
  await curl('sin sesión → 401', [`${base}/api/v1/assets`]);
  await curl('login con password mala → 401', ['-H', 'content-type: application/json', '--data', JSON.stringify({ email: 'smoke@trust.test', password: 'no es la password' }), `${base}/api/v1/auth/login`]);
  const login = await run('curl', ['-sS', '-c', jar, '-H', 'content-type: application/json', '--data', JSON.stringify({ email: 'smoke@trust.test', password: PW }), `${base}/api/v1/auth/login`]);
  csrf = (JSON.parse(login.stdout) as { csrfToken: string }).csrfToken;
  console.log(`\n### login (cookie jar)\n$ curl -c <jar> -H 'content-type: application/json' --data '{"email":"smoke@trust.test","password":"<PASSWORD>"}' $API/api/v1/auth/login\n${tapar(login.stdout)}`);
  await curl('me', ['-b', jar, `${base}/api/v1/auth/me`]);
  await curl('upload sin X-CSRF-Token → 403', ['-b', jar, '-H', 'Idempotency-Key: smoke-nocsrf-0001', '-F', 'surfaceType=horizontal', '-F', `file=@${fx('valid_horizontal_30.mp4')};type=video/mp4`, `${base}/api/v1/assets`]);
  const sess = ['-b', jar, '-H', `X-CSRF-Token: ${csrf}`];
  await curl('upload READY', [...sess, '-H', 'Idempotency-Key: smoke-ready-0001', '-F', 'surfaceType=horizontal', '-F', `file=@${fx('valid_horizontal_30.mp4')};type=video/mp4`, `${base}/api/v1/assets`]);
  await curl('retry con la misma key (replay)', ['-i', ...sess, '-H', 'Idempotency-Key: smoke-ready-0001', '-F', 'surfaceType=horizontal', '-F', `file=@${fx('valid_horizontal_30.mp4')};type=video/mp4`, `${base}/api/v1/assets`]);
  await curl('upload REJECTED (29.97 fps)', [...sess, '-H', 'Idempotency-Key: smoke-reject-0001', '-F', 'surfaceType=horizontal', '-F', `file=@${fx('bad_fps_2997.mp4')};type=video/mp4`, `${base}/api/v1/assets`]);
  await curl('logout', ['-i', ...sess, '-c', jar, '-X', 'POST', `${base}/api/v1/auth/logout`]);
  await curl('me después del logout → 401', ['-b', jar, `${base}/api/v1/auth/me`]);
} finally {
  await app.close();
  await t.close();
  await fs.rm(root, { recursive: true, force: true });
}
