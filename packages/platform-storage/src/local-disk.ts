import { randomUUID } from 'node:crypto';
import { constants as C, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HashingCounter, descartar } from './hashing';
import {
  StorageConflictError, StorageIntegrityError, StorageKeyError, assertContentKey, assertTempId, contentKeyFor,
  parseTempMeta, shaDeClave,
} from './keys';
import type { BlobInfo, CommitResult, ObjectStorage, TempObjectInfo } from './types';

/**
 * LocalDiskStorage — Fase B1 + Integrity Gate B1.1.
 *
 *   <root>/tmp/<tempId>/            RESERVA exclusiva (mkdir): un tempId, una vez
 *   <root>/tmp/<tempId>/data.part   escritura en curso
 *   <root>/tmp/<tempId>/data        contenido completo
 *   <root>/tmp/<tempId>/meta.json   se escribe AL FINAL: marca de completitud
 *   <root>/sha256/ab/<64hex>        final canónico, sin extensión (0440)
 *
 * Estados de un temporal:
 *   sin directorio                        → no existe
 *   directorio sin meta.json              → incompleto (crash): statTemporary = null,
 *                                           NO reutilizable, lo limpia el TTL
 *   meta.json válida + data del tamaño    → completo
 *   meta.json corrupta, o sin data, o
 *   data de otro tamaño                   → STORAGE_INTEGRITY
 *
 * Defensas: lstat por componente (symlink intermedio), O_NOFOLLOW (symlink
 * final), creación exclusiva, link() atómico que nunca sobrescribe, y un
 * blob final existente se verifica por su SHA-256 REAL, no por su tamaño.
 */
const DIR_MODE = 0o700;
const TMP_MODE = 0o600;
const FINAL_MODE = 0o440;
const RO = C.O_RDONLY | C.O_NOFOLLOW;
const CREATE_EXCL = C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW;

const esCodigo = (e: unknown, ...codes: string[]) => codes.includes((e as NodeJS.ErrnoException)?.code ?? '');

export class LocalDiskStorage implements ObjectStorage {
  readonly driver = 'local' as const;
  private constructor(readonly root: string) {}

  static async open(rootDir: string): Promise<LocalDiskStorage> {
    if (!path.isAbsolute(rootDir)) throw new StorageKeyError('LOCAL_STORAGE_ROOT tiene que ser absoluto');
    await fs.mkdir(rootDir, { recursive: true, mode: DIR_MODE });
    const real = await fs.realpath(rootDir);
    await LocalDiskStorage.endurecer(real);
    const s = new LocalDiskStorage(real);
    await s.ensureDir('tmp');
    await s.ensureDir('sha256');
    return s;
  }

  /** Directorio propio con 0700, aunque existiera antes con 0777/0755. */
  private static async endurecer(dir: string): Promise<void> {
    const st = await fs.lstat(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new StorageKeyError('el almacenamiento tiene un componente que no es directorio');
    if ((st.mode & 0o777) !== DIR_MODE) {
      await fs.chmod(dir, DIR_MODE);
      if (((await fs.lstat(dir)).mode & 0o777) !== DIR_MODE) throw new StorageKeyError(`no se pudieron endurecer los permisos de ${dir}`);
    }
  }

  /* ── paths seguros ─────────────────────────────────────────────── */

  private async ensureDir(rel: string): Promise<string> {
    let actual = this.root;
    for (const seg of rel.split('/')) {
      actual = path.join(actual, seg);
      try {
        await fs.mkdir(actual, { mode: DIR_MODE });
      } catch (e) {
        if (!esCodigo(e, 'EEXIST')) throw e;
      }
      await LocalDiskStorage.endurecer(actual);
    }
    return actual;
  }

  private async assertDirs(abs: string): Promise<void> {
    const rel = path.relative(this.root, path.dirname(abs));
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new StorageKeyError('path fuera del almacenamiento');
    let actual = this.root;
    for (const seg of rel.split(path.sep).filter(Boolean)) {
      actual = path.join(actual, seg);
      const st = await fs.lstat(actual).catch((e) => {
        if (esCodigo(e, 'ENOENT')) return null;
        throw e;
      });
      if (st && (st.isSymbolicLink() || !st.isDirectory())) throw new StorageKeyError(`componente no permitido en el path: ${seg}`);
    }
  }

  private tmpDir(tempId: string): string {
    return path.join(this.root, 'tmp', assertTempId(tempId));
  }
  private finalPath(key: string): string {
    return path.join(this.root, ...assertContentKey(key).split('/'));
  }

  private async openRead(abs: string) {
    await this.assertDirs(abs);
    try {
      return await fs.open(abs, RO);
    } catch (e) {
      if (esCodigo(e, 'ELOOP')) throw new StorageKeyError('symlink rechazado');
      throw e;
    }
  }

  private async syncDir(dir: string): Promise<void> {
    const fh = await fs.open(dir, C.O_RDONLY);
    try { await fh.sync(); } finally { await fh.close(); }
  }

  private async writeExclusive(abs: string, source: Readable, maxBytes?: number): Promise<{ sha256: string; sizeBytes: number }> {
    await this.assertDirs(abs);
    let fh;
    try {
      fh = await fs.open(abs, CREATE_EXCL, TMP_MODE);
    } catch (e) {
      if (esCodigo(e, 'EEXIST')) throw new StorageConflictError('el objeto ya existe');
      if (esCodigo(e, 'ELOOP')) throw new StorageKeyError('symlink rechazado');
      throw e;
    }
    const counter = new HashingCounter(maxBytes);
    try {
      await pipeline(source, counter, fh.createWriteStream({ flush: true }));
    } catch (e) {
      await fh.close().catch(() => {});
      await fs.unlink(abs).catch(() => {});
      throw e;
    }
    return { sha256: counter.digest(), sizeBytes: counter.bytes };
  }

  private async hashFile(abs: string): Promise<{ sha256: string; sizeBytes: number }> {
    const fh = await this.openRead(abs);
    const counter = new HashingCounter();
    await pipeline(fh.createReadStream(), counter, descartar());
    return { sha256: counter.digest(), sizeBytes: counter.bytes };
  }

  /* ── temporales ────────────────────────────────────────────────── */

  async putTemporary(tempId: string, source: Readable, opts: { maxBytes?: number } = {}): Promise<TempObjectInfo> {
    const dir = this.tmpDir(tempId);
    await this.assertDirs(path.join(dir, 'x'));
    // RESERVA atómica: mkdir falla si el tempId ya existe, completo o a medias.
    try {
      await fs.mkdir(dir, { mode: DIR_MODE });
    } catch (e) {
      if (esCodigo(e, 'EEXIST')) throw new StorageConflictError('el tempId ya está reservado');
      throw e;
    }
    try {
      const r = await this.writeExclusive(path.join(dir, 'data.part'), source, opts.maxBytes);
      await fs.rename(path.join(dir, 'data.part'), path.join(dir, 'data'));
      const info: TempObjectInfo = { tempId, sizeBytes: r.sizeBytes, sha256: r.sha256, createdAt: new Date() };
      const meta = await fs.open(path.join(dir, 'meta.json'), CREATE_EXCL, TMP_MODE);
      try {
        await meta.writeFile(JSON.stringify({ ...info, createdAt: info.createdAt.toISOString() }));
        await meta.sync();
      } finally {
        await meta.close();
      }
      await this.syncDir(dir);
      return info;
    } catch (e) {
      // la reserva es NUESTRA: si esta escritura falló, se libera entera
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw e;
    }
  }

  async statTemporary(tempId: string): Promise<TempObjectInfo | null> {
    const dir = this.tmpDir(tempId);
    await this.assertDirs(path.join(dir, 'x'));
    const st = await fs.lstat(dir).catch((e) => {
      if (esCodigo(e, 'ENOENT')) return null;
      throw e;
    });
    if (!st) return null;
    if (st.isSymbolicLink() || !st.isDirectory()) throw new StorageKeyError('reserva de temporal inválida');
    let raw: string;
    try {
      const fh = await this.openRead(path.join(dir, 'meta.json'));
      try { raw = await fh.readFile('utf-8'); } finally { await fh.close(); }
    } catch (e) {
      if (esCodigo(e, 'ENOENT')) return null; // incompleto (crash): no es un temporal válido
      throw e;
    }
    const m = parseTempMeta(raw, tempId);
    const data = await fs.lstat(path.join(dir, 'data')).catch((e) => {
      if (esCodigo(e, 'ENOENT')) return null;
      throw e;
    });
    if (!data) throw new StorageIntegrityError('metadata sin datos');
    if (data.isSymbolicLink() || !data.isFile()) throw new StorageKeyError('symlink rechazado');
    if (data.size !== m.sizeBytes) throw new StorageIntegrityError('el tamaño de los datos no coincide con la metadata');
    return { tempId, sizeBytes: m.sizeBytes, sha256: m.sha256, createdAt: new Date(m.createdAt) };
  }

  async readTemporary(tempId: string): Promise<Readable> {
    if (!(await this.statTemporary(tempId))) throw new StorageIntegrityError('el temporal no existe o está incompleto');
    const fh = await this.openRead(path.join(this.tmpDir(tempId), 'data'));
    return fh.createReadStream();
  }

  async deleteTemporary(tempId: string): Promise<void> {
    const dir = this.tmpDir(tempId);
    await this.assertDirs(path.join(dir, 'x'));
    await fs.rm(dir, { recursive: true, force: true }); // rm no sigue symlinks: borra el link
  }

  /* ── inmutables ────────────────────────────────────────────────── */

  async putIfAbsent(key: string, source: Readable): Promise<{ created: boolean; sizeBytes: number }> {
    const esperado = shaDeClave(key);
    const id = `pia-${randomUUID()}`;
    const info = await this.putTemporary(id, source);
    if (info.sha256 !== esperado) {
      await this.deleteTemporary(id);
      throw new StorageIntegrityError('el contenido no corresponde a la clave');
    }
    const r = await this.commitContentAddressed(id, { sha256: esperado });
    return { created: r.created, sizeBytes: r.sizeBytes };
  }

  async commitContentAddressed(tempId: string, expected: { sha256: string }): Promise<CommitResult> {
    const info = await this.statTemporary(tempId);
    if (!info) throw new StorageIntegrityError('el temporal no existe o está incompleto');
    if (info.sha256 !== expected.sha256) throw new StorageIntegrityError('el sha256 del temporal no es el esperado');
    const data = path.join(this.tmpDir(tempId), 'data');
    const real = await this.hashFile(data);
    if (real.sha256 !== info.sha256 || real.sizeBytes !== info.sizeBytes) throw new StorageIntegrityError('el temporal cambió desde que se escribió');
    const key = contentKeyFor(expected.sha256);
    // Si falla (p. ej. blob final corrupto), el temporal VÁLIDO no se borra.
    const created = await this.linkFinal(data, key, info.sizeBytes);
    await this.deleteTemporary(tempId);
    return { key, created, sizeBytes: info.sizeBytes };
  }

  /**
   * link() atómico: crea el final si no existe. Si existe, verifica su SHA-256
   * REAL contra el sha de la clave: el tamaño solo no prueba nada.
   */
  private async linkFinal(from: string, key: string, sizeBytes: number): Promise<boolean> {
    const final = this.finalPath(key);
    await this.ensureDir(path.relative(this.root, path.dirname(final)).split(path.sep).join('/'));
    try {
      await fs.link(from, final);
    } catch (e) {
      if (!esCodigo(e, 'EEXIST')) throw e;
      const st = await fs.lstat(final);
      if (st.isSymbolicLink() || !st.isFile()) throw new StorageIntegrityError('el blob final no es un archivo regular');
      const existente = await this.hashFile(final);
      if (existente.sha256 !== shaDeClave(key) || existente.sizeBytes !== sizeBytes) {
        throw new StorageIntegrityError('el blob final existente no corresponde a su clave');
      }
      return false;
    }
    await fs.chmod(final, FINAL_MODE);
    await this.syncDir(path.dirname(final));
    return true;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async stat(key: string): Promise<BlobInfo | null> {
    const abs = this.finalPath(key);
    await this.assertDirs(abs);
    const st = await fs.lstat(abs).catch((e) => {
      if (esCodigo(e, 'ENOENT')) return null;
      throw e;
    });
    if (!st) return null;
    if (st.isSymbolicLink() || !st.isFile()) throw new StorageKeyError('symlink rechazado');
    return { key, sizeBytes: st.size };
  }

  async read(key: string): Promise<Buffer> {
    const fh = await this.openRead(this.finalPath(key));
    try { return await fh.readFile(); } finally { await fh.close(); }
  }

  async stream(key: string): Promise<Readable> {
    const fh = await this.openRead(this.finalPath(key));
    return fh.createReadStream();
  }

  /** Borra reservas cuyo contenido más reciente supera el TTL (completas o a medias). */
  async cleanupTemporaryObjects(olderThanMs: number): Promise<number> {
    const dir = path.join(this.root, 'tmp');
    await this.assertDirs(path.join(dir, 'x'));
    const limite = Date.now() - olderThanMs;
    let borrados = 0;
    for (const nombre of await fs.readdir(dir)) {
      const abs = path.join(dir, nombre);
      const st = await fs.lstat(abs).catch(() => null);
      if (!st) continue;
      let ultima = st.mtimeMs;
      if (st.isDirectory() && !st.isSymbolicLink()) {
        for (const hijo of await fs.readdir(abs)) {
          const h = await fs.lstat(path.join(abs, hijo)).catch(() => null);
          if (h) ultima = Math.max(ultima, h.mtimeMs);
        }
      }
      // mtimeMs trae fracción de ms y Date.now() no: un temporal escrito en el MISMO
      // milisegundo del corte (TTL 0) quedaba "en el futuro" y no se borraba. Las dos
      // marcas se comparan con resolución de ms.
      if (Math.floor(ultima) > limite) continue;
      await fs.rm(abs, { recursive: true, force: true });
      borrados += 1;
    }
    return borrados;
  }

  async ping(): Promise<void> {
    await fs.access(path.join(this.root, 'tmp'), C.R_OK | C.W_OK);
    await fs.access(path.join(this.root, 'sha256'), C.R_OK | C.W_OK);
  }
}
