import { EL_TRUST } from '@trust/show-engine';
import { type AssetRejection, type AssetRejectionCode, type SurfaceFormatId, deriveSurfaceFormats } from '@trust/platform-contracts';
import { parseRational } from './rational';
import { ACCEPTED_FPS, type SurfaceFormats, parseSurfaceType } from './validator';

/**
 * Remediación de rechazos — BL-03 (acordado en el debate de B2, ajustes de
 * ChatGPT): cómo arreglar el archivo, derivado de la MISMA autoridad que valida.
 *
 *   · `summary`: texto corto para la agencia.
 *   · `ffmpeg.args`: argumentos ESTRUCTURADOS (un arreglo, no una línea de
 *     shell). Los archivos van como los marcadores `{input}` y `{output}`: el
 *     servidor nunca interpola nombres de archivo y nunca ejecuta nada.
 *   · `displayCommand`: la misma receta como texto, con los marcadores, solo
 *     para mostrar.
 *
 * La receta es UNA normalización completa (pista de video sin carátulas,
 * resolución exacta de la superficie, fps aceptado, H.264 yuv420p, MP4): el
 * resultado tiene que pasar checkMedia (test real con ffmpeg).
 */
export const INPUT_PLACEHOLDER = '{input}';
export const OUTPUT_PLACEHOLDER = '{output}';

export interface Remediation {
  summary: string;
  ffmpeg?: { args: string[]; displayCommand: string };
}

const TRANSCODABLE: ReadonlySet<AssetRejectionCode> = new Set([
  'ASSET_BAD_CONTAINER', 'ASSET_BAD_CODEC', 'ASSET_BAD_RESOLUTION', 'ASSET_BAD_FPS', 'ASSET_MULTIPLE_VIDEO_STREAMS',
]);

/** fps aceptado más cercano al detectado; sin dato, el primero aceptado. */
export function targetFps(actual: unknown): number {
  const aceptados = ACCEPTED_FPS.map((r) => r.numerator / r.denominator);
  const r = typeof actual === 'string' ? parseRational(actual) : null;
  const v = r ? r.numerator / r.denominator : null;
  if (v === null || !Number.isFinite(v) || v <= 0) return aceptados[0] as number;
  return aceptados.reduce((mejor, a) => (Math.abs(a - v) < Math.abs(mejor - v) ? a : mejor));
}

export function normalizationArgs(width: number, height: number, fps: number): string[] {
  return [
    '-i', INPUT_PLACEHOLDER,
    '-map', '0:V:0', // la primera pista de video que NO es carátula
    '-vf', `scale=${width}:${height}:flags=lanczos,setsar=1,fps=${fps}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-an', '-sn', '-dn',
    '-movflags', '+faststart',
    '-f', 'mp4',
    OUTPUT_PLACEHOLDER,
  ];
}

const display = (args: string[]) => ['ffmpeg', ...args.map((a) => (/^[\w{}:=,.+/-]+$/.test(a) ? a : `'${a}'`))].join(' ');

const TEXTO: Record<AssetRejectionCode, (f: { width: number; height: number }, fps: number) => string> = {
  ASSET_TOO_LARGE: () => 'El archivo supera el tamaño máximo. Exportá de nuevo con más compresión (por ejemplo, CRF 20–23 en H.264) o acortá el clip.',
  ASSET_EMPTY: () => 'El archivo llegó vacío. Volvé a exportarlo y subilo de nuevo.',
  ASSET_BAD_CONTAINER: (f, fps) => `El contenedor tiene que ser MP4. Exportá como MP4 H.264 ${f.width}×${f.height} a ${fps} fps.`,
  ASSET_BAD_CODEC: (f, fps) => `El video tiene que estar en H.264. Exportá como MP4 H.264 ${f.width}×${f.height} a ${fps} fps.`,
  ASSET_BAD_RESOLUTION: (f) =>
    `La superficie es de ${f.width}×${f.height} píxeles exactos. Lo ideal es exportar a esa resolución desde el original; el escalado automático puede deformar la imagen si el aspecto no coincide.`,
  ASSET_BAD_FPS: (_f, fps) => `El framerate tiene que ser exactamente 25 o 30 fps (no 29,97 ni 23,976). Exportá a ${fps} fps.`,
  ASSET_TOO_SHORT: () => 'El video es más corto que la duración requerida. Exportá un clip que cubra toda la duración.',
  ASSET_NO_VIDEO: () => 'El archivo no tiene pista de video. Exportá el video, no solo el audio.',
  ASSET_MULTIPLE_VIDEO_STREAMS: (f, fps) => `El archivo tiene más de una pista de video. Exportá una sola pista H.264 ${f.width}×${f.height} a ${fps} fps.`,
  ASSET_CORRUPT: () => 'El archivo está dañado o incompleto. Volvé a exportarlo desde el original y verificá que se reproduzca entero.',
  ASSET_INSPECTION_TIMEOUT: () => 'La inspección tardó demasiado. Reintentá; si se repite, exportá de nuevo como MP4 H.264 estándar.',
  ASSET_STORAGE_ERROR: () => 'No pudimos verificar el archivo almacenado. Reintentá la subida.',
};

export function remediationFor(
  rejection: Pick<AssetRejection, 'code' | 'details'>,
  surfaceType: string,
  formats: SurfaceFormats = deriveSurfaceFormats(EL_TRUST),
): Remediation {
  const surface: SurfaceFormatId = parseSurfaceType(surfaceType, formats);
  const fmt = formats[surface];
  const fps = targetFps(rejection.code === 'ASSET_BAD_FPS' ? rejection.details?.actual : undefined);
  const summary = TEXTO[rejection.code]({ width: fmt.width, height: fmt.height }, fps);
  if (!TRANSCODABLE.has(rejection.code)) return { summary };
  const args = normalizationArgs(fmt.width, fmt.height, fps);
  return { summary, ffmpeg: { args, displayCommand: display(args) } };
}
