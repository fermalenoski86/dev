import { runProcess, sanitizeStderr } from './process';
import type { MediaRuntime } from './runtime';
import { MediaAbortError, type MediaDiagnostics, type MediaResult } from './types';

/**
 * FfmpegFrameDecoder — M3A.1 B2, punto 11.
 *
 * ffprobe solo lee el índice del contenedor: un MP4 con el índice intacto y
 * los frames destruidos pasa el probe con metadata perfecta. Por eso se
 * DECODIFICA un frame real: exit 0 + bytes > 0, si no, ASSET_CORRUPT.
 *
 * Punto de decode: min(100 ms, duración/2). Cerca del comienzo sin depender
 * exclusivamente del frame 0. Salida: un JPEG por pipe, contado y descartado.
 *
 * Reintento (auditoría B2 #1, hallazgo 2): si el primer intento termina bien
 * (exit 0) pero sin frame, el seek cayó después del último frame — pasa con
 * un MP4 sano de UN frame (dur 40 ms, seek 20 ms). Se reintenta desde 0 con el
 * tiempo que resta del mismo presupuesto y dentro del mismo slot del limitador.
 * No se reintenta si el decoder falló (exit ≠ 0): eso es corrupción real.
 */
export interface FrameDecoder {
  decode(inputPath: string, opts: { streamIndex: number; durationMs: number; signal?: AbortSignal }): Promise<MediaResult<{ frameBytes: number }>>;
}

export const decodeSeekMs = (durationMs: number): number => Math.max(0, Math.min(100, Math.floor(durationMs / 2)));

export class FfmpegFrameDecoder implements FrameDecoder {
  constructor(private readonly rt: MediaRuntime) {}

  async decode(inputPath: string, opts: { streamIndex: number; durationMs: number; signal?: AbortSignal }): Promise<MediaResult<{ frameBytes: number }>> {
    if (!Number.isSafeInteger(opts.streamIndex) || opts.streamIndex < 0) throw new RangeError('streamIndex inválido');
    const seekMs = decodeSeekMs(opts.durationMs);
    const argsDesde = (ms: number): string[] => [
      '-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file',
      ...(ms > 0 ? ['-ss', (ms / 1000).toFixed(3)] : []), '-i', `file:${inputPath}`,
      '-map', `0:${opts.streamIndex}`, '-an', '-sn', '-dn', '-frames:v', '1',
      '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '8', 'pipe:1',
    ];
    const r = await this.rt.limiter.run(async () => {
      const inicio = Date.now();
      const correr = (ms: number, timeoutMs: number) =>
        runProcess(this.rt.ffmpegPath, argsDesde(ms), { timeoutMs, maxStdoutBytes: this.rt.maxFrameBytes, keepStdout: false, signal: opts.signal, observer: this.rt.observer });
      const primero = await correr(seekMs, this.rt.decodeTimeoutMs);
      const sinFrame = primero.outcome.kind === 'exit' && primero.outcome.code === 0 && primero.stdoutBytes === 0;
      if (!sinFrame || seekMs === 0) return primero;
      const resta = this.rt.decodeTimeoutMs - (Date.now() - inicio);
      if (resta <= 0) return { ...primero, outcome: { kind: 'timeout' as const } };
      return correr(0, resta);
    }, opts.signal);
    const diag: MediaDiagnostics = { stage: 'decode', pid: r.pid, processMs: r.durationMs, stderrTail: sanitizeStderr(r.stderrTail, inputPath) };
    if (r.outcome.kind === 'aborted') throw new MediaAbortError();
    if (r.outcome.kind === 'timeout') {
      return { ok: false, error: { code: 'ASSET_INSPECTION_TIMEOUT', message: 'La inspección superó el tiempo límite.', details: { stage: 'decode', timeoutMs: this.rt.decodeTimeoutMs } }, diagnostics: diag };
    }
    if (r.outcome.kind === 'stdout_limit') {
      return { ok: false, error: { code: 'ASSET_CORRUPT', message: 'No se pudo decodificar un frame del video.', details: { stage: 'decode', reason: 'frame_output_limit' } }, diagnostics: diag };
    }
    if (r.outcome.code !== 0 || r.stdoutBytes === 0) {
      return { ok: false, error: { code: 'ASSET_CORRUPT', message: 'No se pudo decodificar un frame del video.', details: { stage: 'decode', reason: r.outcome.code !== 0 ? 'decoder_failed' : 'no_frame' } }, diagnostics: diag };
    }
    return { ok: true, frameBytes: r.stdoutBytes };
  }
}
