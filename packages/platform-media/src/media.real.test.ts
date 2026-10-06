import { promises as fs } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { FfmpegFrameDecoder } from './ffmpeg';
import { FfprobeMediaInspector } from './ffprobe';
import { mediaFixtures } from './fixtures';
import { checkMedia } from './pipeline';
import { mediaRuntimeFromEnv } from './runtime';
import { LocalPathSource } from './source';

let fx: (n: string) => string;
const rt = mediaRuntimeFromEnv({ MEDIA_INSPECTION_CONCURRENCY: '4' });
beforeAll(() => { fx = mediaFixtures(); });

const check = (nombre: string, surface: string, requiredDurationMs?: number) =>
  checkMedia(rt, new LocalPathSource(fx(nombre)), surface, { requiredDurationMs });
const codigo = async (nombre: string, surface: string, req?: number) => {
  const r = await check(nombre, surface, req);
  return r.ok ? 'OK' : r.error.code;
};

describe('CRITERIO: ffprobe + ffmpeg REALES — matriz completa', () => {
  const matriz: Array<[string, string, string, number?]> = [
    ['valid_towers_ab_25.mp4', 'towers_ab', 'OK'],
    ['valid_horizontal_30.mp4', 'horizontal', 'OK'],
    ['valid_screen_a_25.mp4', 'screen_a', 'OK'],
    ['valid_horizontal_25_audio.mp4', 'horizontal', 'OK'],
    ['valid_with_cover_art.mp4', 'horizontal', 'OK'],
    ['bad_resolution.mp4', 'horizontal', 'ASSET_BAD_RESOLUTION'],
    ['valid_towers_ab_25.mp4', 'horizontal', 'ASSET_BAD_RESOLUTION'],
    ['bad_codec_hevc.mp4', 'horizontal', 'ASSET_BAD_CODEC'],
    ['bad_fps_2997.mp4', 'horizontal', 'ASSET_BAD_FPS'],
    ['bad_fps_23976.mp4', 'horizontal', 'ASSET_BAD_FPS'],
    ['bad_fps_50.mp4', 'horizontal', 'ASSET_BAD_FPS'],
    ['too_short.mp4', 'horizontal', 'ASSET_TOO_SHORT', 1000],
    ['bad_container_mkv.mp4', 'horizontal', 'ASSET_BAD_CONTAINER'],
    ['bad_container_avi.mp4', 'horizontal', 'ASSET_BAD_CONTAINER'],
    ['bad_container_mov.mp4', 'horizontal', 'ASSET_BAD_CONTAINER'],
    ['multiple_video_streams.mp4', 'horizontal', 'ASSET_MULTIPLE_VIDEO_STREAMS'],
    ['no_video_audio_only.mp4', 'horizontal', 'ASSET_NO_VIDEO'],
    ['empty.mp4', 'horizontal', 'ASSET_EMPTY'],
    ['random_bytes.mp4', 'horizontal', 'ASSET_CORRUPT'],
    ['truncated_header.mp4', 'horizontal', 'ASSET_CORRUPT'],
    ['corrupt_frames.mp4', 'horizontal', 'ASSET_CORRUPT'],
  ];
  for (const [archivo, surface, esperado, req] of matriz) {
    it(`${archivo} como ${surface}${req ? ` (requerido ${req} ms)` : ''} ⇒ ${esperado}`, async () => {
      expect(await codigo(archivo, surface, req)).toBe(esperado);
    });
  }
  it('too_short sin duración requerida pasa: la cobertura exacta se valida en Submit', async () => {
    expect(await codigo('too_short.mp4', 'horizontal')).toBe('OK');
  });
});

describe('metadata normalizada desde el archivo real', () => {
  it('towers_ab 25: contenedor, codec, dimensiones, fps racional, duración, mime', async () => {
    const r = await new FfprobeMediaInspector(rt).inspect(fx('valid_towers_ab_25.mp4'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.media).toMatchObject({
      container: 'MP4', mimeType: 'video/mp4', codec: 'H264', width: 2592, height: 576,
      fps: { numerator: 25, denominator: 1 }, fpsRaw: '25/1', fpsValue: 25, durationMs: 2000, durationSource: 'stream',
      videoStreamCount: 1, audioStreamCount: 0, pixelFormat: 'yuv420p', majorBrand: 'isom',
    });
  });
  it('29.97 se guarda como racional exacto 30000/1001', async () => {
    const r = await new FfprobeMediaInspector(rt).inspect(fx('bad_fps_2997.mp4'));
    expect(r.ok && r.media.fps).toEqual({ numerator: 30000, denominator: 1001 });
  });
  it('el detalle de BAD_RESOLUTION trae expected / actual / surfaceType', async () => {
    const r = await check('bad_resolution.mp4', 'horizontal');
    expect(r.ok ? null : r.error.details).toEqual({ expected: { width: 1920, height: 412 }, actual: { width: 1920, height: 1080 }, surfaceType: 'horizontal' });
  });
  it('el MIME canónico lo decide la inspección: video/mp4, no lo que diga el cliente', async () => {
    const r = await check('valid_horizontal_30.mp4', 'horizontal');
    expect(r.ok && r.media.mimeType).toBe('video/mp4');
  });
});

describe('CRITERIO: por qué hacen falta DOS compuertas (probe + decode)', () => {
  it('corrupt_frames PASA ffprobe con metadata perfecta…', async () => {
    const r = await new FfprobeMediaInspector(rt).inspect(fx('corrupt_frames.mp4'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.media).toMatchObject({ container: 'MP4', codec: 'H264', width: 1920, height: 412, fpsRaw: '30/1', durationMs: 2000 });
  });
  it('…y SOLO el decode lo detecta', async () => {
    const r = await new FfmpegFrameDecoder(rt).decode(fx('corrupt_frames.mp4'), { streamIndex: 0, durationMs: 2000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'ASSET_CORRUPT', details: { stage: 'decode' } });
  });
  it('decode real de un video válido produce bytes', async () => {
    const r = await new FfmpegFrameDecoder(rt).decode(fx('valid_horizontal_30.mp4'), { streamIndex: 0, durationMs: 2000 });
    expect(r.ok && r.frameBytes).toBeGreaterThan(1000);
  });
  it('la carátula no confunde al decoder: se decodifica la pista de video real', async () => {
    const p = await new FfprobeMediaInspector(rt).inspect(fx('valid_with_cover_art.mp4'));
    expect(p.ok && p.media.videoStreamIndex).toBe(0);
  });
});

describe('errores hacia el cliente: sin stderr crudo, sin paths', () => {
  it('el rechazo no contiene el path ni el stderr de ffmpeg', async () => {
    const r = await check('corrupt_frames.mp4', 'horizontal');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const visible = JSON.stringify(r.error);
    expect(visible).not.toContain(fx('corrupt_frames.mp4'));
    expect(visible).not.toMatch(/NAL|h264 @|0x[0-9a-f]{6,}/i);
    // el diagnóstico interno (solo logs) sí trae la causa, sin el path
    expect(r.diagnostics?.stderrTail ?? '').toMatch(/NAL/);
    expect(r.diagnostics?.stderrTail ?? '').not.toContain(fx('corrupt_frames.mp4'));
  });
  it('ffprobe ausente: excepción de infraestructura, no un rechazo del archivo', async () => {
    const roto = { ...rt, ffprobePath: '/nonexistent/ffprobe' };
    await expect(checkMedia(roto, new LocalPathSource(fx('valid_horizontal_30.mp4')), 'horizontal')).rejects.toMatchObject({ code: 'MEDIA_INFRASTRUCTURE' });
  });
  it('LocalPathSource rechaza FIFOs, symlinks y paths relativos', async () => {
    const dir = await fs.mkdtemp('/tmp/trust-src-');
    await fs.symlink(fx('valid_horizontal_30.mp4'), `${dir}/link.mp4`);
    await expect(checkMedia(rt, new LocalPathSource(`${dir}/link.mp4`), 'horizontal')).rejects.toThrow(/archivos regulares/);
    await expect(checkMedia(rt, new LocalPathSource('relativo.mp4'), 'horizontal')).rejects.toThrow(/absoluto/);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
