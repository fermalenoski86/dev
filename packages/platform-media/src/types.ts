import type { AssetRejection } from '@trust/platform-contracts';
import type { Rational } from './rational';

/**
 * Metadata técnica normalizada — lo que B3 guarda en el Asset.
 * Sale de inspeccionar el archivo REAL: nunca del nombre, la extensión ni el
 * Content-Type del upload.
 */
export interface NormalizedMediaInfo {
  /** 'MP4' solo si el contenedor ES un MP4 (demuxer mov/mp4 + major_brand ISO BMFF). */
  container: string;
  /** Crudos de ffprobe, para diagnóstico. */
  formatName: string;
  majorBrand: string | null;
  /** MIME canónico decidido por la inspección: 'video/mp4' o null. Nunca el del cliente. */
  mimeType: 'video/mp4' | null;
  /** Pistas de video UTILIZABLES (excluye carátulas attached_pic). */
  videoStreamCount: number;
  audioStreamCount: number;
  attachedPicCount: number;
  /** De la primera pista de video utilizable; null si no hay. */
  videoStreamIndex: number | null;
  codec: string | null;
  profile: string | null;
  width: number | null;
  height: number | null;
  /** fps reducido (de r_frame_rate); null si es inválido o falta. */
  fps: Rational | null;
  fpsRaw: string | null;
  avgFpsRaw: string | null;
  fpsValue: number | null;
  durationMs: number | null;
  durationSource: 'stream' | 'format' | null;
  pixelFormat: string | null;
}

/**
 * Diagnóstico INTERNO, solo para logs: stderr truncado y sin paths, pid,
 * duración del proceso. Nunca se devuelve al cliente.
 */
export interface MediaDiagnostics {
  stage: 'probe' | 'decode' | 'materialize';
  pid?: number;
  processMs?: number;
  stderrTail?: string;
}

export type MediaResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: AssetRejection; diagnostics?: MediaDiagnostics };

/** Resultado del pipeline completo de B2 (preferencia del brief, punto 15). */
export type MediaValidationResult = MediaResult<{ media: NormalizedMediaInfo; frameBytes: number }>;

export class MediaAbortError extends Error {
  readonly code = 'MEDIA_ABORTED' as const;
  constructor() {
    super('inspección cancelada por el llamador');
    this.name = 'AbortError';
  }
}

/** Falla de infraestructura (binario ausente, error de spawn): excepción, no rechazo. */
export class MediaInfrastructureError extends Error {
  readonly code = 'MEDIA_INFRASTRUCTURE' as const;
}

export class InvalidSurfaceTypeError extends Error {
  readonly code = 'INVALID_SURFACE_TYPE' as const;
}
