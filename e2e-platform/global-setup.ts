import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { API_PORT, CONTROL_PORT, HOSTS, ORIGIN, TLS_PORT, WEB_PORT, type StackState } from './env';
// @ts-expect-error módulo .mjs sin tipos (proxy de test, sin dependencias)
import { startTlsProxy } from './tls-proxy.mjs';

/**
 * E3c · levanta todo lo que el E2E necesita, de verdad:
 *  - certificado autofirmado con openssl (no versionado) para los hosts de test;
 *  - backend real (`apps/platform-api/scripts/e2e-stack.ts`): PostgreSQL,
 *    usuarios por el CLI de C1 (uno por rol y por worker), API en producción;
 *  - `platform-web` y `apps/control` con `next start` (construidos antes con
 *    sus NEXT_PUBLIC_* apuntando a los hosts HTTPS, BL-30);
 *  - un terminador TLS en :8443 que enruta por Host;
 *  - contrato propio por worker, creado por la API como ADMIN.
 * Devuelve el teardown.
 */
const ROOT = path.resolve(__dirname, '..');
const LOGS = path.join(ROOT, 'test-results', 'e2e-platform-logs');

function lanzar(nombre: string, cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  mkdirSync(LOGS, { recursive: true });
  const log = createWriteStream(path.join(LOGS, `${nombre}.log`));
  const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout?.pipe(log);
  p.stderr?.pipe(log);
  return p;
}

function esperarLinea(p: ChildProcess, marca: string, ms: number): Promise<void> {
  return new Promise((ok, mal) => {
    const t = setTimeout(() => mal(new Error(`timeout esperando ${marca}`)), ms);
    p.stdout?.on('data', (b: Buffer) => {
      if (b.toString().includes(marca)) {
        clearTimeout(t);
        ok();
      }
    });
    p.once('exit', (code) => {
      clearTimeout(t);
      mal(new Error(`el proceso terminó (${code}) antes de ${marca}; ver ${LOGS}`));
    });
  });
}

async function esperarHttp(url: string, ms: number): Promise<void> {
  const fin = Date.now() + ms;
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* todavía no */
    }
    if (Date.now() > fin) throw new Error(`timeout esperando ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Sesión server-side contra la API (sin Origin: solo preparación de datos). */
async function api(email: string, password: string) {
  const base = `http://127.0.0.1:${API_PORT}`;
  const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const csrf = ((await r.json()) as { csrfToken: string }).csrfToken;
  const post = async (url: string, body: unknown) => {
    const x = await fetch(`${base}${url}`, { method: 'POST', headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (x.status !== 201) throw new Error(`${url}: ${x.status} ${await x.text()}`);
    return (await x.json()) as { id: string };
  };
  return { post, logout: () => fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { cookie, 'x-csrf-token': csrf } }) };
}

export default async function globalSetup(config: FullConfig) {
  const workers = config.workers;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'trust-e2e-platform-'));
  const key = path.join(dir, 'tls.key');
  const cert = path.join(dir, 'tls.crt');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=trust.test',
    '-addext', `subjectAltName=${Object.values(HOSTS).map((h) => `DNS:${h}`).join(',')}`,
  ], { stdio: 'pipe' });

  const procesos: ChildProcess[] = [];
  const env = { ...process.env, NODE_ENV: 'production' };
  const apiDir = path.join(ROOT, 'apps', 'platform-api');
  const stack = lanzar('stack', path.join(apiDir, 'node_modules', '.bin', 'tsx'), ['scripts/e2e-stack.ts'], apiDir, {
    ...env, E2E_STATE_DIR: dir, E2E_WORKERS: String(workers), E2E_API_PORT: String(API_PORT),
    E2E_CORS_ORIGINS: [ORIGIN.web, ORIGIN.control].join(','),
  });
  procesos.push(stack);
  await esperarLinea(stack, 'E2E_STACK_READY', 180_000);

  const next = (app: string, port: number) =>
    lanzar(app, path.join(ROOT, 'apps', app, 'node_modules', '.bin', 'next'), ['start', '-p', String(port), '-H', '127.0.0.1'], path.join(ROOT, 'apps', app), env);
  procesos.push(next('platform-web', WEB_PORT), next('control', CONTROL_PORT));
  await esperarHttp(`http://127.0.0.1:${WEB_PORT}/login`, 60_000);
  await esperarHttp(`http://127.0.0.1:${CONTROL_PORT}/`, 60_000);

  const proxy: Server = await startTlsProxy({
    cert: readFileSync(cert), key: readFileSync(key), port: TLS_PORT,
    routes: { [HOSTS.web]: WEB_PORT, [HOSTS.control]: CONTROL_PORT, [HOSTS.api]: API_PORT, [HOSTS.evil]: WEB_PORT },
  });

  // Contrato propio por worker (BL-25), creado por la API como ADMIN de ese worker.
  const state = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')) as StackState;
  state.contracts = {};
  for (let w = 0; w < workers; w++) {
    const admin = state.users.find((u) => u.worker === w && u.key === 'admin');
    if (!admin) throw new Error(`sin admin para el worker ${w}`);
    const s = await api(admin.email, admin.password);
    const adv = await s.post('/api/v1/advertisers', { legalName: `Anunciante E2E w${w}`, taxId: `30-${Date.now()}${w}-1` });
    const ct = await s.post('/api/v1/contracts', {
      advertiserId: adv.id, name: `Takeover E2E w${w}`, startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z',
      allowedSurfaces: ['screen_a', 'screen_b', 'horizontal'],
    });
    state.contracts[w] = ct.id;
    await s.logout();
  }
  state.tlsCertPath = cert;
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state), { mode: 0o600 });
  process.env.E2E_STATE_DIR = dir;

  return async () => {
    await new Promise<void>((ok) => proxy.close(() => ok()));
    for (const p of procesos.reverse()) p.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 2_000));
    rmSync(dir, { recursive: true, force: true });
  };
}
