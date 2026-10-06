import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deriveSurfaceFormats } from '@trust/platform-contracts';
import { EL_TRUST } from '@trust/show-engine';
import { describe, expect, it } from 'vitest';
import { MP4_BRANDS, normalizeProbe } from './ffprobe';
import type { NormalizedMediaInfo } from './types';
import { parseSurfaceType, validateMedia } from './validator';

/** Metadata válida para `surface`, armada desde la AUTORIDAD (no con números copiados). */
function valido(surface: 'towers_ab' | 'horizontal' = 'horizontal', over: Partial<NormalizedMediaInfo> = {}): NormalizedMediaInfo {
  const f = deriveSurfaceFormats(EL_TRUST)[surface];
  return {
    container: 'MP4', formatName: 'mov,mp4,m4a,3gp,3g2,mj2', majorBrand: 'isom', mimeType: 'video/mp4',
    videoStreamCount: 1, audioStreamCount: 0, attachedPicCount: 0, videoStreamIndex: 0,
    codec: 'H264', profile: 'High', width: f.width, height: f.height,
    fps: { numerator: 25, denominator: 1 }, fpsRaw: '25/1', avgFpsRaw: '25/1', fpsValue: 25,
    durationMs: 2000, durationSource: 'stream', pixelFormat: 'yuv420p', ...over,
  };
}
const codigo = (r: ReturnType<typeof validateMedia>) => (r.ok ? 'OK' : r.error.code);

describe('CRITERIO: validator — matriz de rechazos', () => {
  it('válido ⇒ OK (towers_ab y horizontal)', () => {
    expect(codigo(validateMedia(valido('towers_ab'), 'towers_ab'))).toBe('OK');
    expect(codigo(validateMedia(valido('horizontal', { fps: { numerator: 30, denominator: 1 } }), 'horizontal'))).toBe('OK');
  });
  it('contenedor', () => {
    expect(codigo(validateMedia(valido('horizontal', { container: 'matroska,webm' }), 'horizontal'))).toBe('ASSET_BAD_CONTAINER');
  });
  it('pistas: 0 ⇒ NO_VIDEO, 2 ⇒ MULTIPLE', () => {
    expect(codigo(validateMedia(valido('horizontal', { videoStreamCount: 0 }), 'horizontal'))).toBe('ASSET_NO_VIDEO');
    expect(codigo(validateMedia(valido('horizontal', { videoStreamCount: 2 }), 'horizontal'))).toBe('ASSET_MULTIPLE_VIDEO_STREAMS');
  });
  it('codec: HEVC, MPEG4 y null ⇒ BAD_CODEC', () => {
    for (const c of ['HEVC', 'MPEG4', null]) expect(codigo(validateMedia(valido('horizontal', { codec: c }), 'horizontal'))).toBe('ASSET_BAD_CODEC');
  });
  it('resolución: detalle con expected / actual / surfaceType', () => {
    const r = validateMedia(valido('horizontal', { height: 1080 }), 'horizontal');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const f = deriveSurfaceFormats(EL_TRUST).horizontal;
      expect(r.error.code).toBe('ASSET_BAD_RESOLUTION');
      expect(r.error.details).toEqual({ expected: { width: f.width, height: f.height }, actual: { width: f.width, height: 1080 }, surfaceType: 'horizontal' });
    }
    // un solo eje distinto alcanza para rechazar
    expect(codigo(validateMedia(valido('horizontal', { width: 1919 }), 'horizontal'))).toBe('ASSET_BAD_RESOLUTION');
  });
  it('CRITERIO: fps — solo 25/1 y 30/1 exactos', () => {
    const fps = (n: number, d: number) => validateMedia(valido('horizontal', { fps: { numerator: n, denominator: d } }), 'horizontal');
    expect(codigo(fps(25, 1))).toBe('OK');
    expect(codigo(fps(30, 1))).toBe('OK');
    for (const [n, d] of [[30000, 1001], [24000, 1001], [24, 1], [50, 1], [60, 1], [2997, 100]]) expect(codigo(fps(n as number, d as number)), `${n}/${d}`).toBe('ASSET_BAD_FPS');
    const inv = validateMedia(valido('horizontal', { fps: null, fpsRaw: '0/0' }), 'horizontal');
    expect(inv.ok ? null : inv.error.details).toMatchObject({ actual: '0/0', reason: 'invalid_framerate' });
  });
  it('duración: TOO_SHORT con requiredDurationMs; sin requerido alcanza con > 0; sin duración ⇒ CORRUPT', () => {
    expect(codigo(validateMedia(valido('horizontal', { durationMs: 400 }), 'horizontal', { requiredDurationMs: 1000 }))).toBe('ASSET_TOO_SHORT');
    expect(codigo(validateMedia(valido('horizontal', { durationMs: 1000 }), 'horizontal', { requiredDurationMs: 1000 }))).toBe('OK');
    expect(codigo(validateMedia(valido('horizontal', { durationMs: 400 }), 'horizontal'))).toBe('OK');
    expect(codigo(validateMedia(valido('horizontal', { durationMs: null }), 'horizontal'))).toBe('ASSET_CORRUPT');
  });
  it('surfaceType desconocido ⇒ error de entrada, no rechazo de media', () => {
    expect(() => parseSurfaceType('screen_c')).toThrow(/surfaceType inválido/);
    expect(() => parseSurfaceType('__proto__')).toThrow(/surfaceType inválido/);
    expect(parseSurfaceType('screen_a')).toBe('screen_a');
  });
});

describe('CRITERIO: la resolución sale de EL_TRUST, no de constantes copiadas', () => {
  it('si el modelo dice otra resolución, el validator espera la nueva', () => {
    const otro = structuredClone(EL_TRUST);
    const h = otro.screens.find((s) => s.id === 'horizontal');
    if (!h) throw new Error('modelo sin horizontal');
    h.pixelWidth = 2048;
    h.pixelHeight = 440;
    const formats = deriveSurfaceFormats(otro);
    const real = deriveSurfaceFormats(EL_TRUST).horizontal;
    // el video que hoy es válido, con el modelo nuevo ya no lo es…
    const r = validateMedia(valido('horizontal'), 'horizontal', { formats });
    expect(r.ok ? null : r.error.details).toEqual({ expected: { width: 2048, height: 440 }, actual: { width: real.width, height: real.height }, surfaceType: 'horizontal' });
    // …y uno con la resolución nueva sí
    expect(codigo(validateMedia(valido('horizontal', { width: 2048, height: 440 }), 'horizontal', { formats }))).toBe('OK');
  });
  it('el lienzo A+B sigue a las torres: cambiar B cambia towers_ab', () => {
    const otro = structuredClone(EL_TRUST);
    const b = otro.screens.find((s) => s.id === 'screen_b');
    if (!b) throw new Error('modelo sin screen_b');
    b.pixelWidth += 160;
    const formats = deriveSurfaceFormats(otro);
    expect(codigo(validateMedia(valido('towers_ab'), 'towers_ab', { formats }))).toBe('ASSET_BAD_RESOLUTION');
  });
  it('el validator no contiene ninguna dimensión del edificio escrita a mano', () => {
    const src = readFileSync(resolve(__dirname, 'validator.ts'), 'utf-8');
    expect(src).not.toMatch(/\b(2592|1152|1440|1920|576|412)\b/);
  });
});

describe('normalizeProbe (JSON de ffprobe → metadata)', () => {
  const stream = { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 412, r_frame_rate: '30/1', avg_frame_rate: '30/1', duration: '2.000000', pix_fmt: 'yuv420p' };
  it('MOV renombrado: mismo format_name que MP4, pero brand qt ⇒ no es MP4', () => {
    const mov = normalizeProbe({ streams: [stream], format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', tags: { major_brand: 'qt  ' } } });
    expect(mov.container).not.toBe('MP4');
    expect(mov.mimeType).toBeNull();
    const mp4 = normalizeProbe({ streams: [stream], format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', tags: { major_brand: 'isom' } } });
    expect(mp4.container).toBe('MP4');
    expect(mp4.mimeType).toBe('video/mp4');
    // sin brand, tampoco
    expect(normalizeProbe({ streams: [stream], format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' } }).container).not.toBe('MP4');
    expect(MP4_BRANDS).not.toContain('qt');
  });
  it('la carátula (attached_pic) no cuenta como pista de video', () => {
    const m = normalizeProbe({ streams: [stream, { index: 1, codec_type: 'video', codec_name: 'png', disposition: { attached_pic: 1 } }], format: { format_name: 'mov,mp4', tags: { major_brand: 'isom' } } });
    expect(m.videoStreamCount).toBe(1);
    expect(m.attachedPicCount).toBe(1);
  });
  it('duración: manda la pista de video; si falta, la del contenedor', () => {
    expect(normalizeProbe({ streams: [stream], format: { duration: '9.0' } })).toMatchObject({ durationMs: 2000, durationSource: 'stream' });
    expect(normalizeProbe({ streams: [{ ...stream, duration: undefined }], format: { duration: '9.0' } })).toMatchObject({ durationMs: 9000, durationSource: 'format' });
  });
  it('codec normalizado', () => {
    expect(normalizeProbe({ streams: [{ ...stream, codec_name: 'hevc' }] }).codec).toBe('HEVC');
    expect(normalizeProbe({ streams: [stream] }).codec).toBe('H264');
  });
});
