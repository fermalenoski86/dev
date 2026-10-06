import os from 'node:os';
import path from 'node:path';
import { ConcurrencyLimiter } from './limiter';
import type { ProcessObserver } from './process';

/**
 * Configuración de los procesos de medios. Una sola instancia por proceso de
 * API: el limitador es compartido entre inspección y decode.
 */
export interface MediaRuntime {
  ffprobePath: string;
  ffmpegPath: string;
  probeTimeoutMs: number;
  decodeTimeoutMs: number;
  limiter: ConcurrencyLimiter;
  /** Directorio privado (0700) donde se materializan temporales para inspeccionar. */
  scratchDir: string;
  maxProbeOutputBytes: number;
  maxFrameBytes: number;
  observer?: ProcessObserver;
}

const entero = (env: NodeJS.ProcessEnv, k: string, def: number): number => {
  const v = env[k];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${k} tiene que ser un entero >= 1 (vino "${v}")`);
  return n;
};

export function mediaRuntimeFromEnv(env: NodeJS.ProcessEnv = process.env): MediaRuntime {
  return {
    ffprobePath: env.FFPROBE_PATH || 'ffprobe',
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    probeTimeoutMs: entero(env, 'MEDIA_PROBE_TIMEOUT_MS', 15_000),
    decodeTimeoutMs: entero(env, 'MEDIA_DECODE_TIMEOUT_MS', 20_000),
    limiter: new ConcurrencyLimiter(entero(env, 'MEDIA_INSPECTION_CONCURRENCY', 2)),
    scratchDir: env.MEDIA_SCRATCH_DIR || path.join(os.tmpdir(), 'trust-media-scratch'),
    maxProbeOutputBytes: 1024 * 1024,
    maxFrameBytes: 16 * 1024 * 1024,
  };
}
