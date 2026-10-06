import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, createReadStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalDiskStorage, StorageIntegrityError } from '@trust/platform-storage';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FfmpegFrameDecoder } from './ffmpeg';
import { FfprobeMediaInspector, type MediaInspector } from './ffprobe';
import { mediaFixtures } from './fixtures';
import { ConcurrencyLimiter } from './limiter';
import { checkMedia } from './pipeline';
import { type MediaRuntime, mediaRuntimeFromEnv } from './runtime';
import { LocalPathSource, ObjectStorageTempSource } from './source';
import { MediaAbortError } from './types';

let fx: (n: string) => string;
let work: string;
beforeAll(async () => {
  fx = mediaFixtures();
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-proc-'));
});
afterAll(async () => { await fs.rm(work, { recursive: true, force: true }); });

/**
 * Red de seguridad: todo pid lanzado por estos tests se registra y se mata al
 * final de cada test. Si una mutación desactiva el timeout, el proceso colgado
 * no sobrevive al test ni traba la corrida.
 */
const lanzados = new Set<number>();
afterEach(() => {
  for (const pid of lanzados) { try { process.kill(pid, 'SIGKILL'); } catch { /* ya terminó */ } }
  lanzados.clear();
});

/** Un FIFO sin escritor: ffprobe/ffmpeg se cuelgan DE VERDAD en open(). */
const fifo = () => { const p = path.join(work, `fifo-${randomUUID()}`); execFileSync('mkfifo', [p]); return p; };
/** Un pid reapeado ya no existe en /proc (un zombie sí existiría). */
const vivo = (pid: number | undefined) => pid !== undefined && existsSync(`/proc/${pid}`);

function runtime(over: Partial<MediaRuntime> = {}, concurrency = 4): MediaRuntime & { live: Set<number>; peak: () => number } {
  const live = new Set<number>();
  let peak = 0;
  return {
    ...mediaRuntimeFromEnv(),
    limiter: new ConcurrencyLimiter(concurrency),
    scratchDir: path.join(work, 'scratch'),
    observer: {
      onStart: (pid) => { if (pid) { live.add(pid); lanzados.add(pid); } peak = Math.max(peak, live.size); },
      onEnd: (pid) => { if (pid) live.delete(pid); },
    },
    ...over,
    live,
    peak: () => peak,
  };
}

describe('CRITERIO: timeout real mata el proceso y no deja zombie', () => {
  it('ffprobe colgado ⇒ ASSET_INSPECTION_TIMEOUT {stage: probe}, proceso terminado', async () => {
    const rt = runtime({ probeTimeoutMs: 400 });
    const t0 = Date.now();
    const r = await new FfprobeMediaInspector(rt).inspect(fifo());
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatchObject({ code: 'ASSET_INSPECTION_TIMEOUT', details: { stage: 'probe', timeoutMs: 400 } });
    expect(r.diagnostics?.pid).toBeGreaterThan(0);
    expect(vivo(r.diagnostics?.pid)).toBe(false);
    expect(rt.live.size).toBe(0);
  }, 8000);

  it('ffmpeg colgado ⇒ ASSET_INSPECTION_TIMEOUT {stage: decode}, proceso terminado', async () => {
    const rt = runtime({ decodeTimeoutMs: 400 });
    const r = await new FfmpegFrameDecoder(rt).decode(fifo(), { streamIndex: 0, durationMs: 2000 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatchObject({ code: 'ASSET_INSPECTION_TIMEOUT', details: { stage: 'decode' } });
    expect(vivo(r.diagnostics?.pid)).toBe(false);
  }, 8000);
});

describe('CRITERIO: cancelación del llamador', () => {
  it('abortar mata ffprobe en curso y lanza MediaAbortError', async () => {
    const rt = runtime({ probeTimeoutMs: 60_000 });
    const ac = new AbortController();
    let pid: number | undefined;
    rt.observer = { onStart: (p) => { pid = p; if (p) lanzados.add(p); setTimeout(() => ac.abort(), 150); } };
    await expect(new FfprobeMediaInspector(rt).inspect(fifo(), { signal: ac.signal })).rejects.toBeInstanceOf(MediaAbortError);
    expect(vivo(pid)).toBe(false);
  });
  it('señal ya abortada: no se lanza ningún proceso', async () => {
    const rt = runtime();
    const ac = new AbortController();
    ac.abort();
    await expect(new FfprobeMediaInspector(rt).inspect(fx('valid_horizontal_30.mp4'), { signal: ac.signal })).rejects.toBeInstanceOf(MediaAbortError);
    expect(rt.peak()).toBe(0);
  });
});

describe('CRITERIO: concurrencia limitada con procesos reales', () => {
  it('8 inspecciones con límite 2: nunca más de 2 procesos vivos; el resto en cola', async () => {
    const rt = runtime({}, 2);
    const insp = new FfprobeMediaInspector(rt);
    const todas = Array.from({ length: 8 }, () => insp.inspect(fx('valid_horizontal_30.mp4')));
    expect([rt.limiter.active, rt.limiter.queued]).toEqual([2, 6]);
    const rs = await Promise.all(todas);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(rt.peak()).toBe(2);
    expect(rt.live.size).toBe(0);
  });
  it('4 procesos colgados con límite 2: solo 2 existen; abortar libera todo', async () => {
    const rt = runtime({ probeTimeoutMs: 60_000 }, 2);
    const insp = new FfprobeMediaInspector(rt);
    const ac = new AbortController();
    const todas = Array.from({ length: 4 }, () => insp.inspect(fifo(), { signal: ac.signal }).catch((e) => e));
    await new Promise((r) => setTimeout(r, 400));
    expect(rt.live.size).toBe(2);
    expect(rt.limiter.queued).toBe(2);
    const pids = [...rt.live];
    ac.abort();
    const rs = await Promise.all(todas);
    expect(rs.every((e) => e instanceof MediaAbortError)).toBe(true);
    expect(rt.peak()).toBe(2); // los encolados nunca llegaron a lanzar
    for (const p of pids) expect(vivo(p)).toBe(false);
    expect([rt.limiter.active, rt.limiter.queued]).toEqual([0, 0]);
  });
});

describe('límites de salida', () => {
  it('salida de ffprobe por encima del límite: proceso terminado y ASSET_CORRUPT', async () => {
    const rt = runtime({ maxProbeOutputBytes: 100 });
    const r = await new FfprobeMediaInspector(rt).inspect(fx('valid_horizontal_30.mp4'));
    expect(r.ok ? null : r.error).toMatchObject({ code: 'ASSET_CORRUPT', details: { reason: 'probe_output_limit' } });
    expect(vivo(r.ok ? undefined : r.diagnostics?.pid)).toBe(false);
  });
  it('stderr queda acotado', async () => {
    const r = await checkMedia(runtime(), new LocalPathSource(fx('corrupt_frames.mp4')), 'horizontal');
    expect((r.ok ? '' : r.diagnostics?.stderrTail ?? '').length).toBeLessThanOrEqual(2048 + 20);
  });
});

describe('CRITERIO: nombres hostiles nunca llegan a un shell', () => {
  const hostiles = [
    '"; touch CANARY; ".mp4', '$(touch CANARY).mp4', '`touch CANARY`.mp4', "con espacios y 'comillas' \"dobles\".mp4",
    'ñandú-日本語-🎬.mp4', '-i.mp4', 'concat:x|y.mp4', 'file:otro.mp4', 'a;b&c>d<e.mp4', '..mp4', 'video.mp4.exe',
  ];
  it('el archivo se inspecciona igual y no se ejecuta nada', async () => {
    const dir = await fs.mkdtemp(path.join(work, 'host-'));
    const canary = path.join(dir, 'CANARY');
    const rt = runtime();
    for (const nombre of hostiles) {
      // 'CANARY' queda relativo: si un shell ejecutara el nombre, lo crearía en el
      // cwd del proceso (process.cwd(), que hereda ffprobe) o en `dir`.
      const p = path.join(dir, nombre);
      await fs.copyFile(fx('valid_horizontal_30.mp4'), p);
      const r = await checkMedia(rt, new LocalPathSource(p), 'horizontal');
      expect(r.ok, nombre).toBe(true);
    }
    expect(existsSync(canary)).toBe(false);
    expect(existsSync(path.join(process.cwd(), 'CANARY'))).toBe(false);
  });
});

describe('CRITERIO: temporal real de ObjectStorage → inspección (sin tocar storage final)', () => {
  const subir = async (storage: LocalDiskStorage, fixture: string) => {
    const id = randomUUID();
    await storage.putTemporary(id, createReadStream(fx(fixture)));
    return id;
  };

  it('temporal válido ⇒ OK; el temporal sigue ahí (B2 no promueve) y no queda copia en scratch', async () => {
    const storage = await LocalDiskStorage.open(path.join(work, `st-${randomUUID()}`));
    const rt = runtime();
    const id = await subir(storage, 'valid_towers_ab_25.mp4');
    const r = await checkMedia(rt, new ObjectStorageTempSource(storage, id, rt.scratchDir), 'towers_ab');
    expect(r.ok).toBe(true);
    expect(await storage.statTemporary(id)).not.toBeNull();
    expect(await fs.readdir(path.join(storage.root, 'sha256'))).toEqual([]);
    expect(await fs.readdir(rt.scratchDir)).toEqual([]);
  });

  it('temporal inválido ⇒ rechazo con causa exacta, scratch limpio', async () => {
    const storage = await LocalDiskStorage.open(path.join(work, `st-${randomUUID()}`));
    const rt = runtime();
    const id = await subir(storage, 'bad_codec_hevc.mp4');
    const r = await checkMedia(rt, new ObjectStorageTempSource(storage, id, rt.scratchDir), 'horizontal');
    expect(r.ok ? 'OK' : r.error.code).toBe('ASSET_BAD_CODEC');
    expect(await fs.readdir(rt.scratchDir)).toEqual([]);
  });

  it('el inspector recibe un path interno (UUID), nunca un nombre de archivo', async () => {
    const storage = await LocalDiskStorage.open(path.join(work, `st-${randomUUID()}`));
    const rt = runtime();
    const id = await subir(storage, 'valid_horizontal_30.mp4');
    const vistos: string[] = [];
    const espia: MediaInspector = { inspect: async (p, o) => { vistos.push(p); return new FfprobeMediaInspector(rt).inspect(p, o); } };
    await checkMedia(rt, new ObjectStorageTempSource(storage, id, rt.scratchDir), 'horizontal', { inspector: espia });
    expect(path.basename(vistos[0] ?? '')).toMatch(/^[0-9a-f-]{36}$/);
    expect(vistos[0]?.startsWith(await fs.realpath(rt.scratchDir))).toBe(true);
  });

  it('si el temporal fue alterado, la copia no coincide: StorageIntegrityError y scratch limpio', async () => {
    const storage = await LocalDiskStorage.open(path.join(work, `st-${randomUUID()}`));
    const rt = runtime();
    const id = await subir(storage, 'valid_horizontal_30.mp4');
    const data = path.join(storage.root, 'tmp', id, 'data');
    const fh = await fs.open(data, 'r+');
    await fh.write(Buffer.from('XXXX'), 0, 4, 5000); // mismo tamaño, otros bytes
    await fh.close();
    await expect(checkMedia(rt, new ObjectStorageTempSource(storage, id, rt.scratchDir), 'horizontal')).rejects.toBeInstanceOf(StorageIntegrityError);
    expect(await fs.readdir(rt.scratchDir)).toEqual([]);
  });

  it('el directorio de trabajo queda 0700 aunque existiera 0777', async () => {
    const rt = runtime({ scratchDir: path.join(work, `scr-${randomUUID()}`) });
    await fs.mkdir(rt.scratchDir, { mode: 0o777 });
    await fs.chmod(rt.scratchDir, 0o777);
    const storage = await LocalDiskStorage.open(path.join(work, `st-${randomUUID()}`));
    const id = await subir(storage, 'valid_horizontal_30.mp4');
    await checkMedia(rt, new ObjectStorageTempSource(storage, id, rt.scratchDir), 'horizontal');
    expect((await fs.stat(rt.scratchDir)).mode & 0o777).toBe(0o700);
  });
});

describe('configuración', () => {
  it('variables inválidas fallan al arrancar, no en el primer upload', () => {
    expect(() => mediaRuntimeFromEnv({ MEDIA_PROBE_TIMEOUT_MS: '0' })).toThrow(/MEDIA_PROBE_TIMEOUT_MS/);
    expect(() => mediaRuntimeFromEnv({ MEDIA_INSPECTION_CONCURRENCY: 'muchos' })).toThrow(/MEDIA_INSPECTION_CONCURRENCY/);
    expect(mediaRuntimeFromEnv({}).limiter.max).toBe(2);
  });
});
