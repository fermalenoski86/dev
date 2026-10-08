import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LoginRateLimiter } from '@trust/platform-auth';
import type { Database } from '@trust/platform-db';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { LocalDiskStorage } from '@trust/platform-storage';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { DevelopmentActorProvider, SESSION_COOKIE_DEV } from '../src/actor';
import { buildApp } from '../src/app';
import { deliveryText } from '../src/delivery';
import { openApiText } from '../src/openapi';

/**
 * E1 · BL-11/§47: regenera docs/platform/openapi.json y DELIVERY.md.
 * La route list sale del registro de Fastify: se arma la app real (con todas
 * las rutas, auth incluida) y se escucha `onRoute`. No hace falta una base: el
 * pool de pg es perezoso y registrar rutas no consulta nada.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'trust-docs-contract-'));
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: 'postgres://nadie@127.0.0.1:1/nada' }) }) });
const registradas: Array<{ method: string; url: string }> = [];
try {
  const app = await buildApp({
    db, storage: await LocalDiskStorage.open(path.join(tmp, 'store')), media: { ...mediaRuntimeFromEnv({}), scratchDir: path.join(tmp, 'scratch') },
    maxUploadBytes: 1, mediaBinariesOk: () => true, log: false, actors: new DevelopmentActorProvider(db),
    auth: { limiter: new LoginRateLimiter(), sessionTtlMs: 60_000, cookieName: SESSION_COOKIE_DEV, secureCookie: false },
    onRoute: (r) => { if (r.method !== 'HEAD') registradas.push(r); },
  });
  await app.ready();
  await app.close();
  writeFileSync(path.join(root, 'docs/platform/openapi.json'), openApiText());
  writeFileSync(path.join(root, 'docs/platform/DELIVERY.md'), deliveryText(root, registradas));
  console.log(`docs/platform/openapi.json y docs/platform/DELIVERY.md regenerados (${registradas.length} rutas registradas)`);
} finally {
  await db.destroy();
  rmSync(tmp, { recursive: true, force: true });
}
