import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { StorageLimitError } from '@trust/platform-storage';

/**
 * Corte del upload en MAX_UPLOAD_BYTES con una IDENTIDAD determinística del
 * cuerpo rechazado (auditoría B3 #1).
 *
 * Un upload demasiado grande no se guarda ni se lee entero: se corta al ver el
 * byte `limit + 1`. Para que la Idempotency-Key distinga dos cuerpos grandes
 * distintos, se hashea EXACTAMENTE el prefijo de `limit + 1` bytes — siempre
 * los mismos bytes, sin importar cómo llegue troceado el stream.
 *
 * Límite de esa identidad (documentado en ASSETS.md): dos cuerpos que coinciden
 * en sus primeros `limit + 1` bytes y difieren después son indistinguibles.
 * Los dos se rechazan igual (ASSET_TOO_LARGE con el mismo límite), así que el
 * replay devuelve la misma respuesta que daría procesarlo de nuevo.
 */
export interface LimitedBody {
  /** El cuerpo cortado: se lee a demanda (no fluye antes de que alguien lo consuma). */
  stream: Readable;
  /** sha256 de los primeros límite+1 bytes; null si el cuerpo no superó el límite. */
  prefixSha256(): string | null;
}

/**
 * Al superar el límite, el generador lanza StorageLimitError: el `for await`
 * cierra el iterador del cuerpo original (lo destruye) y no se sigue consumiendo.
 */
export function limitBody(body: Readable, limitBytes: number): LimitedBody {
  const hash = createHash('sha256');
  let prefijo: string | null = null;
  async function* cortar() {
    let seen = 0;
    for await (const raw of body) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
      const resto = limitBytes + 1 - seen;
      if (chunk.length < resto) {
        hash.update(chunk);
        seen += chunk.length;
        yield chunk;
        continue;
      }
      hash.update(chunk.subarray(0, resto));
      prefijo = hash.digest('hex');
      throw new StorageLimitError(limitBytes);
    }
  }
  return { stream: Readable.from(cortar(), { objectMode: false }), prefixSha256: () => prefijo };
}
