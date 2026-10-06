import type { SurfaceFormatId } from '@trust/platform-contracts';
import { FfmpegFrameDecoder, type FrameDecoder } from './ffmpeg';
import { FfprobeMediaInspector, type MediaInspector } from './ffprobe';
import type { MediaRuntime } from './runtime';
import type { MediaSource } from './source';
import type { MediaValidationResult } from './types';
import { type SurfaceFormats, parseSurfaceType, validateMedia } from './validator';

/**
 * Pipeline técnico de B2:
 *   fuente → materializar → vacío? → ffprobe → normalizar → validar contra
 *   EL_TRUST → decodificar un frame → resultado.
 *
 * Rechazos esperables (resolución, codec, corrupto, timeout...) vuelven como
 * { ok:false, error }. Excepciones solo para lo inesperado: binario ausente,
 * integridad del storage, cancelación del llamador, surfaceType inválido.
 *
 * NO crea StoredObject, no promueve el temporal, no toca el Asset: eso es B3.
 */
export interface MediaCheckOptions {
  formats?: SurfaceFormats;
  requiredDurationMs?: number;
  signal?: AbortSignal;
  inspector?: MediaInspector;
  decoder?: FrameDecoder;
}

export async function checkMedia(rt: MediaRuntime, source: MediaSource, surfaceType: string, opts: MediaCheckOptions = {}): Promise<MediaValidationResult> {
  const surface: SurfaceFormatId = parseSurfaceType(surfaceType, opts.formats);
  const inspector = opts.inspector ?? new FfprobeMediaInspector(rt);
  const decoder = opts.decoder ?? new FfmpegFrameDecoder(rt);

  return source.materialize(async (m) => {
    if (m.sizeBytes === 0) {
      return { ok: false, error: { code: 'ASSET_EMPTY', message: 'El archivo está vacío.', details: { sizeBytes: 0 } } };
    }
    const probe = await inspector.inspect(m.path, { signal: opts.signal });
    if (!probe.ok) return probe;
    const v = validateMedia(probe.media, surface, { formats: opts.formats, requiredDurationMs: opts.requiredDurationMs });
    if (!v.ok) return v;
    const frame = await decoder.decode(m.path, { streamIndex: probe.media.videoStreamIndex ?? 0, durationMs: probe.media.durationMs ?? 0, signal: opts.signal });
    if (!frame.ok) return frame;
    return { ok: true, media: probe.media, frameBytes: frame.frameBytes };
  });
}
