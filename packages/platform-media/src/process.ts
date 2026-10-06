import { spawn } from 'node:child_process';
import { MediaInfrastructureError } from './types';

/**
 * Ejecución segura de procesos externos — M3A.1 B2, puntos 2, 12, 13 y 23.
 *
 *  · spawn con args separados y shell:false: ningún dato llega a un shell.
 *  · timeout real: SIGKILL al vencer.
 *  · cancelación: SIGKILL al abortar el AbortSignal.
 *  · stdout acotado (si se pasa el límite: SIGKILL); stderr: solo la cola.
 *  · se resuelve recién en 'close': el proceso está terminado y reapeado
 *    (no queda zombie) y los pipes vaciados.
 */
export type RunOutcome =
  | { kind: 'exit'; code: number | null; signal: NodeJS.Signals | null }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'stdout_limit' };

export interface RunResult {
  outcome: RunOutcome;
  /** Vacío si keepStdout es false. */
  stdout: Buffer;
  stdoutBytes: number;
  stderrTail: string;
  pid: number | undefined;
  durationMs: number;
}

export interface ProcessObserver {
  onStart?(pid: number | undefined): void;
  onEnd?(pid: number | undefined): void;
}

export interface RunOptions {
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes?: number;
  keepStdout?: boolean;
  signal?: AbortSignal;
  observer?: ProcessObserver;
}

export function runProcess(bin: string, args: readonly string[], opts: RunOptions): Promise<RunResult> {
  const maxErr = opts.maxStderrBytes ?? 16 * 1024;
  return new Promise<RunResult>((resolve, reject) => {
    const inicio = Date.now();
    let child;
    try {
      child = spawn(bin, [...args], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      reject(new MediaInfrastructureError(`no se pudo lanzar ${bin}: ${(e as Error).message}`));
      return;
    }
    const out: Buffer[] = [];
    let outBytes = 0;
    let err = Buffer.alloc(0);
    let motivo: RunOutcome | null = null;
    let cerrado = false;

    const terminar = (m: RunOutcome) => {
      if (motivo || cerrado) return;
      motivo = m;
      child.kill('SIGKILL');
    };

    child.stdout.on('data', (c: Buffer) => {
      outBytes += c.length;
      if (outBytes > opts.maxStdoutBytes) {
        terminar({ kind: 'stdout_limit' });
        return;
      }
      if (opts.keepStdout !== false) out.push(c);
    });
    child.stderr.on('data', (c: Buffer) => {
      err = Buffer.concat([err, c]);
      if (err.length > maxErr) err = err.subarray(err.length - maxErr);
    });

    const timer = setTimeout(() => terminar({ kind: 'timeout' }), opts.timeoutMs);
    const onAbort = () => terminar({ kind: 'aborted' });
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.once('spawn', () => opts.observer?.onStart?.(child.pid));
    child.once('error', (e: NodeJS.ErrnoException) => {
      cerrado = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new MediaInfrastructureError(`no se pudo lanzar ${bin}: ${e.code ?? e.message}`));
    });
    child.once('close', (code, signal) => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      opts.observer?.onEnd?.(child.pid);
      resolve({
        outcome: motivo ?? { kind: 'exit', code, signal },
        stdout: Buffer.concat(out),
        stdoutBytes: outBytes,
        stderrTail: err.toString('utf-8'),
        pid: child.pid,
        durationMs: Date.now() - inicio,
      });
    });
  });
}

/** stderr para LOGS: sin el path de entrada, truncado. Nunca va al cliente. */
export function sanitizeStderr(stderr: string, inputPath: string, max = 2048): string {
  const limpio = stderr.split(inputPath).join('<input>').replace(/0x[0-9a-f]+/gi, '0x…').trim();
  return limpio.length > max ? `${limpio.slice(0, max)}…[truncado]` : limpio;
}
