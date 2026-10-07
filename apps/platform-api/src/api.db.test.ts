import { promises as fs, openAsBlob, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { type TestDatabase, createTestDatabase, seedUser } from '@trust/platform-db/testing';
import { connect } from '@trust/platform-db';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { mediaFixtures } from '@trust/platform-media/fixtures';
import { LocalDiskStorage, type ObjectStorage } from '@trust/platform-storage';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevelopmentActorProvider } from './actor';
import { buildApp } from './app';
import { AssetListResponseSchema, AssetResponseSchema, AssetStatusResponseSchema, ErrorResponseSchema } from './contracts';

/**
 * B4 — E2E de API: Fastify real + PostgreSQL real + LocalDiskStorage real +
 * ffprobe/ffmpeg reales. Sin mocks en el camino feliz.
 */
let t: TestDatabase;
let root: string;
let storage: LocalDiskStorage;
let fx: (n: string) => string;
let app: FastifyInstance;
let actor: string;
let otro: string;
const logs: string[] = [];
const media = { ...mediaRuntimeFromEnv({ MEDIA_INSPECTION_CONCURRENCY: '4' }) };
const MAX = 50 * 1024 * 1024;

const logStream = new Writable({ write(chunk, _e, cb) { logs.push(String(chunk)); cb(); } });

async function nuevaApp(over: Partial<Parameters<typeof buildApp>[0]> = {}) {
  return buildApp({
    db: t.app, storage, media, actors: new DevelopmentActorProvider(t.app), maxUploadBytes: MAX, mediaBinariesOk: () => true,
    log: { stream: logStream }, ...over,
  });
}

beforeAll(async () => {
  fx = mediaFixtures();
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-b4-'));
  storage = await LocalDiskStorage.open(path.join(root, 'store'));
  media.scratchDir = path.join(root, 'scratch');
  actor = (await seedUser(t.app, `api-${Date.now()}@trust.test`)).id;
  otro = (await seedUser(t.app, `otro-${Date.now()}@trust.test`)).id;
  app = await nuevaApp();
});
afterAll(async () => {
  await app?.close();
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

/** multipart real armado por undici (FormData), inyectado como bytes. */
async function multipart(campos: Array<[string, string] | [string, Buffer, string]>) {
  const fd = new FormData();
  for (const c of campos) {
    if (c.length === 2) fd.append(c[0], c[1]);
    else fd.append(c[0], new Blob([new Uint8Array(c[1])]), c[2]);
  }
  const req = new Request('http://local/', { method: 'POST', body: fd });
  return { payload: Buffer.from(await req.arrayBuffer()), contentType: req.headers.get('content-type') as string };
}

let n = 0;
async function subir(fixture: string | Buffer, surfaceType: string | null, opts: { key?: string | null; who?: string | null; name?: string; extra?: Array<[string, string]>; target?: FastifyInstance } = {}) {
  const bytes = typeof fixture === 'string' ? readFileSync(fx(fixture)) : fixture;
  const campos: Array<[string, string] | [string, Buffer, string]> = [];
  if (surfaceType !== null) campos.push(['surfaceType', surfaceType]);
  for (const e of opts.extra ?? []) campos.push(e);
  campos.push(['file', bytes, opts.name ?? (typeof fixture === 'string' ? fixture : 'x.mp4')]);
  const mp = await multipart(campos);
  const headers: Record<string, string> = { 'content-type': mp.contentType };
  const key = opts.key === undefined ? `k-${Date.now()}-${n++}` : opts.key;
  if (key !== null) headers['idempotency-key'] = key;
  const who = opts.who === undefined ? actor : opts.who;
  if (who !== null) headers['x-dev-actor'] = who;
  return (opts.target ?? app).inject({ method: 'POST', url: '/api/v1/assets', headers, payload: mp.payload });
}
const get = (url: string, who: string | null = actor) => app.inject({ method: 'GET', url, headers: who ? { 'x-dev-actor': who } : {} });
const contarAssets = async () => Number((await t.app.selectFrom('assets').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).n);

const esError = (body: unknown, code: string) => {
  const e = ErrorResponseSchema.parse(body);
  expect(e.code).toBe(code);
  return e;
};
const sinFiltraciones = (raw: string) => {
  expect(raw).not.toMatch(/\bat \w+ \(|node_modules|\/tmp\/|trust-b4-|SELECT |INSERT |postgres:\/\/|password|ECONNREFUSED|stack/i);
};

describe('CRITERIO: health / readiness (§24)', () => {
  it('/health solo dice que el proceso vive', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ status: 'ok' });
  });

  it('/ready comprueba PostgreSQL y storage reales', async () => {
    const r = await app.inject({ method: 'GET', url: '/ready' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ status: 'ready', checks: { database: 'ok', storage: 'ok', media: 'ok' } });
  });

  it('/ready → 503 si cae la base, el storage o faltan los binarios (sin detalle interno)', async () => {
    const dbCaida = connect('postgres://nadie:nada@127.0.0.1:1/x');
    const storageCaido = { ...storage, ping: async () => { throw new Error('EACCES /var/secret/path'); } } as unknown as ObjectStorage;
    const casos = [
      [await nuevaApp({ db: dbCaida, log: false }), 'database'],
      [await nuevaApp({ storage: storageCaido, log: false }), 'storage'],
      [await nuevaApp({ mediaBinariesOk: () => false, log: false }), 'media'],
    ] as const;
    for (const [a, check] of casos) {
      const r = await a.inject({ method: 'GET', url: '/ready' });
      expect(r.statusCode).toBe(503);
      expect(r.json().checks[check]).toBe('fail');
      sinFiltraciones(r.body);
      await a.close();
    }
    await dbCaida.destroy();
  });
});

describe('CRITERIO: RequestActor (§19) — las rutas no son públicas', () => {
  it.each([
    ['sin header', null],
    ['uuid inválido', 'no-es-uuid'],
    ['usuario inexistente', '00000000-0000-4000-8000-000000000000'],
  ])('%s → 401 UNAUTHENTICATED', async (_n, who) => {
    const r = await get('/api/v1/assets', who);
    expect(r.statusCode).toBe(401);
    esError(r.json(), 'UNAUTHENTICATED');
  });

  it('usuario deshabilitado → 401', async () => {
    const u = await seedUser(t.app, `off-${Date.now()}@trust.test`);
    await t.app.updateTable('users').set({ enabled: false }).where('id', '=', u.id).execute();
    expect((await get('/api/v1/assets', u.id)).statusCode).toBe(401);
  });

  it('upload sin actor → 401 y no se crea nada', async () => {
    const antes = await contarAssets();
    const r = await subir('valid_horizontal_30.mp4', 'horizontal', { who: null });
    expect(r.statusCode).toBe(401);
    expect(await contarAssets()).toBe(antes);
  });
});

describe('CRITERIO: POST /api/v1/assets — upload real (§18, §20, §22)', () => {
  it('MP4 válido → 201 READY con contrato Zod, x-request-id y sin paths', async () => {
    const r = await subir('valid_towers_ab_25.mp4', 'towers_ab', { name: '../../etc/passwd' });
    expect(r.statusCode).toBe(201);
    const a = AssetResponseSchema.parse(r.json());
    expect(a).toMatchObject({ status: 'READY', container: 'MP4', mimeType: 'video/mp4', fps: 25, rejection: null });
    expect(r.headers['x-request-id']).toBeTruthy();
    expect(r.headers['idempotent-replayed']).toBe('false');
    sinFiltraciones(r.body);
  });

  it('retry con la misma Idempotency-Key → misma respuesta (200, replay), un solo Asset', async () => {
    const key = `retry-${Date.now()}`;
    const a = await subir('valid_horizontal_30.mp4', 'horizontal', { key });
    const antes = await contarAssets();
    const b = await subir('valid_horizontal_30.mp4', 'horizontal', { key });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.json().id).toBe(a.json().id);
    expect(await contarAssets()).toBe(antes);
  });

  it('misma key + otro contenido → 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = `reuse-${Date.now()}`;
    await subir('valid_horizontal_30.mp4', 'horizontal', { key });
    const r = await subir('valid_horizontal_25_audio.mp4', 'horizontal', { key, name: 'valid_horizontal_30.mp4' });
    expect(r.statusCode).toBe(409);
    esError(r.json(), 'IDEMPOTENCY_KEY_REUSED');
  });

  it('sin Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED, no se crea nada', async () => {
    const antes = await contarAssets();
    const r = await subir('valid_horizontal_30.mp4', 'horizontal', { key: null });
    expect(r.statusCode).toBe(400);
    esError(r.json(), 'IDEMPOTENCY_KEY_REQUIRED');
    expect(await contarAssets()).toBe(antes);
  });

  it('media inválida → 422 con el código exacto, el Asset y la remediación (BL-03)', async () => {
    const r = await subir('bad_fps_2997.mp4', 'horizontal');
    expect(r.statusCode).toBe(422);
    const e = esError(r.json(), 'ASSET_BAD_FPS');
    const asset = AssetResponseSchema.parse(e.details?.asset);
    expect(asset.status).toBe('REJECTED');
    expect(asset.rejection?.remediation.ffmpeg?.args).toContain('{input}');
    expect(asset.rejection?.remediation.ffmpeg?.args.join(' ')).toContain('fps=30');
    sinFiltraciones(r.body);
  });

  it('contenedor no MP4 → 415; demasiado grande → 413 (corte en el límite)', async () => {
    const mov = await subir('bad_container_mov.mp4', 'horizontal');
    expect(mov.statusCode).toBe(415);
    esError(mov.json(), 'ASSET_BAD_CONTAINER');
    const chica = await nuevaApp({ maxUploadBytes: 4096, log: false });
    const grande = await subir('valid_horizontal_30.mp4', 'horizontal', { target: chica });
    expect(grande.statusCode).toBe(413);
    const e = esError(grande.json(), 'ASSET_TOO_LARGE');
    expect((e.details?.asset as { rejection: { details: unknown } }).rejection.details).toEqual({ limitBytes: 4096 });
    await chica.close();
  });

  it('surfaceType que no existe en EL_TRUST → 400 y no se crea Asset; sin surfaceType → 400', async () => {
    const antes = await contarAssets();
    const r = await subir('valid_horizontal_30.mp4', 'pantalla_inventada');
    expect(r.statusCode).toBe(400);
    esError(r.json(), 'INVALID_SURFACE_TYPE');
    const sin = await subir('valid_horizontal_30.mp4', null);
    expect(sin.statusCode).toBe(400);
    esError(sin.json(), 'VALIDATION_ERROR');
    const raro = await subir('valid_horizontal_30.mp4', 'horizontal', { extra: [['admin', 'true']] });
    expect(raro.statusCode).toBe(400);
    expect(await contarAssets()).toBe(antes);
  });

  it('auditoría B4 #1: campo o segundo archivo DESPUÉS de file → 400, sin Asset, sin key y sin temporal', async () => {
    const tmp = path.join(root, 'store', 'tmp');
    const temporales = async () => (await fs.readdir(tmp).catch(() => [])).length;
    const bytes = readFileSync(fx('valid_horizontal_30.mp4'));
    const casos: Array<Array<[string, string] | [string, Buffer, string]>> = [
      [['surfaceType', 'horizontal'], ['file', bytes, 'a.mp4'], ['admin', 'true']],
      [['surfaceType', 'horizontal'], ['file', bytes, 'a.mp4'], ['file', bytes, 'b.mp4']],
      [['surfaceType', 'horizontal'], ['file', bytes, 'a.mp4'], ['otro', bytes, 'c.mp4']],
      [['surfaceType', 'horizontal'], ['file', bytes, 'a.mp4'], ['surfaceType', 'screen_a']],
    ];
    for (const campos of casos) {
      const antes = await contarAssets();
      const key = `despues-${Date.now()}-${n++}`;
      const mp = await multipart(campos);
      const r = await app.inject({ method: 'POST', url: '/api/v1/assets', headers: { 'content-type': mp.contentType, 'x-dev-actor': actor, 'idempotency-key': key }, payload: mp.payload });
      expect(r.statusCode, JSON.stringify(campos.map((c) => c[0]))).toBe(400);
      esError(r.json(), 'VALIDATION_ERROR');
      expect(await contarAssets()).toBe(antes);
      const k = await t.app.selectFrom('idempotency_keys').select('key').where('key', '=', key).executeTakeFirst();
      expect(k).toBeUndefined();
      expect(await temporales()).toBe(0);
    }
    // y la misma solicitud bien formada, con la misma forma de armado, sí entra
    const ok = await subir('valid_horizontal_30.mp4', 'horizontal');
    expect(ok.statusCode).toBe(201);
  });

  it('cuerpo que no es multipart → 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/assets', headers: { 'x-dev-actor': actor, 'idempotency-key': 'json-12345678', 'content-type': 'application/json' }, payload: { file: 'x' } });
    expect(r.statusCode).toBe(415);
    esError(r.json(), 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('upload por HTTP real (socket, stream desde disco) → 201', async () => {
    const real = await nuevaApp({ log: false });
    await real.listen({ host: '127.0.0.1', port: 0 });
    try {
      const addr = real.server.address() as { port: number };
      const fd = new FormData();
      fd.append('surfaceType', 'screen_a');
      fd.append('file', await openAsBlob(fx('valid_screen_a_25.mp4')), 'screen_a.mp4');
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/assets`, { method: 'POST', body: fd, headers: { 'x-dev-actor': actor, 'idempotency-key': `http-${Date.now()}`, 'x-request-id': 'req-desde-cliente-1' } });
      expect(res.status).toBe(201);
      expect(res.headers.get('x-request-id')).toBe('req-desde-cliente-1');
      expect(AssetResponseSchema.parse(await res.json()).status).toBe('READY');
    } finally {
      await real.close();
    }
  });
});

describe('CRITERIO: lectura de Assets', () => {
  it('GET /:id y /:id/status con contrato; ajeno o inexistente → 404; id inválido → 400', async () => {
    const up = await subir('one_frame_25.mp4', 'horizontal');
    const id = up.json().id as string;
    const r = await get(`/api/v1/assets/${id}`);
    expect(r.statusCode).toBe(200);
    expect(AssetResponseSchema.parse(r.json()).id).toBe(id);
    const s = await get(`/api/v1/assets/${id}/status`);
    expect(AssetStatusResponseSchema.parse(s.json())).toEqual({ id, status: 'READY', rejection: null });
    esError((await get(`/api/v1/assets/${id}`, otro)).json(), 'ASSET_NOT_FOUND');
    expect((await get('/api/v1/assets/00000000-0000-4000-8000-000000000001')).statusCode).toBe(404);
    const malo = await get('/api/v1/assets/..%2F..%2Fetc');
    expect(malo.statusCode).toBe(400);
    esError(malo.json(), 'VALIDATION_ERROR');
  });

  it('GET lista: solo del actor, filtro por estado, paginación por cursor sin repetidos', async () => {
    const todos: string[] = [];
    let cursor: string | null = null;
    do {
      const r = await get(`/api/v1/assets?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(r.statusCode).toBe(200);
      const page = AssetListResponseSchema.parse(r.json());
      todos.push(...page.items.map((a) => a.id));
      cursor = page.nextCursor;
    } while (cursor);
    const propios = await t.app.selectFrom('assets').select('id').where('created_by', '=', actor).execute();
    expect(new Set(todos).size).toBe(todos.length);
    expect(todos.sort()).toEqual(propios.map((p) => p.id).sort());
    const rej = AssetListResponseSchema.parse((await get('/api/v1/assets?status=REJECTED&limit=100')).json());
    expect(rej.items.length).toBeGreaterThan(0);
    expect(rej.items.every((a) => a.status === 'REJECTED' && a.rejection?.remediation.summary)).toBe(true);
    expect((await get('/api/v1/assets?limit=0')).statusCode).toBe(400);
    expect((await get('/api/v1/assets?status=BORRADO')).statusCode).toBe(400);
    expect((await get('/api/v1/assets?sql=1')).statusCode).toBe(400);
  });
});

describe('CRITERIO: la API no modifica Assets terminales (§26)', () => {
  it('PATCH / PUT / DELETE no existen y el Asset queda intacto', async () => {
    const up = await subir('valid_horizontal_30.mp4', 'horizontal');
    const id = up.json().id as string;
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const r = await app.inject({ method, url: `/api/v1/assets/${id}`, headers: { 'x-dev-actor': actor, 'content-type': 'application/json' }, payload: { status: 'REJECTED' } });
      expect(r.statusCode, method).toBe(404);
      esError(r.json(), 'NOT_FOUND');
    }
    expect((await get(`/api/v1/assets/${id}`)).json().status).toBe('READY');
  });
});

describe('CRITERIO: contrato de error y observabilidad (§22, §23)', () => {
  it('error interno → 500 INTERNAL_ERROR sin SQL, stack, paths ni secretos; el detalle va solo al log', async () => {
    const dbCaida = connect('postgres://usuario:secreto-super@127.0.0.1:1/x');
    const rota = await buildApp({ db: dbCaida, storage, media, actors: { resolve: async () => ({ userId: actor, source: 'development' }) }, maxUploadBytes: MAX, mediaBinariesOk: () => true, log: { stream: logStream } });
    const r = await rota.inject({ method: 'GET', url: '/api/v1/assets', headers: { 'x-request-id': 'req-500-test' } });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ code: 'INTERNAL_ERROR', message: 'Error interno.', requestId: 'req-500-test' });
    sinFiltraciones(r.body);
    expect(logs.some((l) => l.includes('req-500-test') && l.includes('"level":50'))).toBe(true);
    await rota.close();
    await dbCaida.destroy();
  });

  it('cada request tiene requestId; el del cliente se respeta si es seguro', async () => {
    const r = await get('/api/v1/assets/00000000-0000-4000-8000-000000000002');
    expect(r.json().requestId).toBe(r.headers['x-request-id']);
    const inyectado = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'x\r\nSet-Cookie: a=b' } });
    expect(inyectado.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('log JSON del upload: assetId, requestId, bytes, duración, resultado; sin actor, key ni contenido', async () => {
    logs.length = 0;
    const key = `log-${Date.now()}-secreta`;
    const r = await subir('valid_horizontal_30.mp4', 'horizontal', { key, name: 'Campaña Ñandú.mp4' });
    const id = r.json().id as string;
    const evento = logs.map((l) => JSON.parse(l)).find((l) => l.event === 'asset.upload');
    expect(evento).toMatchObject({ assetId: id, requestId: r.headers['x-request-id'], bytes: expect.any(Number), durationMs: expect.any(Number), result: 'READY', filename: 'Campana Nandu.mp4' });
    const todo = logs.join('\n');
    expect(todo).not.toContain(actor);
    expect(todo).not.toContain(key);
    expect(todo).not.toContain('ftypisom');
    expect(todo.length).toBeLessThan(20_000);
  });
});
