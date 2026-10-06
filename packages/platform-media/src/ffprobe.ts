import { secondsToMs, parseRational, rationalValue } from './rational';
import { runProcess, sanitizeStderr } from './process';
import type { MediaRuntime } from './runtime';
import { MediaAbortError, type MediaDiagnostics, type MediaResult, type NormalizedMediaInfo } from './types';

/**
 * FfprobeMediaInspector — M3A.1 B2, puntos 1–10.
 *
 * Recibe un path INTERNO (lo produce un MediaSource), nunca el nombre original.
 * Se le antepone `file:` y se restringe a ese protocolo: un path no puede
 * interpretarse como `concat:`, `http:` u otro protocolo de ffmpeg.
 */
export interface MediaInspector {
  inspect(inputPath: string, opts?: { signal?: AbortSignal }): Promise<MediaResult<{ media: NormalizedMediaInfo }>>;
}

/**
 * MP4 de verdad: el demuxer mov/mp4 + un major_brand ISO BMFF. QuickTime
 * ('qt  ') usa el MISMO demuxer y format_name: sin el brand, un .mov
 * renombrado pasaría como MP4. Brand ausente o fuera de la lista: no es MP4.
 */
export const MP4_BRANDS: readonly string[] = ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V', 'M4VP', 'dash', 'msnv'];

const CODECS: Record<string, string> = { h264: 'H264', hevc: 'HEVC', h265: 'HEVC', mpeg4: 'MPEG4', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', prores: 'PRORES', png: 'PNG', mjpeg: 'MJPEG' };
export const normalizeCodec = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.length > 0 ? (CODECS[raw.toLowerCase()] ?? raw.toUpperCase()) : null;

interface ProbeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  pix_fmt?: string;
  disposition?: { attached_pic?: number; timed_thumbnails?: number };
}
interface ProbeJson {
  streams?: ProbeStream[];
  format?: { format_name?: string; duration?: string; tags?: Record<string, string> };
}

/** ffprobe JSON → metadata normalizada. Pura: se testea sin procesos. */
export function normalizeProbe(j: ProbeJson): NormalizedMediaInfo {
  const streams = Array.isArray(j.streams) ? j.streams : [];
  const esCaratula = (s: ProbeStream) => s.disposition?.attached_pic === 1 || s.disposition?.timed_thumbnails === 1;
  const videos = streams.filter((s) => s.codec_type === 'video' && !esCaratula(s));
  const v = videos[0];
  const formatName = j.format?.format_name ?? '';
  const brand = j.format?.tags?.major_brand?.trim() ?? null;
  const esMp4 = formatName.split(',').includes('mp4') && brand !== null && MP4_BRANDS.includes(brand);
  const fps = parseRational(v?.r_frame_rate);
  const durStream = secondsToMs(v?.duration);
  const durFormat = secondsToMs(j.format?.duration);
  // Regla: la duración de la pista de video manda; si falta, la del contenedor.
  const durationMs = durStream && durStream > 0 ? durStream : durFormat && durFormat > 0 ? durFormat : null;
  return {
    container: esMp4 ? 'MP4' : formatName || 'unknown',
    formatName,
    majorBrand: brand,
    mimeType: esMp4 ? 'video/mp4' : null,
    videoStreamCount: videos.length,
    audioStreamCount: streams.filter((s) => s.codec_type === 'audio').length,
    attachedPicCount: streams.filter((s) => s.codec_type === 'video' && esCaratula(s)).length,
    videoStreamIndex: typeof v?.index === 'number' ? v.index : null,
    codec: normalizeCodec(v?.codec_name),
    profile: v?.profile ?? null,
    width: typeof v?.width === 'number' ? v.width : null,
    height: typeof v?.height === 'number' ? v.height : null,
    fps,
    fpsRaw: v?.r_frame_rate ?? null,
    avgFpsRaw: v?.avg_frame_rate ?? null,
    fpsValue: fps ? rationalValue(fps) : null,
    durationMs,
    durationSource: durationMs === null ? null : durationMs === durStream ? 'stream' : 'format',
    pixelFormat: v?.pix_fmt ?? null,
  };
}

export class FfprobeMediaInspector implements MediaInspector {
  constructor(private readonly rt: MediaRuntime) {}

  async inspect(inputPath: string, opts: { signal?: AbortSignal } = {}): Promise<MediaResult<{ media: NormalizedMediaInfo }>> {
    const args = ['-hide_banner', '-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_format', '-show_streams', '-i', `file:${inputPath}`];
    const r = await this.rt.limiter.run(
      () => runProcess(this.rt.ffprobePath, args, { timeoutMs: this.rt.probeTimeoutMs, maxStdoutBytes: this.rt.maxProbeOutputBytes, signal: opts.signal, observer: this.rt.observer }),
      opts.signal,
    );
    const diag: MediaDiagnostics = { stage: 'probe', pid: r.pid, processMs: r.durationMs, stderrTail: sanitizeStderr(r.stderrTail, inputPath) };
    switch (r.outcome.kind) {
      case 'aborted':
        throw new MediaAbortError();
      case 'timeout':
        return { ok: false, error: { code: 'ASSET_INSPECTION_TIMEOUT', message: 'La inspección superó el tiempo límite.', details: { stage: 'probe', timeoutMs: this.rt.probeTimeoutMs } }, diagnostics: diag };
      case 'stdout_limit':
        return { ok: false, error: { code: 'ASSET_CORRUPT', message: 'El archivo no se pudo leer como video.', details: { stage: 'probe', reason: 'probe_output_limit' } }, diagnostics: diag };
      case 'exit':
        break;
    }
    if (r.outcome.code !== 0) {
      return { ok: false, error: { code: 'ASSET_CORRUPT', message: 'El archivo no se pudo leer como video.', details: { stage: 'probe', reason: 'unreadable' } }, diagnostics: diag };
    }
    let json: ProbeJson;
    try {
      json = JSON.parse(r.stdout.toString('utf-8')) as ProbeJson;
    } catch {
      return { ok: false, error: { code: 'ASSET_CORRUPT', message: 'El archivo no se pudo leer como video.', details: { stage: 'probe', reason: 'unparseable_probe_output' } }, diagnostics: diag };
    }
    return { ok: true, media: normalizeProbe(json) };
  }
}
