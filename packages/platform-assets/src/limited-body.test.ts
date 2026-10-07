import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StorageLimitError } from '@trust/platform-storage';
import { describe, expect, it } from 'vitest';
import { limitBody } from './limited-body';

const correr = async (chunks: Buffer[], limit: number) => {
  const fuente = Readable.from(chunks);
  const lb = limitBody(fuente, limit);
  let recibidos = 0;
  const destino = new Writable({ write(c: Buffer, _e, cb) { recibidos += c.length; cb(); } });
  const err = await pipeline(lb.stream, destino).then(() => null, (e: unknown) => e);
  return { prefix: lb.prefixSha256(), err, recibidos, fuente };
};

describe('CRITERIO: limitBody — corte en el límite con huella determinística', () => {
  const datos = Buffer.from('0123456789abcdef');
  const prefijo = createHash('sha256').update(datos.subarray(0, 9)).digest('hex');

  it.each([[[datos]], [[datos.subarray(0, 3), datos.subarray(3)]], [Array.from(datos).map((b) => Buffer.from([b]))]])(
    'mismo cuerpo, cualquier troceado → misma huella de límite+1 bytes', async (chunks) => {
      const r = await correr(chunks as Buffer[], 8);
      expect(r.err).toBeInstanceOf(StorageLimitError);
      expect(r.prefix).toBe(prefijo);
      expect(r.fuente.destroyed).toBe(true); // el cuerpo original deja de consumirse
      expect(r.recibidos).toBeLessThanOrEqual(8); // nunca pasa más que el límite
    });

  it('cuerpos distintos dentro del prefijo → huellas distintas', async () => {
    const a = await correr([Buffer.from('AAAAA')], 4);
    const b = await correr([Buffer.from('BBBBB')], 4);
    expect(a.prefix).not.toBe(b.prefix);
  });

  it('justo en el límite: pasa entero y sin huella', async () => {
    const r = await correr([datos.subarray(0, 8)], 8);
    expect(r.err).toBeNull();
    expect(r.recibidos).toBe(8);
    expect(r.prefix).toBeNull();
  });
});
