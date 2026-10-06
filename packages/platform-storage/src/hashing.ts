import { createHash } from 'node:crypto';
import { Transform, type TransformCallback, Writable } from 'node:stream';
import { StorageLimitError } from './keys';

/**
 * Pasa los bytes tal cual mientras calcula SHA-256 y cuenta, sin acumular en
 * memoria. Si se supera el límite, corta el stream con StorageLimitError.
 */
export class HashingCounter extends Transform {
  private readonly hash = createHash('sha256');
  bytes = 0;
  constructor(private readonly maxBytes?: number) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.bytes += chunk.length;
    if (this.maxBytes !== undefined && this.bytes > this.maxBytes) {
      cb(new StorageLimitError(this.maxBytes));
      return;
    }
    this.hash.update(chunk);
    cb(null, chunk);
  }
  digest(): string {
    return this.hash.digest('hex');
  }
}

/** Destino que descarta los bytes: para hashear un stream sin guardarlo. */
export function descartar(): Writable {
  return new Writable({ write(_chunk, _enc, cb) { cb(); } });
}
