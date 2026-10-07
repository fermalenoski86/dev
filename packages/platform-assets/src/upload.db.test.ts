import { createHash } from 'node:crypto';
import { createReadStream, promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { verifyChain } from '@trust/platform-audit';
import { IdempotencyKeyReusedError } from '@trust/platform-db';
import { type TestDatabase, createTestDatabase, seedUser } from '@trust/platform-db/testing';
import { InvalidSurfaceTypeError, mediaRuntimeFromEnv } from '@trust/platform-media';
import { mediaFixtures } from '@trust/platform-media/fixtures';
import { LocalDiskStorage, contentKeyFor } from '@trust/platform-storage';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AssetUploadService } from './service';

/**
 * B3 — pipeline completo con PostgreSQL REAL + LocalDiskStorage REAL +
 * ffprobe/ffmpeg REALES. Sin mocks en ningún paso.
 */
let t: TestDatabase;
let root: string;
let storage: LocalDiskStorage;
let fx: (n: string) => string;
let svc: AssetUploadService;
let actor: string;
const media = { ...mediaRuntimeFromEnv({ MEDIA_INSPECTION_CONCURRENCY: '4' }) };

beforeAll(async () => {
  fx = mediaFixtures();
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-b3-'));
  storage = await LocalDiskStorage.open(path.join(root, 'store'));
  media.scratchDir = path.join(root, 'scratch');
  svc = new AssetUploadService({ db: t.app, storage, media, config: { maxUploadBytes: 50 * 1024 * 1024 } });
  actor = (await seedUser(t.app, `op-${Date.now()}@trust.test`)).id;
});
afterAll(async () => {
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const shaDe = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const subir = (fixture: string, surfaceType: string, extra: Partial<Parameters<AssetUploadService['upload']>[0]> = {}) =>
  svc.upload({ actorId: actor, surfaceType, originalFilename: fixture, body: createReadStream(fx(fixture)), ...extra });

async function archivos(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(path.relative(root, p));
    }
  };
  await walk(dir);
  return out.sort();
}
const temporales = () => archivos(path.join(root, 'store', 'tmp'));
const blobs = () => archivos(path.join(root, 'store', 'sha256'));
const scratch = () => archivos(media.scratchDir);
const eventos = async (assetId: string) =>
  (await t.app.selectFrom('audit_events').select('action').where('entity_id', '=', assetId).orderBy('seq').execute()).map((e) => e.action);
const objetosCon = async (sha: string) =>
  Number((await t.app.selectFrom('stored_objects').select(sql<string>`count(*)`.as('n')).where('sha256', '=', sha).executeTakeFirstOrThrow()).n);

beforeEach(async () => {
  expect(await temporales()).toEqual([]);
});

describe('CRITERIO: happy path — upload → VALIDATING → StoredObject → READY', () => {
  it('MP4 real de torres: READY, content-addressed, metadata de la inspección, audit encadenado', async () => {
    const r = await subir('valid_towers_ab_25.mp4', 'towers_ab');
    const sha = shaDe(fx('valid_towers_ab_25.mp4'));
    const size = (await fs.stat(fx('valid_towers_ab_25.mp4'))).size;
    expect(r.replayed).toBe(false);
    expect(r.asset).toMatchObject({ status: 'READY', sha256: sha, sizeBytes: size, mimeType: 'video/mp4', container: 'MP4', fps: 25, rejection: null });
    expect(r.asset.width).toBeGreaterThan(0);
    // StoredObject real y coherente
    const so = await t.app.selectFrom('stored_objects').selectAll().where('id', '=', r.asset.storedObjectId!).executeTakeFirstOrThrow();
    expect(so).toMatchObject({ sha256: sha, storage_key: contentKeyFor(sha), mime_type: 'video/mp4' });
    expect(Number(so.size_bytes)).toBe(size);
    // el blob final contiene exactamente los bytes subidos
    expect(createHash('sha256').update(await storage.read(so.storage_key)).digest('hex')).toBe(sha);
    expect(await eventos(r.asset.id)).toEqual(['ASSET_UPLOADED', 'ASSET_VALIDATION_STARTED', 'ASSET_VALIDATED']);
    expect((await verifyChain(t.app)).ok).toBe(true);
    expect(await temporales()).toEqual([]);
    expect(await scratch()).toEqual([]);
  });

  it('horizontal 30 fps exactos: READY', async () => {
    const r = await subir('valid_horizontal_30.mp4', 'horizontal');
    expect(r.asset).toMatchObject({ status: 'READY', fps: 30, codec: expect.any(String) });
  });
});

describe('CRITERIO: inválidos → REJECTED con código exacto, sin basura', () => {
  const casos: Array<[string, string, string, number?]> = [
    ['bad_resolution.mp4', 'horizontal', 'ASSET_BAD_RESOLUTION'],
    ['bad_codec_hevc.mp4', 'horizontal', 'ASSET_BAD_CODEC'],
    ['bad_fps_2997.mp4', 'horizontal', 'ASSET_BAD_FPS'],
    ['too_short.mp4', 'horizontal', 'ASSET_TOO_SHORT', 1000],
    ['bad_container_mov.mp4', 'horizontal', 'ASSET_BAD_CONTAINER'],
    ['multiple_video_streams.mp4', 'horizontal', 'ASSET_MULTIPLE_VIDEO_STREAMS'],
    ['no_video_audio_only.mp4', 'horizontal', 'ASSET_NO_VIDEO'],
    ['random_bytes.mp4', 'horizontal', 'ASSET_CORRUPT'],
    ['corrupt_frames.mp4', 'horizontal', 'ASSET_CORRUPT'],
  ];
  it.each(casos)('%s (%s) → %s', async (fixture, surface, code, req) => {
    const blobsAntes = await blobs();
    const r = await subir(fixture, surface, { requiredDurationMs: req });
    const sha = shaDe(fx(fixture));
    expect(r.asset.status).toBe('REJECTED');
    expect(r.asset.rejection?.code).toBe(code);
    expect(r.asset.rejection?.message).toBeTruthy();
    expect(r.asset.storedObjectId).toBeNull();
    expect(r.asset.sha256).toBe(sha);
    // detalle estructurado guardado en la base, no solo texto
    const fila = await t.app.selectFrom('assets').select(['rejection_code', 'rejection_detail']).where('id', '=', r.asset.id).executeTakeFirstOrThrow();
    expect(fila.rejection_code).toBe(code);
    expect(typeof fila.rejection_detail).toBe('object');
    expect(JSON.stringify(fila.rejection_detail)).not.toMatch(/\/tmp|scratch|ffprobe version|stderr/i);
    expect(await objetosCon(sha)).toBe(0);
    expect(await blobs()).toEqual(blobsAntes);
    expect(await temporales()).toEqual([]);
    expect(await scratch()).toEqual([]);
    expect(await eventos(r.asset.id)).toEqual(['ASSET_UPLOADED', 'ASSET_VALIDATION_STARTED', 'ASSET_REJECTED']);
  });

  it('vacío → ASSET_EMPTY desde UPLOADING, sin lanzar procesos', async () => {
    const r = await subir('empty.mp4', 'horizontal');
    expect(r.asset).toMatchObject({ status: 'REJECTED', sizeBytes: null, rejection: { code: 'ASSET_EMPTY' } });
    expect(await eventos(r.asset.id)).toEqual(['ASSET_UPLOADED', 'ASSET_REJECTED']);
    expect(await temporales()).toEqual([]);
  });

  it('supera MAX_UPLOAD_BYTES → ASSET_TOO_LARGE, stream cortado y temporal borrado', async () => {
    const chico = new AssetUploadService({ db: t.app, storage, media, config: { maxUploadBytes: 4096 } });
    const r = await chico.upload({ actorId: actor, surfaceType: 'horizontal', originalFilename: 'x.mp4', body: createReadStream(fx('valid_horizontal_30.mp4')) });
    expect(r.asset).toMatchObject({ status: 'REJECTED', rejection: { code: 'ASSET_TOO_LARGE', details: { limitBytes: 4096 } } });
    expect(await temporales()).toEqual([]);
  });

  it('surfaceType que no existe en EL_TRUST: error de request, no se crea Asset', async () => {
    const antes = await t.app.selectFrom('assets').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow();
    await expect(subir('valid_horizontal_30.mp4', 'pantalla_inventada')).rejects.toBeInstanceOf(InvalidSurfaceTypeError);
    const despues = await t.app.selectFrom('assets').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow();
    expect(despues.n).toBe(antes.n);
  });

  it('REJECTED es terminal también en las columnas nuevas', async () => {
    const r = await subir('bad_fps_50.mp4', 'horizontal');
    const err = await t.app.updateTable('assets').set({ rejection_detail: '{"message":"otro"}' }).where('id', '=', r.asset.id).execute().then(() => 'ok', (e: Error) => e.message);
    expect(err).toMatch(/ASSET_TERMINAL/);
  });
});

describe('CRITERIO: deduplicación (§15, §32)', () => {
  it('mismo MP4 dos veces: 2 Assets READY, 1 StoredObject, 1 archivo físico', async () => {
    const f = 'valid_screen_a_25.mp4';
    const a = await subir(f, 'screen_a');
    const b = await subir(f, 'screen_a');
    expect([a.asset.status, b.asset.status]).toEqual(['READY', 'READY']);
    expect(a.asset.id).not.toBe(b.asset.id);
    expect(b.asset.storedObjectId).toBe(a.asset.storedObjectId);
    expect(await objetosCon(shaDe(fx(f)))).toBe(1);
    expect((await blobs()).filter((p) => p.endsWith(shaDe(fx(f))))).toHaveLength(1);
    const ev = await t.app.selectFrom('audit_events').select('metadata').where('entity_id', '=', b.asset.id).where('action', '=', 'ASSET_VALIDATED').executeTakeFirstOrThrow();
    expect(ev.metadata).toMatchObject({ deduplicated: true });
  });

  it('dos uploads SIMULTÁNEOS del mismo contenido → un solo StoredObject y un solo blob', async () => {
    const f = 'valid_horizontal_25_audio.mp4';
    const [a, b] = await Promise.all([subir(f, 'horizontal'), subir(f, 'horizontal')]);
    expect([a.asset.status, b.asset.status]).toEqual(['READY', 'READY']);
    expect(a.asset.storedObjectId).toBe(b.asset.storedObjectId);
    expect(await objetosCon(shaDe(fx(f)))).toBe(1);
    expect((await blobs()).filter((p) => p.endsWith(shaDe(fx(f))))).toHaveLength(1);
    expect(await temporales()).toEqual([]);
  });
});

describe('CRITERIO: idempotencia (§20) — retries HTTP no duplican', () => {
  it('misma key + mismo contenido → misma respuesta, un solo Asset', async () => {
    const key = `idem-${Date.now()}-a`;
    const a = await subir('valid_horizontal_30.mp4', 'horizontal', { idempotencyKey: key });
    const n = async () => Number((await t.app.selectFrom('assets').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).n);
    const antes = await n();
    const b = await subir('valid_horizontal_30.mp4', 'horizontal', { idempotencyKey: key });
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(b.asset).toEqual(a.asset);
    expect(await n()).toBe(antes);
    expect(await temporales()).toEqual([]);
  });

  it('misma key + OTRO contenido → IDEMPOTENCY_KEY_REUSED, no se crea Asset', async () => {
    const key = `idem-${Date.now()}-b`;
    await subir('valid_horizontal_30.mp4', 'horizontal', { idempotencyKey: key });
    const n = async () => Number((await t.app.selectFrom('assets').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).n);
    const antes = await n();
    // mismo nombre, misma superficie y MISMO TAMAÑO: solo cambia un byte
    const bytes = Buffer.from(readFileSync(fx('valid_horizontal_30.mp4')));
    bytes[bytes.length - 100] = (bytes[bytes.length - 100]! + 1) % 256;
    const otro = svc.upload({ actorId: actor, surfaceType: 'horizontal', originalFilename: 'valid_horizontal_30.mp4', body: Readable.from(bytes), idempotencyKey: key });
    await expect(otro).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    expect(await n()).toBe(antes);
    expect(await temporales()).toEqual([]);
  });

  it('auditoría B3 #1: dos cuerpos DEMASIADO GRANDES y distintos con la misma key → IDEMPOTENCY_KEY_REUSED', async () => {
    const chico = new AssetUploadService({ db: t.app, storage, media, config: { maxUploadBytes: 4 } });
    const key = `idem-${Date.now()}-too-large`;
    const base = { actorId: actor, surfaceType: 'horizontal', originalFilename: 'x.mp4', idempotencyKey: key };
    const a = await chico.upload({ ...base, body: Readable.from(Buffer.from('AAAAA')) });
    expect(a.asset.rejection?.code).toBe('ASSET_TOO_LARGE');
    // mismo cuerpo → replay del mismo Asset
    const again = await chico.upload({ ...base, body: Readable.from([Buffer.from('AA'), Buffer.from('AAA')]) });
    expect(again.replayed).toBe(true);
    expect(again.asset.id).toBe(a.asset.id);
    // otro cuerpo → 409
    await expect(chico.upload({ ...base, body: Readable.from(Buffer.from('BBBBB')) })).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    expect(await temporales()).toEqual([]);
  });

  it('retries simultáneos con la misma key → una sola ejecución', async () => {
    const key = `idem-${Date.now()}-c`;
    const [a, b] = await Promise.all([
      subir('valid_horizontal_30.mp4', 'horizontal', { idempotencyKey: key }),
      subir('valid_horizontal_30.mp4', 'horizontal', { idempotencyKey: key }),
    ]);
    expect(a.asset.id).toBe(b.asset.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
  });
});

describe('CRITERIO: fallo de la base DESPUÉS del commit de storage (§16, §33)', () => {
  it('blob final queda seguro, Asset no queda READY, y el retry idempotente recupera', async () => {
    const f = 'valid_with_cover_art.mp4';
    const sha = shaDe(fx(f));
    const key = `idem-${Date.now()}-db`;
    // Falla REAL de PostgreSQL al pasar a READY (trigger del dueño del esquema).
    await sql.raw(`CREATE FUNCTION b3_falla() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'B3_FALLA_SIMULADA'; END $$;
      CREATE TRIGGER zz_b3_falla BEFORE UPDATE ON assets FOR EACH ROW WHEN (NEW.status = 'READY') EXECUTE FUNCTION b3_falla();`).execute(t.owner);
    try {
      await expect(subir(f, 'horizontal', { idempotencyKey: key })).rejects.toThrow(/B3_FALLA_SIMULADA/);
    } finally {
      await sql.raw('DROP TRIGGER zz_b3_falla ON assets; DROP FUNCTION b3_falla();').execute(t.owner);
    }
    // el blob content-addressed existe (huérfano seguro), sin StoredObject
    expect(await storage.exists(contentKeyFor(sha))).toBe(true);
    expect(await objetosCon(sha)).toBe(0);
    // el Asset del intento fallido NO quedó READY y ningún evento dice VALIDATED
    const intento = await t.app.selectFrom('assets').select(['id', 'status']).where('sha256', '=', sha).executeTakeFirstOrThrow();
    const fallido = intento.id;
    expect(intento.status).toBe('VALIDATING');
    expect(await eventos(fallido)).toEqual(['ASSET_UPLOADED', 'ASSET_VALIDATION_STARTED']);
    expect(await temporales()).toEqual([]);
    // la reserva de la key se revirtió: el retry corre y deduplica el blob
    const r = await subir(f, 'horizontal', { idempotencyKey: key });
    expect(r.replayed).toBe(false);
    expect(r.asset.status).toBe('READY');
    expect(r.asset.id).not.toBe(fallido);
    expect(await objetosCon(sha)).toBe(1);
    expect((await blobs()).filter((p) => p.endsWith(sha))).toHaveLength(1);
    const ev = await t.app.selectFrom('audit_events').select('metadata').where('entity_id', '=', r.asset.id).where('action', '=', 'ASSET_VALIDATED').executeTakeFirstOrThrow();
    expect(ev.metadata).toMatchObject({ deduplicated: true });
    expect((await verifyChain(t.app)).ok).toBe(true);
    // y un tercer intento con la misma key ya es replay
    expect((await subir(f, 'horizontal', { idempotencyKey: key })).replayed).toBe(true);
  });
});

describe('CRITERIO: filenames hostiles nunca llegan a un path (§7, §34)', () => {
  const nombres = ['../../../../etc/passwd', '..\\..\\boot.ini', 'a\u0000b.mp4', '$(touch PWNED).mp4', 'x\u202egpj.exe.mp4', 'ñandú 🎬.mp4.mp4'];
  it.each(nombres)('%j: READY con el nombre como metadata, nada fuera de store/', async (nombre) => {
    const r = await svc.upload({ actorId: actor, surfaceType: 'horizontal', originalFilename: nombre, body: Readable.from(readFileSync(fx('one_frame_25.mp4'))) });
    expect(r.asset.status).toBe('READY');
    expect(r.asset.originalFilename.includes('\u0000') || r.asset.originalFilename.includes('\u202e')).toBe(false);
    const todo = await archivos(root);
    expect(todo.every((p) => p.startsWith(`store${path.sep}`))).toBe(true);
    expect(todo.some((p) => /passwd|boot\.ini|PWNED|ñandú/.test(p))).toBe(false);
    await expect(fs.access(path.join(process.cwd(), 'PWNED).mp4'))).rejects.toThrow();
  });
});

describe('CRITERIO: housekeeping de temporales (§25)', () => {
  it('cleanupTemporaryObjects borra temporales vencidos y nunca blobs finales', async () => {
    const blobsAntes = await blobs();
    expect(blobsAntes.length).toBeGreaterThan(0);
    await storage.putTemporary('huerfano-b3-0001', Readable.from(Buffer.from('basura')));
    expect(await temporales()).not.toEqual([]);
    expect(await storage.cleanupTemporaryObjects(0)).toBeGreaterThanOrEqual(1);
    expect(await temporales()).toEqual([]);
    expect(await blobs()).toEqual(blobsAntes);
  });
});
