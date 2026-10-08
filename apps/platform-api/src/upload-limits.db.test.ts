import { promises as fs, readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { type TestDatabase, createTestDatabase, seedUser } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { mediaFixtures } from '@trust/platform-media/fixtures';
import { LocalDiskStorage } from '@trust/platform-storage';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevelopmentActorProvider } from './actor';
import { buildApp } from './app';
import { ErrorResponseSchema } from './contracts';
import { DEFAULT_UPLOAD_LIMITS, UploadLimiter, uploadLimitsFromEnv } from './upload-limiter';

/**
 * E1 · BL-10 — límite de concurrencia y de tasa de uploads POR ACTOR (§39,
 * OWASP API4:2023). Fastify real + PostgreSQL real + ffprobe real. El 429 se
 * decide antes de leer el cuerpo: sin temporal, sin Asset y sin
 * Idempotency-Key reservada.
 */
let t: TestDatabase;
let root: string;
let storage: LocalDiskStorage;
let fx: (n: string) => string;
let actor: string;
let otro: string;
const media = { ...mediaRuntimeFromEnv({ MEDIA_INSPECTION_CONCURRENCY: '4' }) };
const MAX = 50 * 1024 * 1024;
let n = 0;

beforeAll(async () => {
  fx = mediaFixtures();
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-e1-'));
  storage = await LocalDiskStorage.open(path.join(root, 'store'));
  media.scratchDir = path.join(root, 'scratch');
  actor = (await seedUser(t.app, `lim-${Date.now()}@trust.test`)).id;
  otro = (await seedUser(t.app, `lim2-${Date.now()}@trust.test`)).id;
  await t.app.insertInto('user_roles').values([{ user_id: actor, role: 'OPERATOR' }, { user_id: otro, role: 'OPERATOR' }]).execute();
});
afterAll(async () => {
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const nuevaApp = (uploadLimiter: UploadLimiter) =>
  buildApp({ db: t.app, storage, media, actors: new DevelopmentActorProvider(t.app), maxUploadBytes: MAX, mediaBinariesOk: () => true, log: false, uploadLimiter });

const temporales = async () => (await fs.readdir(path.join(root, 'store', 'tmp')).catch(() => [])).length;
const keys = async (k: string) => (await t.app.selectFrom('idempotency_keys').select('key').where('key', '=', k).execute()).length;
const assets = async (who: string) => (await t.app.selectFrom('assets').select('id').where('created_by', '=', who).execute()).length;

const BOUNDARY = '----trust-e1-boundary';
function cabeceraMultipart(nombre: string): Buffer {
  return Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="surfaceType"\r\n\r\nscreen_a\r\n` +
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${nombre}"\r\nContent-Type: video/mp4\r\n\r\n`,
  );
}
const cierre = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);

async function multipartCompleto(key: string, who: string, app: FastifyInstance) {
  const bytes = readFileSync(fx('valid_screen_a_25.mp4'));
  return app.inject({
    method: 'POST', url: '/api/v1/assets',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, 'idempotency-key': key, 'x-dev-actor': who },
    payload: Buffer.concat([cabeceraMultipart('screen_a.mp4'), bytes, cierre]),
  });
}

/** Upload por HTTP real que queda ABIERTO (cuerpo a medias) hasta que el test lo termina. */
function uploadAbierto(port: number, key: string, who: string) {
  const bytes = readFileSync(fx('valid_screen_a_25.mp4'));
  const mitad = Math.floor(bytes.length / 2);
  const req = http.request({
    host: '127.0.0.1', port, method: 'POST', path: '/api/v1/assets',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, 'idempotency-key': key, 'x-dev-actor': who, 'transfer-encoding': 'chunked' },
  });
  const respuesta = new Promise<{ status: number; body: string }>((ok, mal) => {
    req.on('response', (res) => {
      let body = '';
      res.on('data', (c) => { body += String(c); });
      res.on('end', () => ok({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', mal);
  });
  req.write(Buffer.concat([cabeceraMultipart('abierto.mp4'), bytes.subarray(0, mitad)]));
  return {
    terminar: () => { req.end(Buffer.concat([bytes.subarray(mitad), cierre])); return respuesta; },
  };
}

async function esperar(cond: () => boolean, ms = 10_000) {
  const hasta = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > hasta) throw new Error('esperar: la condición no se cumplió');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('E1 · BL-10: límite de uploads por actor', () => {
  it('N+1 uploads simultáneos del mismo actor → 429 con Retry-After, sin temporal, sin Asset y sin key; otro actor no se ve afectado', async () => {
    const limiter = new UploadLimiter({ maxConcurrent: 2, maxPerWindow: 100 });
    const app = await nuevaApp(limiter);
    await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const port = (app.server.address() as { port: number }).port;
      const k1 = `e1-limite-a-${n++}`;
      const k2 = `e1-limite-b-${n++}`;
      const a = uploadAbierto(port, k1, actor);
      const b = uploadAbierto(port, k2, actor);
      await esperar(() => limiter.stats(actor).active === 2);
      // los dos abiertos ya reservaron su temporal (si no, la foto de abajo sería una carrera)
      for (let i = 0; i < 1000 && (await temporales()) < 2; i++) await new Promise((r) => setTimeout(r, 10));
      const tempAntes = await temporales();
      expect(tempAntes).toBe(2);
      const assetsAntes = await assets(actor);

      const k3 = `e1-limite-c-${n++}`;
      const r = await multipartCompleto(k3, actor, app);
      expect(r.statusCode, r.body).toBe(429);
      expect(r.headers['retry-after']).toBe('1');
      expect(ErrorResponseSchema.parse(r.json())).toMatchObject({ code: 'RATE_LIMITED', details: { reason: 'CONCURRENCY', retryAfterSeconds: 1 } });
      expect(await temporales()).toBe(tempAntes);
      expect(await assets(actor)).toBe(assetsAntes);
      expect(await keys(k3)).toBe(0);

      // otro actor tiene su propio cupo
      const ro = await multipartCompleto(`e1-limite-o-${n++}`, otro, app);
      expect(ro.statusCode, ro.body).toBe(201);

      const [ra, rb] = await Promise.all([a.terminar(), b.terminar()]);
      expect([ra.status, rb.status]).toEqual([201, 201]);
      expect(limiter.stats(actor).active).toBe(0); // los cupos se devuelven

      // con cupo libre, el mismo k3 entra (no quedó reservado)
      const r3 = await multipartCompleto(k3, actor, app);
      expect(r3.statusCode, r3.body).toBe(201);
    } finally {
      app.server.closeAllConnections(); // si algo falló, que un upload a medias no cuelgue el close
      await app.close();
    }
  });

  it('tasa por ventana: el tercero dentro del minuto → 429 RATE con Retry-After real; al vencer la ventana vuelve a entrar', async () => {
    let ahora = 1_000_000;
    const limiter = new UploadLimiter({ maxConcurrent: 2, maxPerWindow: 2, windowMs: 60_000 }, () => ahora);
    const app = await nuevaApp(limiter);
    try {
      const quien = (await seedUser(t.app, `lim3-${Date.now()}@trust.test`)).id;
      await t.app.insertInto('user_roles').values({ user_id: quien, role: 'OPERATOR' }).execute();
      const r0 = await multipartCompleto(`e1-limite-r1-${n++}`, quien, app); expect(r0.statusCode, r0.body).toBe(201);
      ahora += 10_000;
      expect((await multipartCompleto(`e1-limite-r2-${n++}`, quien, app)).statusCode).toBe(201);
      ahora += 5_000;
      const k = `e1-limite-r3-${n++}`;
      const r = await multipartCompleto(k, quien, app);
      expect(r.statusCode).toBe(429);
      expect(r.headers['retry-after']).toBe('45'); // 60 s de ventana − 15 s transcurridos
      expect(ErrorResponseSchema.parse(r.json()).details).toMatchObject({ reason: 'RATE', retryAfterSeconds: 45 });
      expect(await keys(k)).toBe(0);
      expect(await assets(quien)).toBe(2);
      ahora += 45_000;
      expect((await multipartCompleto(k, quien, app)).statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });

  it('un upload que falla (400 por campo después del archivo) igual devuelve el cupo', async () => {
    const limiter = new UploadLimiter({ maxConcurrent: 1, maxPerWindow: 100 });
    const app = await nuevaApp(limiter);
    try {
      const bytes = readFileSync(fx('valid_screen_a_25.mp4'));
      const malo = await app.inject({
        method: 'POST', url: '/api/v1/assets',
        headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, 'idempotency-key': `e1-limite-f-${n++}`, 'x-dev-actor': actor },
        payload: Buffer.concat([cabeceraMultipart('x.mp4'), bytes, Buffer.from(`\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="extra"\r\n\r\nx\r\n--${BOUNDARY}--\r\n`)]),
      });
      expect(malo.statusCode).toBe(400);
      expect(limiter.stats(actor).active).toBe(0);
      expect((await multipartCompleto(`e1-limite-g-${n++}`, actor, app)).statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });

  it('el 400/415 previos al cupo no consumen tasa; sin actor → 401 sin tocar el limitador', async () => {
    const limiter = new UploadLimiter({ maxConcurrent: 1, maxPerWindow: 1 });
    const app = await nuevaApp(limiter);
    try {
      const sinKey = await app.inject({ method: 'POST', url: '/api/v1/assets', headers: { 'x-dev-actor': actor, 'content-type': 'application/json' }, payload: '{}' });
      expect(sinKey.statusCode).toBe(400);
      const noMultipart = await app.inject({ method: 'POST', url: '/api/v1/assets', headers: { 'x-dev-actor': actor, 'idempotency-key': `e1-limite-j-${n++}`, 'content-type': 'application/json' }, payload: '{}' });
      expect(noMultipart.statusCode, noMultipart.body).toBe(415);
      const anon = await app.inject({ method: 'POST', url: '/api/v1/assets', headers: { 'idempotency-key': `e1-limite-k-${n++}` } });
      expect(anon.statusCode).toBe(401);
      expect(limiter.stats(actor)).toEqual({ active: 0, count: 0 });
    } finally {
      await app.close();
    }
  });
});

describe('E1 · BL-10: UploadLimiter (unidad)', () => {
  it('release es idempotente; memoria acotada sin descartar actores con uploads en curso', () => {
    const l = new UploadLimiter({ maxConcurrent: 1, maxPerWindow: 10, maxActors: 2 });
    const a = l.acquire('a');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    a.release();
    a.release();
    expect(l.stats('a').active).toBe(0);
    const b = l.acquire('b');
    const c = l.acquire('c'); // descarta a 'a' (inactivo), nunca a 'b' (en curso)
    expect(b.ok && c.ok).toBe(true);
    expect(l.actors()).toBe(2);
    expect(l.stats('b').active).toBe(1);
    expect(l.stats('a')).toEqual({ active: 0, count: 0 });
  });

  it('configuración: enteros positivos; variables de entorno con rango', () => {
    expect(() => new UploadLimiter({ maxConcurrent: 0 })).toThrow();
    expect(DEFAULT_UPLOAD_LIMITS).toMatchObject({ maxConcurrent: 2, maxPerWindow: 30, windowMs: 60_000 });
    expect(uploadLimitsFromEnv({ UPLOAD_MAX_CONCURRENT_PER_ACTOR: '3', UPLOAD_MAX_PER_MINUTE_PER_ACTOR: '12' })).toEqual({ maxConcurrent: 3, maxPerWindow: 12 });
    expect(uploadLimitsFromEnv({})).toEqual({});
    expect(() => uploadLimitsFromEnv({ UPLOAD_MAX_CONCURRENT_PER_ACTOR: '0' })).toThrow();
    expect(() => uploadLimitsFromEnv({ UPLOAD_MAX_PER_MINUTE_PER_ACTOR: 'mucho' })).toThrow();
  });
});
