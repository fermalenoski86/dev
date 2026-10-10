/**
 * E3c · backend REAL para `e2e-platform` (Playwright). Solo tests: no se usa
 * en ningún despliegue.
 *
 *   E2E_STATE_DIR=/tmp/x E2E_WORKERS=2 E2E_API_PORT=4000 \
 *   E2E_CORS_ORIGINS=https://web.trust.test:8443,https://control.trust.test:8443 \
 *   tsx scripts/e2e-stack.ts
 *
 * 1. Base descartable migrada (trust_owner) y operada como trust_app.
 * 2. Usuarios con el **CLI de C1** (`scripts/user-create.ts`, BL-25): uno por
 *    rol y por worker. Las contraseñas se generan acá, viajan por
 *    `TRUST_NEW_USER_PASSWORD` y quedan solo en `E2E_STATE_DIR` (0700, fuera
 *    del repo).
 * 3. `platform-api` con `createServer` en modo producción: cookie
 *    `__Host-trust_session` + Secure y CORS por allowlist exacta (ADR-063).
 * 4. Escribe `state.json` (usuarios, preset del Builder, fixtures reales) y
 *    avisa `E2E_STACK_READY` por stdout. Con SIGTERM cierra todo y borra la base.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createTestDatabase } from '@trust/platform-db/testing';
import { mediaFixtures } from '@trust/platform-media/fixtures';
import { PRESET_TAKEOVER_15S } from '@trust/show-authoring';
import { createServer } from '../src/server';

const run = promisify(execFile);
const aqui = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(aqui, '..');

const stateDir = process.env.E2E_STATE_DIR;
if (!stateDir) throw new Error('falta E2E_STATE_DIR');
const workers = Number(process.env.E2E_WORKERS ?? '1');
if (!Number.isInteger(workers) || workers < 1 || workers > 8) throw new Error('E2E_WORKERS tiene que ser 1..8');
const port = Number(process.env.E2E_API_PORT ?? '4000');
const cors = process.env.E2E_CORS_ORIGINS ?? '';

mkdirSync(stateDir, { recursive: true, mode: 0o700 });
chmodSync(stateDir, 0o700);

const t = await createTestDatabase();
const ROLES = [
  ['op', 'OPERATOR'],
  ['ap', 'INTERNAL_APPROVER'],
  ['admin', 'ADMIN'],
] as const;
const usuarios: Array<{ worker: number; key: string; role: string; email: string; password: string; name: string }> = [];
const tsx = path.join(apiDir, 'node_modules', '.bin', 'tsx');
for (let w = 0; w < workers; w++) {
  for (const [key, role] of ROLES) {
    const email = `${key}-w${w}@e2e.trust.test`;
    const name = `${key.toUpperCase()} w${w}`;
    const password = randomBytes(18).toString('base64url');
    // El CLI real de C1: la contraseña nunca va por argumento.
    await run(tsx, [path.join(apiDir, 'scripts', 'user-create.ts'), '--email', email, '--name', name, '--organization', 'E2E', '--role', role], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: t.appUrl, TRUST_NEW_USER_PASSWORD: password },
    });
    usuarios.push({ worker: w, key, role, email, password, name });
  }
}

const storageRoot = path.join(stateDir, 'storage');
const scratch = path.join(stateDir, 'scratch');
mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
mkdirSync(scratch, { recursive: true, mode: 0o700 });
const app = await createServer({
  ...process.env,
  NODE_ENV: 'production',
  TRUST_COOKIE_SECURE: 'true',
  TRUST_CORS_ORIGINS: cors,
  DATABASE_URL: t.appUrl,
  STORAGE_DRIVER: 'local',
  LOCAL_STORAGE_ROOT: storageRoot,
  MEDIA_SCRATCH_DIR: scratch,
  MAX_UPLOAD_BYTES: String(50 * 1024 * 1024),
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
});
await app.listen({ host: '127.0.0.1', port });

const fx = mediaFixtures();
writeFileSync(
  path.join(stateDir, 'state.json'),
  JSON.stringify({
    apiPort: port,
    users: usuarios,
    preset: PRESET_TAKEOVER_15S(),
    fixtures: { master: fx('valid_towers_ab_25.mp4'), horizontal: fx('valid_horizontal_30.mp4') },
  }),
  { mode: 0o600 },
);
console.log('E2E_STACK_READY');

const cerrar = async () => {
  await app.close();
  await t.close();
  process.exit(0);
};
process.on('SIGTERM', () => void cerrar());
process.on('SIGINT', () => void cerrar());
