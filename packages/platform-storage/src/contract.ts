import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CONTENT_KEY_RE, StorageConflictError, StorageIntegrityError, StorageKeyError, StorageLimitError, contentKeyFor } from './keys';
import type { ObjectStorage } from './types';

/**
 * Contrato de ObjectStorage (Fase B1 + Integrity Gate B1.1): lo cumple
 * CUALQUIER implementación. Los ganchos `plant*` escriben POR FUERA del
 * adaptador para simular corrupción o un crash: cada adaptador los implementa
 * con su propio medio (disco directo / API S3 directa).
 */
export type PartialKind = 'data-without-meta' | 'meta-without-data' | 'part-abandoned' | 'corrupt-meta';

export interface StorageHarness {
  storage: ObjectStorage;
  /** Escribe bytes arbitrarios en una clave final, saltando al adaptador. */
  plantFinal(key: string, bytes: Buffer): Promise<void>;
  /** Deja una reserva de temporal a medias, como tras un crash. */
  plantPartialTemp(tempId: string, kind: PartialKind): Promise<void>;
}

export const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export const desde = (b: Buffer | string) => Readable.from([Buffer.from(b)]);
export const nuevoId = () => randomUUID();
const leer = async (r: Readable) => { const c: Buffer[] = []; for await (const x of r) c.push(Buffer.from(x)); return Buffer.concat(c); };

export function objectStorageContract(nombre: string, make: () => Promise<StorageHarness>) {
  describe(`ObjectStorage contract — ${nombre}`, () => {
    /* ── temporales ── */
    it('putTemporary calcula sha256 y tamaño DURANTE la escritura; read y stat coinciden', async () => {
      const { storage: s } = await make();
      const id = nuevoId();
      const contenido = Buffer.from('video de prueba '.repeat(1000));
      expect(await s.putTemporary(id, desde(contenido))).toMatchObject({ tempId: id, sizeBytes: contenido.length, sha256: sha(contenido) });
      expect(await s.statTemporary(id)).toMatchObject({ sizeBytes: contenido.length, sha256: sha(contenido) });
      expect((await leer(await s.readTemporary(id))).equals(contenido)).toBe(true);
      await s.deleteTemporary(id);
      expect(await s.statTemporary(id)).toBeNull();
    });

    it('límite superado: StorageLimitError y la reserva se libera', async () => {
      const { storage: s } = await make();
      const id = nuevoId();
      await expect(s.putTemporary(id, desde(Buffer.alloc(5000)), { maxBytes: 4096 })).rejects.toBeInstanceOf(StorageLimitError);
      expect(await s.statTemporary(id)).toBeNull();
    });

    it('CRITERIO: dos uploads simultáneos con el MISMO tempId: uno gana, el otro STORAGE_CONFLICT', async () => {
      const { storage: s } = await make();
      const id = nuevoId();
      const rs = await Promise.allSettled([s.putTemporary(id, desde('primero')), s.putTemporary(id, desde('segundo'))]);
      const ok = rs.filter((r) => r.status === 'fulfilled');
      const ko = rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(ko).toHaveLength(1);
      expect(ko[0]?.reason).toBeInstanceOf(StorageConflictError);
      const ganador = (ok[0] as PromiseFulfilledResult<{ sha256: string }>).value.sha256;
      expect((await s.statTemporary(id))?.sha256).toBe(ganador);
    });

    it('un tempId ya usado no se reutiliza (ni completo)', async () => {
      const { storage: s } = await make();
      const id = nuevoId();
      await s.putTemporary(id, desde('uno'));
      await expect(s.putTemporary(id, desde('dos'))).rejects.toBeInstanceOf(StorageConflictError);
      expect((await s.statTemporary(id))?.sha256).toBe(sha('uno'));
    });

    it('CRITERIO: estados parciales tras un crash no se pisan ni se toman por válidos', async () => {
      const { storage: s, plantPartialTemp } = await make();
      const esperado: Record<PartialKind, 'null' | 'integrity'> = {
        'data-without-meta': 'null', 'part-abandoned': 'null', 'meta-without-data': 'integrity', 'corrupt-meta': 'integrity',
      };
      for (const [kind, stat] of Object.entries(esperado) as Array<[PartialKind, 'null' | 'integrity']>) {
        const id = nuevoId();
        await plantPartialTemp(id, kind);
        if (stat === 'null') expect(await s.statTemporary(id), kind).toBeNull();
        else await expect(s.statTemporary(id), kind).rejects.toBeInstanceOf(StorageIntegrityError);
        await expect(s.putTemporary(id, desde('nuevo')), kind).rejects.toBeInstanceOf(StorageConflictError);
        await expect(s.commitContentAddressed(id, { sha256: sha('nuevo') }), kind).rejects.toThrow();
      }
    });

    it('reintento tras un crash: con un tempId NUEVO funciona; el TTL limpia lo abandonado', async () => {
      const { storage: s, plantPartialTemp } = await make();
      const abandonado = nuevoId();
      await plantPartialTemp(abandonado, 'part-abandoned');
      const nuevo = nuevoId();
      const info = await s.putTemporary(nuevo, desde(`reintento ${nuevoId()}`));
      expect((await s.commitContentAddressed(nuevo, { sha256: info.sha256 })).created).toBe(true);
      expect(await s.cleanupTemporaryObjects(0)).toBeGreaterThanOrEqual(1);
      expect(await s.statTemporary(abandonado)).toBeNull();
      await s.putTemporary(abandonado, desde('liberado por el TTL')); // ya no está reservado
    });

    /* ── claves ── */
    it('ids y claves que no generó el servidor se rechazan', async () => {
      const { storage: s } = await make();
      for (const malo of ['../x', 'a/b', '..\\x', '', 'tmp/../../etc', 'x'.repeat(200)]) {
        await expect(s.putTemporary(malo, desde('x'))).rejects.toBeInstanceOf(StorageKeyError);
        await expect(s.statTemporary(malo)).rejects.toBeInstanceOf(StorageKeyError);
      }
      const h = sha('x');
      const otroShard = h.startsWith('bb') ? 'cc' : 'bb';
      const malas = [
        '../../etc/passwd', 'sha256/../x', `sha256/${h.slice(0, 2)}/../../x`,
        `sha256/${otroShard}/${h}`,                                   // shard que no es el comienzo del hash
        ...['exe', 'html', 'js', 'sh', 'mp4'].map((e) => `${contentKeyFor(h)}.${e}`), // ninguna extensión
        `${contentKeyFor(h)}/extra`, `/${contentKeyFor(h)}`, `${contentKeyFor(h)} `,
      ];
      for (const malo of malas) {
        await expect(s.stat(malo), malo).rejects.toBeInstanceOf(StorageKeyError);
        await expect(s.read(malo), malo).rejects.toBeInstanceOf(StorageKeyError);
        await expect(s.putIfAbsent(malo, desde('x')), malo).rejects.toBeInstanceOf(StorageKeyError);
      }
    });

    it('CRITERIO: clave canónica sin extensión: mismos bytes ⇒ UNA clave, venga de donde venga', async () => {
      const { storage: s } = await make();
      const contenido = Buffer.from(`canonico ${nuevoId()}`);
      // "master.mp4" declarado video/mp4 y "copia.txt" declarado text/plain: da igual
      const a = nuevoId(); const b = nuevoId();
      await s.putTemporary(a, desde(contenido));
      await s.putTemporary(b, desde(contenido));
      const r1 = await s.commitContentAddressed(a, { sha256: sha(contenido) });
      const r2 = await s.commitContentAddressed(b, { sha256: sha(contenido) });
      expect(r1.key).toBe(`sha256/${sha(contenido).slice(0, 2)}/${sha(contenido)}`);
      expect(r1.key).toMatch(CONTENT_KEY_RE);
      expect(r2.key).toBe(r1.key);
      expect([r1.created, r2.created]).toEqual([true, false]);
    });

    /* ── integridad del blob final ── */
    it('CRITERIO P0: blob final existente con el MISMO tamaño y otros bytes ⇒ STORAGE_INTEGRITY; el temporal válido queda', async () => {
      const { storage: s, plantFinal } = await make();
      const sufijo = nuevoId().slice(0, 8);
      const bueno = Buffer.from(`AAAA${sufijo}`);
      const malo = Buffer.from(`BBBB${sufijo}`); // mismo largo
      await plantFinal(contentKeyFor(sha(bueno)), malo);
      const id = nuevoId();
      await s.putTemporary(id, desde(bueno));
      await expect(s.commitContentAddressed(id, { sha256: sha(bueno) })).rejects.toBeInstanceOf(StorageIntegrityError);
      expect((await s.statTemporary(id))?.sha256).toBe(sha(bueno));     // NO se borró
      expect((await s.read(contentKeyFor(sha(bueno)))).equals(malo)).toBe(true); // y no se tocó el final
    });

    it('blob final existente con OTRO tamaño ⇒ STORAGE_INTEGRITY', async () => {
      const { storage: s, plantFinal } = await make();
      const bueno = Buffer.from(`correcto ${nuevoId()}`);
      await plantFinal(contentKeyFor(sha(bueno)), Buffer.from('corto'));
      const id = nuevoId();
      await s.putTemporary(id, desde(bueno));
      await expect(s.commitContentAddressed(id, { sha256: sha(bueno) })).rejects.toBeInstanceOf(StorageIntegrityError);
      expect(await s.statTemporary(id)).not.toBeNull();
    });

    it('blob final existente con los bytes CORRECTOS ⇒ dedup (created=false) y se libera el temporal', async () => {
      const { storage: s, plantFinal } = await make();
      const bueno = Buffer.from(`ya-estaba ${nuevoId()}`);
      await plantFinal(contentKeyFor(sha(bueno)), bueno);
      const id = nuevoId();
      await s.putTemporary(id, desde(bueno));
      expect((await s.commitContentAddressed(id, { sha256: sha(bueno) })).created).toBe(false);
      expect(await s.statTemporary(id)).toBeNull();
    });

    it('putIfAbsent: nunca sobrescribe y rechaza contenido que no corresponde a la clave', async () => {
      const { storage: s } = await make();
      const contenido = Buffer.from(`original ${nuevoId()}`);
      const key = contentKeyFor(sha(contenido));
      expect((await s.putIfAbsent(key, desde(contenido))).created).toBe(true);
      await expect(s.putIfAbsent(key, desde('impostor'))).rejects.toBeInstanceOf(StorageIntegrityError);
      expect((await s.putIfAbsent(key, desde(contenido))).created).toBe(false);
      expect((await s.read(key)).equals(contenido)).toBe(true);
    });

    it('concurrencia: seis commits simultáneos del mismo contenido terminan en UN blob', async () => {
      const { storage: s } = await make();
      const contenido = Buffer.from(`race ${nuevoId()}`);
      const ids = Array.from({ length: 6 }, nuevoId);
      for (const id of ids) await s.putTemporary(id, desde(contenido));
      const rs = await Promise.all(ids.map((id) => s.commitContentAddressed(id, { sha256: sha(contenido) })));
      expect(new Set(rs.map((r) => r.key)).size).toBe(1);
      expect((await s.read(rs[0]?.key ?? '')).equals(contenido)).toBe(true);
      for (const id of ids) expect(await s.statTemporary(id)).toBeNull();
    });

    it('commit con un sha256 que no es el del temporal se rechaza', async () => {
      const { storage: s } = await make();
      const id = nuevoId();
      await s.putTemporary(id, desde('a'));
      await expect(s.commitContentAddressed(id, { sha256: sha('b') })).rejects.toBeInstanceOf(StorageIntegrityError);
    });

    it('la limpieza borra temporales y NUNCA blobs finales', async () => {
      const { storage: s } = await make();
      const contenido = Buffer.from(`final ${nuevoId()}`);
      const fin = nuevoId();
      const info = await s.putTemporary(fin, desde(contenido));
      const { key } = await s.commitContentAddressed(fin, { sha256: info.sha256 });
      const temporal = nuevoId();
      await s.putTemporary(temporal, desde('basura'));
      expect(await s.cleanupTemporaryObjects(0)).toBeGreaterThanOrEqual(1);
      expect(await s.statTemporary(temporal)).toBeNull();
      expect(await s.exists(key)).toBe(true);
    });
  });
}
