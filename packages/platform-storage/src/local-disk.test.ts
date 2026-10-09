import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { type StorageHarness, desde, nuevoId, objectStorageContract, sha } from './contract';
import { StorageIntegrityError, StorageKeyError, contentKeyFor } from './keys';
import { LocalDiskStorage } from './local-disk';

const raices: string[] = [];
const dirTemp = async (p = 'trust-storage-') => { const d = await fs.mkdtemp(path.join(os.tmpdir(), p)); raices.push(d); return d; };
afterAll(async () => { for (const r of raices) await fs.rm(r, { recursive: true, force: true }); });

/** Ganchos del contrato: escriben DIRECTO en el disco, saltando al adaptador. */
async function harness(): Promise<StorageHarness & { storage: LocalDiskStorage }> {
  const storage = await LocalDiskStorage.open(await dirTemp());
  const tmp = (id: string) => path.join(storage.root, 'tmp', id);
  return {
    storage,
    async plantFinal(key, bytes) {
      const abs = path.join(storage.root, ...key.split('/'));
      await fs.mkdir(path.dirname(abs), { recursive: true, mode: 0o700 });
      await fs.writeFile(abs, bytes);
    },
    async plantPartialTemp(id, kind) {
      await fs.mkdir(tmp(id), { mode: 0o700 });
      const meta = JSON.stringify({ tempId: id, sizeBytes: 3, sha256: sha('xyz'), createdAt: new Date().toISOString() });
      if (kind === 'data-without-meta') await fs.writeFile(path.join(tmp(id), 'data'), 'xyz');
      if (kind === 'meta-without-data') await fs.writeFile(path.join(tmp(id), 'meta.json'), meta);
      if (kind === 'part-abandoned') await fs.writeFile(path.join(tmp(id), 'data.part'), 'xy');
      if (kind === 'corrupt-meta') {
        await fs.writeFile(path.join(tmp(id), 'data'), 'xyz');
        await fs.writeFile(path.join(tmp(id), 'meta.json'), '{ no es json');
      }
    },
  };
}

objectStorageContract('LocalDiskStorage (disco real)', harness);

describe('LocalDiskStorage — defensas propias del disco', () => {
  it('limpieza con TTL 0: un temporal del mismo milisegundo (mtime con fracción) se borra', async () => {
    const s = await LocalDiskStorage.open(await dirTemp());
    const id = nuevoId();
    await s.putTemporary(id, desde('basura'));
    const T = 1_790_000_000_000; // reloj fijo: la carrera del CI (mtime 0,4 ms "por delante") sin depender del azar
    const t = (T + 0.4) / 1000;
    const dir = path.join(s.root, 'tmp', id);
    for (const f of await fs.readdir(dir)) await fs.utimes(path.join(dir, f), t, t);
    await fs.utimes(dir, t, t);
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(T);
    try {
      expect(await s.cleanupTemporaryObjects(0)).toBe(1);
    } finally {
      reloj.mockRestore();
    }
    expect(await s.statTemporary(id)).toBeNull();
  });


  it('CRITERIO: arrancar sobre directorios preexistentes 0777 los endurece a 0700', async () => {
    const root = await dirTemp();
    for (const d of ['', 'tmp', 'sha256', 'sha256/ab']) {
      await fs.mkdir(path.join(root, d), { recursive: true });
      await fs.chmod(path.join(root, d), 0o777);
    }
    const s = await LocalDiskStorage.open(root);
    const modo = async (p: string) => (await fs.stat(p)).mode & 0o777;
    expect(await modo(root)).toBe(0o700);
    expect(await modo(path.join(root, 'tmp'))).toBe(0o700);
    expect(await modo(path.join(root, 'sha256'))).toBe(0o700);
    // un shard preexistente laxo se endurece cuando se usa
    let contenido = '';
    for (let i = 0; ; i++) { contenido = `shard-ab-${i}`; if (sha(contenido).startsWith('ab')) break; }
    const id = nuevoId();
    await s.putTemporary(id, desde(contenido));
    await s.commitContentAddressed(id, { sha256: sha(contenido) });
    expect(await modo(path.join(root, 'sha256', 'ab'))).toBe(0o700);
  });

  it('permisos: temporal 0600, final 0440', async () => {
    const { storage: s } = await harness();
    const id = nuevoId();
    const info = await s.putTemporary(id, desde(`perm ${nuevoId()}`));
    const modo = async (p: string) => (await fs.stat(p)).mode & 0o777;
    expect(await modo(path.join(s.root, 'tmp', id, 'data'))).toBe(0o600);
    const { key } = await s.commitContentAddressed(id, { sha256: info.sha256 });
    expect(await modo(path.join(s.root, ...key.split('/')))).toBe(0o440);
  });

  it('metadata validada: tempId ajeno, sha inválido, tamaño negativo o fecha inválida ⇒ STORAGE_INTEGRITY', async () => {
    const { storage: s } = await harness();
    const variantes = [
      (id: string) => ({ tempId: `${id}-otro`, sizeBytes: 3, sha256: sha('xyz'), createdAt: new Date().toISOString() }),
      (id: string) => ({ tempId: id, sizeBytes: 3, sha256: 'no-es-un-sha', createdAt: new Date().toISOString() }),
      (id: string) => ({ tempId: id, sizeBytes: -1, sha256: sha('xyz'), createdAt: new Date().toISOString() }),
      (id: string) => ({ tempId: id, sizeBytes: 3, sha256: sha('xyz'), createdAt: 'ayer' }),
      (id: string) => ({ tempId: id, sizeBytes: 99, sha256: sha('xyz'), createdAt: new Date().toISOString() }), // tamaño ≠ datos
    ];
    for (const v of variantes) {
      const id = nuevoId();
      await fs.mkdir(path.join(s.root, 'tmp', id), { mode: 0o700 });
      await fs.writeFile(path.join(s.root, 'tmp', id, 'data'), 'xyz');
      await fs.writeFile(path.join(s.root, 'tmp', id, 'meta.json'), JSON.stringify(v(id)));
      await expect(s.statTemporary(id)).rejects.toBeInstanceOf(StorageIntegrityError);
    }
  });

  it('symlink intermedio: un shard sha256/ab que apunta afuera se rechaza', async () => {
    const { storage: s } = await harness();
    const afuera = await dirTemp('afuera-');
    const contenido = Buffer.from(`symlink ${nuevoId()}`);
    await fs.symlink(afuera, path.join(s.root, 'sha256', sha(contenido).slice(0, 2)));
    const id = nuevoId();
    await s.putTemporary(id, desde(contenido));
    await expect(s.commitContentAddressed(id, { sha256: sha(contenido) })).rejects.toBeInstanceOf(StorageKeyError);
    expect(await fs.readdir(afuera)).toEqual([]);
  });

  it('symlink como reserva o como datos: rechazado', async () => {
    const { storage: s } = await harness();
    const afuera = await dirTemp('afuera-');
    const id = nuevoId();
    await fs.symlink(afuera, path.join(s.root, 'tmp', id));
    await expect(s.statTemporary(id)).rejects.toBeInstanceOf(StorageKeyError);
    const id2 = nuevoId();
    await fs.mkdir(path.join(s.root, 'tmp', id2), { mode: 0o700 });
    await fs.symlink('/etc/hostname', path.join(s.root, 'tmp', id2, 'data'));
    await fs.writeFile(path.join(s.root, 'tmp', id2, 'meta.json'), JSON.stringify({ tempId: id2, sizeBytes: 3, sha256: sha('x'), createdAt: new Date().toISOString() }));
    await expect(s.statTemporary(id2)).rejects.toBeInstanceOf(StorageKeyError);
  });

  it('un temporal alterado después de escrito no se promueve', async () => {
    const { storage: s } = await harness();
    const id = nuevoId();
    const info = await s.putTemporary(id, desde('contenido original'));
    await fs.chmod(path.join(s.root, 'tmp', id, 'data'), 0o600);
    await fs.writeFile(path.join(s.root, 'tmp', id, 'data'), 'contenido ALTERADO'); // mismo largo
    await expect(s.commitContentAddressed(id, { sha256: info.sha256 })).rejects.toBeInstanceOf(StorageIntegrityError);
  });

  it('el nombre original nunca define el path: solo existen tmp/ y sha256/ con claves canónicas', async () => {
    const { storage: s } = await harness();
    const id = nuevoId();
    const info = await s.putTemporary(id, desde(`nombre ${nuevoId()}`));
    const { key } = await s.commitContentAddressed(id, { sha256: info.sha256 });
    expect((await fs.readdir(s.root)).sort()).toEqual(['sha256', 'tmp']);
    expect(key).toBe(contentKeyFor(info.sha256));
    expect(await fs.readdir(path.join(s.root, 'sha256', info.sha256.slice(0, 2)))).toEqual([info.sha256]);
  });

  it('TTL: la limpieza borra solo reservas más viejas que el TTL', async () => {
    const { storage: s } = await harness();
    const viejo = nuevoId(); const reciente = nuevoId();
    await s.putTemporary(viejo, desde('viejo'));
    await s.putTemporary(reciente, desde('reciente'));
    const hace2h = new Date(Date.now() - 2 * 3600e3);
    for (const f of ['', 'data', 'meta.json']) await fs.utimes(path.join(s.root, 'tmp', viejo, f), hace2h, hace2h);
    expect(await s.cleanupTemporaryObjects(3600e3)).toBe(1);
    expect(await s.statTemporary(viejo)).toBeNull();
    expect(await s.statTemporary(reciente)).not.toBeNull();
  });

  it('streaming: 96 MB pasan sin cargarse en memoria', async () => {
    const { storage: s } = await harness();
    const MB = 1024 * 1024;
    const bloque = Buffer.alloc(MB, 7);
    const fuente = Readable.from((function* () { for (let i = 0; i < 96; i++) yield bloque; })());
    const antes = process.memoryUsage().rss;
    const info = await s.putTemporary(nuevoId(), fuente);
    expect(info.sizeBytes).toBe(96 * MB);
    expect(process.memoryUsage().rss - antes).toBeLessThan(48 * MB);
  });
});
