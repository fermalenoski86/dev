import { randomUUID } from 'node:crypto';
import { constants as C, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { HashingCounter, type ObjectStorage, StorageIntegrityError } from '@trust/platform-storage';

/**
 * MediaSource — M3A.1 B2, puntos 3 y 27.
 *
 * ffprobe/ffmpeg necesitan un archivo con acceso aleatorio: un MP4 con el
 * índice (moov) al final no se puede inspeccionar desde un pipe. Este es el
 * ÚNICO lugar donde aparece un path local, y es privado: el dominio pide
 * "inspeccioná este temporal" y la fuente decide cómo materializarlo.
 *
 *   ObjectStorageTempSource: lee el temporal por la interfaz ObjectStorage
 *     (disco o S3), lo copia a un archivo propio 0600 dentro de un directorio
 *     0700 de un solo uso, y VERIFICA en la copia el sha256 y el tamaño del
 *     temporal: se inspeccionan exactamente los bytes subidos. Se borra al
 *     terminar, pase lo que pase.
 *   LocalPathSource: un archivo regular ya local (tests, herramientas). Rechaza
 *     symlinks, FIFOs y dispositivos.
 *
 * Ninguna fuente usa el nombre original del archivo: el path interno es un UUID.
 */
export interface MaterializedMedia {
  path: string;
  sizeBytes: number;
}

export interface MediaSource {
  materialize<T>(fn: (m: MaterializedMedia) => Promise<T>): Promise<T>;
}

export async function ensurePrivateDir(dir: string): Promise<string> {
  if (!path.isAbsolute(dir)) throw new Error('el directorio de trabajo de medios tiene que ser absoluto');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const st = await fs.lstat(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('el directorio de trabajo de medios no es un directorio real');
  if ((st.mode & 0o777) !== 0o700) await fs.chmod(dir, 0o700);
  return fs.realpath(dir);
}

export class ObjectStorageTempSource implements MediaSource {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly tempId: string,
    private readonly scratchDir: string,
  ) {}

  async materialize<T>(fn: (m: MaterializedMedia) => Promise<T>): Promise<T> {
    const info = await this.storage.statTemporary(this.tempId);
    if (!info) throw new StorageIntegrityError('el temporal no existe o está incompleto');
    const base = await ensurePrivateDir(this.scratchDir);
    const dir = await fs.mkdtemp(path.join(base, 'm-'));
    try {
      await fs.chmod(dir, 0o700);
      const file = path.join(dir, randomUUID());
      const fh = await fs.open(file, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600);
      const counter = new HashingCounter();
      try {
        await pipeline(await this.storage.readTemporary(this.tempId), counter, fh.createWriteStream());
      } catch (e) {
        await fh.close().catch(() => {});
        throw e;
      }
      if (counter.digest() !== info.sha256 || counter.bytes !== info.sizeBytes) {
        throw new StorageIntegrityError('la copia para inspección no coincide con el temporal');
      }
      return await fn({ path: file, sizeBytes: counter.bytes });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}

export class LocalPathSource implements MediaSource {
  constructor(private readonly filePath: string) {}
  async materialize<T>(fn: (m: MaterializedMedia) => Promise<T>): Promise<T> {
    if (!path.isAbsolute(this.filePath)) throw new Error('LocalPathSource exige un path absoluto');
    const st = await fs.lstat(this.filePath);
    if (!st.isFile()) throw new Error('LocalPathSource solo acepta archivos regulares (no symlinks, FIFOs ni dispositivos)');
    return fn({ path: this.filePath, sizeBytes: st.size });
  }
}
