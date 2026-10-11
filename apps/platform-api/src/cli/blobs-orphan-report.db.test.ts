import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { AssetUploadService } from '@trust/platform-assets';
import { type TestDatabase, createTestDatabase, seedUser } from '@trust/platform-db/testing';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { mediaFixtures } from '@trust/platform-media/fixtures';
import { LocalDiskStorage, contentKeyFor } from '@trust/platform-storage';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORPHAN_GRACE_MINUTES, parseOrphanReportArgs, runOrphanReport } from './blobs-orphan-report';

/**
 * BL-08 · reporte de blobs huérfanos con PostgreSQL REAL, LocalDiskStorage REAL
 * y el pipeline REAL de uploads (ffprobe/ffmpeg). Criterio del backlog: con el
 * huérfano real de §33 (falla de la base DESPUÉS del commit de storage) y un
 * blob con StoredObject, solo el primero aparece. Cero borrado.
 */
let t: TestDatabase;
let root: string;
let storage: LocalDiskStorage;
let svc: AssetUploadService;
let fx: (n: string) => string;
let actor: string;
const media = { ...mediaRuntimeFromEnv({ MEDIA_INSPECTION_CONCURRENCY: '2' }) };
const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const K: Record<string, string> = {};

const shaDe = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const absDe = (key: string) => path.join(storage.root, ...key.split('/'));
/** Envejece un blob como lo dejaría el tiempo: solo su mtime, sin tocar bytes. */
async function envejecer(key: string, ms: number) {
  const cuando = new Date(Date.now() - ms);
  await fs.utimes(absDe(key), cuando, cuando);
}
async function blobSuelto(etiqueta: string): Promise<string> {
  const bytes = Buffer.from(`blob sin StoredObject ${etiqueta} ${Math.random()}`);
  const key = contentKeyFor(shaDe(bytes));
  await storage.putIfAbsent(key, Readable.from([bytes]));
  return key;
}
const subir = (fixture: string, extra: Partial<Parameters<AssetUploadService['upload']>[0]> = {}) =>
  svc.upload({ actorId: actor, surfaceType: 'horizontal', originalFilename: `cliente-${fixture}`, body: createReadStream(fx(fixture)), ...extra });

/** Foto completa de storage (clave, tamaño, mtime, sha real) y de la base. */
async function foto() {
  const archivos: string[] = [];
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        const st = await fs.lstat(p);
        const sha = e.isFile() ? shaDe(await fs.readFile(p)) : 'no-regular';
        archivos.push(`${path.relative(root, p)} ${st.size} ${st.mtimeMs} ${sha}`);
      }
    }
  };
  await walk(root);
  const n = async (tabla: 'stored_objects' | 'assets' | 'audit_events') =>
    Number((await t.app.selectFrom(tabla).select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).n);
  return {
    archivos: archivos.sort(),
    storedObjects: await n('stored_objects'),
    assets: await t.app.selectFrom('assets').select(['id', 'status', 'updated_at', 'stored_object_id']).orderBy('id').execute(),
    audit: await n('audit_events'),
  };
}

beforeAll(async () => {
  fx = mediaFixtures();
  t = await createTestDatabase();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-bl08-'));
  storage = await LocalDiskStorage.open(path.join(root, 'store'));
  media.scratchDir = path.join(root, 'scratch');
  svc = new AssetUploadService({ db: t.app, storage, media, config: { maxUploadBytes: 50 * 1024 * 1024 } });
  actor = (await seedUser(t.app, `ops-${Date.now()}@trust.test`)).id;

  // 1) El huérfano REAL de §33: la base falla al pasar a READY, después del commit de storage.
  await sql.raw(`CREATE FUNCTION bl08_falla() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'BL08_FALLA_SIMULADA'; END $$;
    CREATE TRIGGER zz_bl08_falla BEFORE UPDATE ON assets FOR EACH ROW WHEN (NEW.status = 'READY') EXECUTE FUNCTION bl08_falla();`).execute(t.owner);
  try {
    await expect(subir('valid_with_cover_art.mp4')).rejects.toThrow(/BL08_FALLA_SIMULADA/);
  } finally {
    await sql.raw('DROP TRIGGER zz_bl08_falla ON assets; DROP FUNCTION bl08_falla();').execute(t.owner);
  }
  K.h33 = contentKeyFor(shaDe(await fs.readFile(fx('valid_with_cover_art.mp4'))));
  expect(await storage.exists(K.h33)).toBe(true);
  expect(await t.app.selectFrom('stored_objects').select('id').where('sha256', '=', K.h33!.slice(-64)).executeTakeFirst()).toBeUndefined();

  // 2) Un blob CON StoredObject: upload real que llega a READY.
  const ok = await subir('one_frame_25.mp4');
  expect(ok.asset.status).toBe('READY');
  K.ref = contentKeyFor(shaDe(await fs.readFile(fx('one_frame_25.mp4'))));

  await envejecer(K.h33, 2 * DIA);
  await envejecer(K.ref, 2 * DIA);
});
afterAll(async () => {
  await t?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe('BL-08 · CRITERIO: huérfano real de §33 vs blob con StoredObject', () => {
  it('solo el huérfano aparece; el blob referenciado no', async () => {
    const r = await runOrphanReport(t.app, storage, []);
    expect(r.items.map((i) => i.key)).toEqual([K.h33]);
    expect(r).toMatchObject({ scanned: 2, referenced: 1, withinGrace: 0, total: 1, truncated: false, storageDriver: 'local', graceMs: DEFAULT_ORPHAN_GRACE_MINUTES * MIN });
    expect(r.unrecognized).toEqual({ total: 0, truncated: false, items: [] });
    const h = r.items[0]!;
    expect(h.sha256).toBe(K.h33!.slice(-64));
    expect(h.sizeBytes).toBe((await fs.stat(fx('valid_with_cover_art.mp4'))).size);
    expect(r.totalBytes).toBe(h.sizeBytes);
    expect(h.ageMs).toBeGreaterThanOrEqual(2 * DIA);
    expect(h.ageMs).toBeLessThan(2 * DIA + 5 * MIN);
    expect(new Date(r.generatedAt).getTime() - new Date(h.lastModified).getTime()).toBe(h.ageMs);
  });
});

describe('BL-08 · período de gracia, límite y claves no canónicas', () => {
  beforeAll(async () => {
    K.viejo = await blobSuelto('3 días');
    K.nuevo = await blobSuelto('recién escrito');
    K.borde = await blobSuelto('23 h 59 min');
    await envejecer(K.viejo, 3 * DIA);
    await envejecer(K.borde, DIA - MIN);
    const shard = K.ref!.split('/')[1]!;
    await fs.writeFile(path.join(storage.root, 'sha256', shard, 'no-canonica.mp4'), 'algo escrito por fuera');
    // forma de sha256 pero en el shard equivocado
    K.otroShard = shaDe(Buffer.from(`otro shard ${Math.random()}`));
    while (K.otroShard.startsWith(shard)) K.otroShard = shaDe(Buffer.from(K.otroShard));
    await fs.writeFile(path.join(storage.root, 'sha256', shard, K.otroShard), 'shard equivocado');
    // clave canónica pero symlink hacia afuera del storage
    K.link = shaDe(Buffer.from(`symlink ${Math.random()}`));
    await fs.mkdir(path.join(storage.root, 'sha256', K.link.slice(0, 2)), { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(root, 'afuera.txt'), 'fuera del storage');
    await fs.symlink(path.join(root, 'afuera.txt'), path.join(storage.root, 'sha256', K.link.slice(0, 2), K.link));
    const viejo = new Date(Date.now() - 5 * DIA);
    for (const f of [path.join(storage.root, 'sha256', shard, 'no-canonica.mp4'), path.join(storage.root, 'sha256', shard, K.otroShard)]) await fs.utimes(f, viejo, viejo);
  });

  it('la gracia manda: lo reciente y el borde (23 h 59 min con 24 h) no se informan; con 30 min, sí', async () => {
    const r = await runOrphanReport(t.app, storage, []);
    expect(r.items.map((i) => i.key)).toEqual([K.viejo, K.h33]); // del más viejo al más nuevo
    expect(r).toMatchObject({ total: 2, referenced: 1, withinGrace: 2, scanned: 8, truncated: false });
    const corto = await runOrphanReport(t.app, storage, ['--grace-minutes', '30']);
    expect(corto.items.map((i) => i.key)).toEqual([K.viejo, K.h33, K.borde]);
    expect(corto.withinGrace).toBe(1); // el recién escrito sigue protegido
    const largo = await runOrphanReport(t.app, storage, ['--grace-minutes', String(3 * 24 * 60 + 1)]);
    expect(largo).toMatchObject({ total: 0, items: [], withinGrace: 4 });
  });

  it('limit corta la lista (quedan los más viejos) pero total y bytes siguen completos', async () => {
    const r = await runOrphanReport(t.app, storage, ['--limit', '1']);
    expect(r.items.map((i) => i.key)).toEqual([K.viejo]);
    expect([r.total, r.truncated]).toEqual([2, true]);
    const completos = await runOrphanReport(t.app, storage, []);
    expect(r.totalBytes).toBe(completos.totalBytes);
  });

  it('lo que no es clave canónica (nombre raro, shard equivocado, symlink) no se cruza con la base: va a unrecognized', async () => {
    const r = await runOrphanReport(t.app, storage, []);
    const rara = `sha256/${K.ref!.split('/')[1]}/no-canonica.mp4`;
    const shard = K.ref!.split('/')[1];
    const esperado = [
      { key: rara, regularFile: true },
      { key: `sha256/${shard}/${K.otroShard}`, regularFile: true },
      { key: `sha256/${K.link!.slice(0, 2)}/${K.link}`, regularFile: false },
    ].sort((a, b) => a.key.localeCompare(b.key));
    expect(r.unrecognized).toEqual({ total: 3, truncated: false, items: esperado });
    for (const e of esperado) expect(r.items.map((i) => i.key)).not.toContain(e.key);
    expect(r.items.map((i) => i.key)).toEqual([K.viejo, K.h33]);
    expect((await runOrphanReport(t.app, storage, ['--limit', '1'])).unrecognized).toMatchObject({ total: 3, truncated: true });
  });

  it('CERO borrado y solo lectura: storage (bytes, mtimes) y base idénticos antes y después', async () => {
    const antes = await foto();
    await runOrphanReport(t.app, storage, []);
    await runOrphanReport(t.app, storage, ['--grace-minutes', '1', '--limit', '1']);
    expect(await foto()).toEqual(antes);
  });

  it('la base se consulta en transacciones READ ONLY de PostgreSQL y después solo hay SELECT', async () => {
    const vistas: string[] = [];
    const espia = t.app.withPlugin({
      transformQuery: (a) => {
        vistas.push(t.app.getExecutor().compileQuery(a.node, a.queryId).sql.trim().replace(/\s+/g, ' '));
        return a.node;
      },
      transformResult: async (a) => a.result,
    });
    await runOrphanReport(espia, storage, []);
    expect(vistas.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < vistas.length; i += 2) {
      expect(vistas[i]).toBe('SET TRANSACTION READ ONLY');
      expect(vistas[i + 1], vistas[i + 1]).toMatch(/^select "sha256" from "stored_objects" where "sha256" in/i);
    }
  });

  it('datos mínimos: clave, sha256, tamaño y fechas; sin rutas absolutas ni nombres del cliente', async () => {
    const r = await runOrphanReport(t.app, storage, ['--grace-minutes', '1']);
    for (const i of r.items) expect(Object.keys(i).sort()).toEqual(['ageMs', 'key', 'lastModified', 'sha256', 'sizeBytes']);
    const json = JSON.stringify(r);
    expect(json).not.toContain(root);
    expect(json).not.toContain('cliente-');
  });

  it('cuando el retry idempotente crea el StoredObject, el mismo blob deja de ser huérfano (por eso nunca se borra)', async () => {
    // Otro Asset con el mismo contenido deduplica el blob: un borrado "por huérfano" lo habría roto.
    const r = await subir('valid_with_cover_art.mp4');
    expect(r.asset.status).toBe('READY');
    const despues = await runOrphanReport(t.app, storage, []);
    expect(despues.items.map((i) => i.key)).toEqual([K.viejo]);
    expect(despues.items.map((i) => i.key)).not.toContain(K.h33);
    expect(despues.referenced).toBe(2);
  });
});

describe('BL-08 · argumentos del CLI', () => {
  it('default 1440 min (o BLOB_ORPHAN_GRACE_MINUTES) y limit 500; el argumento gana a la variable', () => {
    expect(DEFAULT_ORPHAN_GRACE_MINUTES).toBe(1440);
    expect(parseOrphanReportArgs([])).toEqual({ graceMs: DIA, limit: 500 });
    expect(parseOrphanReportArgs([], { BLOB_ORPHAN_GRACE_MINUTES: '90' })).toEqual({ graceMs: 90 * MIN, limit: 500 });
    expect(parseOrphanReportArgs(['--grace-minutes', '5', '--limit', '10'], { BLOB_ORPHAN_GRACE_MINUTES: '90' })).toEqual({ graceMs: 5 * MIN, limit: 10 });
  });

  it('rechaza gracia y límites inválidos, opciones desconocidas (incluida cualquier forma de borrar) y posicionales', () => {
    for (const argv of [['--grace-minutes', '0'], ['--grace-minutes', '-5'], ['--grace-minutes', '1.5'], ['--grace-minutes', 'abc'], ['--grace-minutes', ''], ['--grace-minutes', '999999999'], ['--limit', '0'], ['--limit', '10001'], ['--delete'], ['--fix'], ['extra']]) {
      expect(() => parseOrphanReportArgs(argv), argv.join(' ')).toThrow();
    }
    expect(() => parseOrphanReportArgs([], { BLOB_ORPHAN_GRACE_MINUTES: 'nunca' })).toThrow(/entero/);
  });
});
