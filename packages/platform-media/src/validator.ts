import { EL_TRUST } from '@trust/show-engine';
import { type AssetRejection, type SurfaceFormat, type SurfaceFormatId, deriveSurfaceFormats } from '@trust/platform-contracts';
import { type Rational, rationalToString, sameRational } from './rational';
import { InvalidSurfaceTypeError, type MediaResult, type NormalizedMediaInfo } from './types';

/**
 * MediaValidator — M3A.1 B2. Función PURA: sin procesos, sin disco.
 *
 * Las RESOLUCIONES no están acá: vienen de deriveSurfaceFormats(edificio)
 * (autoridad EL_TRUST). Lo que sí es política de este módulo:
 *   contenedor MP4 · codec H.264 · fps exactamente 25/1 o 30/1.
 *
 * Orden de chequeo (determinista; se reporta el PRIMER fallo):
 *   1 CONTAINER · 2 NO_VIDEO · 3 MULTIPLE_VIDEO_STREAMS · 4 CODEC
 *   5 RESOLUTION · 6 FPS · 7 duración (CORRUPT si no hay; TOO_SHORT si no alcanza)
 */
export const ACCEPTED_CONTAINER = 'MP4' as const;
export const ACCEPTED_CODEC = 'H264' as const;
export const ACCEPTED_FPS: readonly Rational[] = [
  { numerator: 25, denominator: 1 },
  { numerator: 30, denominator: 1 },
];

export type SurfaceFormats = Readonly<Record<SurfaceFormatId, SurfaceFormat>>;

export function parseSurfaceType(raw: unknown, formats: SurfaceFormats = deriveSurfaceFormats(EL_TRUST)): SurfaceFormatId {
  if (typeof raw !== 'string' || !Object.prototype.hasOwnProperty.call(formats, raw)) {
    throw new InvalidSurfaceTypeError(`surfaceType inválido; válidos: ${Object.keys(formats).join(', ')}`);
  }
  return raw as SurfaceFormatId;
}

const rechazo = (code: AssetRejection['code'], message: string, details?: Record<string, unknown>): MediaResult<never> => ({
  ok: false,
  error: { code, message, ...(details ? { details } : {}) },
});

export function validateMedia(
  media: NormalizedMediaInfo,
  surfaceType: SurfaceFormatId,
  options: { formats?: SurfaceFormats; requiredDurationMs?: number } = {},
): MediaResult<{ media: NormalizedMediaInfo }> {
  const formats = options.formats ?? deriveSurfaceFormats(EL_TRUST);
  const fmt = formats[parseSurfaceType(surfaceType, formats)];

  if (media.container !== ACCEPTED_CONTAINER) {
    return rechazo('ASSET_BAD_CONTAINER', 'El contenedor no es MP4.', {
      expected: ACCEPTED_CONTAINER,
      actual: { formatName: media.formatName, majorBrand: media.majorBrand },
    });
  }
  if (media.videoStreamCount === 0) {
    return rechazo('ASSET_NO_VIDEO', 'El archivo no tiene una pista de video utilizable.', { videoStreamCount: 0 });
  }
  if (media.videoStreamCount > 1) {
    return rechazo('ASSET_MULTIPLE_VIDEO_STREAMS', 'El archivo tiene más de una pista de video.', { videoStreamCount: media.videoStreamCount });
  }
  if (media.codec !== ACCEPTED_CODEC) {
    return rechazo('ASSET_BAD_CODEC', 'El codec de video no es H.264.', { expected: ACCEPTED_CODEC, actual: media.codec });
  }
  if (media.width !== fmt.width || media.height !== fmt.height) {
    return rechazo('ASSET_BAD_RESOLUTION', 'La resolución no es la de la superficie.', {
      expected: { width: fmt.width, height: fmt.height },
      actual: { width: media.width, height: media.height },
      surfaceType,
    });
  }
  const fps = media.fps;
  if (!fps || !ACCEPTED_FPS.some((a) => a.numerator === fps.numerator && a.denominator === fps.denominator)) {
    return rechazo('ASSET_BAD_FPS', 'El framerate no es exactamente 25 o 30 fps.', {
      accepted: ACCEPTED_FPS.map(rationalToString),
      actual: fps ? rationalToString(fps) : media.fpsRaw,
      ...(fps ? {} : { reason: 'invalid_framerate' }),
    });
  }
  if (media.durationMs === null || media.durationMs <= 0) {
    return rechazo('ASSET_CORRUPT', 'No se pudo determinar la duración del video.', { stage: 'probe', reason: 'no_duration' });
  }
  const req = options.requiredDurationMs;
  if (req !== undefined && media.durationMs < req) {
    return rechazo('ASSET_TOO_SHORT', 'El video es más corto que lo requerido.', { requiredDurationMs: req, actualDurationMs: media.durationMs });
  }
  return { ok: true, media };
}

export { sameRational };
