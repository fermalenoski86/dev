import type { Readable } from 'node:stream';

export interface TempObjectInfo {
  tempId: string;
  sizeBytes: number;
  /** SHA-256 calculado DURANTE la escritura, no después. */
  sha256: string;
  createdAt: Date;
}

export interface BlobInfo {
  key: string;
  sizeBytes: number;
}

/**
 * Un objeto de la zona final tal como lo ve el almacenamiento (BL-08). `key` es
 * la clave relativa cruda: puede NO ser canónica (algo escrito por fuera del
 * adaptador); quien la consume la valida. `regularFile` = false para lo que en
 * disco no es un archivo regular (symlink, directorio fuera de lugar).
 */
export interface ContentObjectListing {
  key: string;
  sizeBytes: number;
  lastModified: Date;
  regularFile: boolean;
}

export interface CommitResult {
  key: string;
  /** false = el blob ya existía (deduplicación): no se reescribió. */
  created: boolean;
  sizeBytes: number;
}

/**
 * ObjectStorage — Fase B1.
 *
 * Dos zonas: temporales (tmp, mutables, con TTL) e inmutables
 * (content-addressed, nunca se sobrescriben ni se borran desde acá).
 * Ningún método recibe un path libre: los temporales se nombran con un tempId
 * del servidor, y los finales con una clave derivada del sha256.
 */
export interface ObjectStorage {
  readonly driver: 'local' | 's3';

  /**
   * Reserva el tempId de forma EXCLUSIVA antes de escribir. Un tempId ya
   * reservado —completo o a medias por un crash— nunca se reutiliza:
   * STORAGE_CONFLICT. Los estados parciales los limpia el TTL.
   */
  putTemporary(tempId: string, source: Readable, opts?: { maxBytes?: number }): Promise<TempObjectInfo>;
  readTemporary(tempId: string): Promise<Readable>;
  /** null = no existe o está incompleto. Metadata corrupta o inconsistente = STORAGE_INTEGRITY. */
  statTemporary(tempId: string): Promise<TempObjectInfo | null>;
  deleteTemporary(tempId: string): Promise<void>;

  /** Escribe en una clave de contenido solo si no existe. Nunca sobrescribe. */
  putIfAbsent(key: string, source: Readable): Promise<{ created: boolean; sizeBytes: number }>;
  exists(key: string): Promise<boolean>;
  stat(key: string): Promise<BlobInfo | null>;
  read(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;

  /**
   * Promueve un temporal a su clave canónica sha256/<2>/<64>. Re-verifica el
   * sha256 del temporal. Si el blob final ya existe, verifica su SHA-256 REAL:
   * si coincide, deduplica (created=false); si no, STORAGE_INTEGRITY y el
   * temporal válido NO se borra.
   */
  commitContentAddressed(tempId: string, expected: { sha256: string }): Promise<CommitResult>;

  /**
   * BL-08 · enumera la zona final `sha256/` SOLO para leer: no abre, no hashea,
   * no mueve ni borra. Sin orden garantizado.
   */
  listContentObjects(): AsyncIterable<ContentObjectListing>;

  /** Borra temporales más viejos que el TTL. Nunca toca blobs finales. */
  cleanupTemporaryObjects(olderThanMs: number): Promise<number>;

  /** Chequeo liviano para /ready. */
  ping(): Promise<void>;
}
