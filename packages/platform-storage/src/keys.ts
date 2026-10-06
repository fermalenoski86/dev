/**
 * Claves de almacenamiento — Fase B1 + Integrity Gate B1.1.
 *
 * Ninguna clave sale de input del usuario:
 *   · TempId: identificador opaco del servidor (un UUID).
 *   · ContentKey: SE DERIVA del sha256 y es CANÓNICA:  sha256/<2hex>/<64hex>
 *     — sin extensión: mismos bytes ⇒ exactamente UNA clave física. MIME,
 *     contenedor, nombre original y extensión son metadata de negocio.
 */
export const TEMP_ID_RE = /^[a-z0-9][a-z0-9-]{7,63}$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const CONTENT_KEY_RE = /^sha256\/([0-9a-f]{2})\/([0-9a-f]{64})$/;

export class StorageKeyError extends Error {
  readonly code = 'STORAGE_KEY_INVALID' as const;
}
export class StorageLimitError extends Error {
  readonly code = 'STORAGE_LIMIT_EXCEEDED' as const;
  constructor(readonly limitBytes: number) {
    super(`el contenido supera el límite de ${limitBytes} bytes`);
  }
}
export class StorageIntegrityError extends Error {
  readonly code = 'STORAGE_INTEGRITY' as const;
}
export class StorageConflictError extends Error {
  readonly code = 'STORAGE_CONFLICT' as const;
}

export function assertTempId(id: string): string {
  if (!TEMP_ID_RE.test(id)) throw new StorageKeyError('tempId inválido');
  return id;
}

/**
 * Exactamente sha256/<2hex>/<64hex>, y el shard tiene que ser el comienzo del
 * hash. Sin extensión, sin path extra, sin traversal.
 */
export function assertContentKey(key: string): string {
  const m = CONTENT_KEY_RE.exec(key);
  if (!m || m[2]?.slice(0, 2) !== m[1]) throw new StorageKeyError('clave de contenido inválida');
  return key;
}

/** La ÚNICA forma de obtener una clave final: a partir del sha256. */
export function contentKeyFor(sha256: string): string {
  if (!SHA256_RE.test(sha256)) throw new StorageKeyError('sha256 inválido');
  return `sha256/${sha256.slice(0, 2)}/${sha256}`;
}

/** El sha256 que ESTÁ en una clave de contenido válida. */
export function shaDeClave(key: string): string {
  const m = CONTENT_KEY_RE.exec(assertContentKey(key));
  if (!m?.[2]) throw new StorageKeyError('clave de contenido inválida');
  return m[2];
}

/**
 * Metadata de un temporal: se valida, nunca se confía a ciegas
 * (Integrity Gate B1.1, punto 5).
 */
export interface TempMeta {
  tempId: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}
export function parseTempMeta(raw: string, tempIdEsperado: string): TempMeta {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    throw new StorageIntegrityError('metadata del temporal corrupta');
  }
  const o = m as Partial<TempMeta>;
  if (!o || typeof o !== 'object') throw new StorageIntegrityError('metadata del temporal corrupta');
  if (o.tempId !== tempIdEsperado) throw new StorageIntegrityError('metadata de otro temporal');
  if (typeof o.sha256 !== 'string' || !SHA256_RE.test(o.sha256)) throw new StorageIntegrityError('sha256 inválido en la metadata');
  if (typeof o.sizeBytes !== 'number' || !Number.isSafeInteger(o.sizeBytes) || o.sizeBytes < 0) throw new StorageIntegrityError('tamaño inválido en la metadata');
  if (typeof o.createdAt !== 'string' || Number.isNaN(Date.parse(o.createdAt))) throw new StorageIntegrityError('fecha inválida en la metadata');
  return { tempId: o.tempId, sizeBytes: o.sizeBytes, sha256: o.sha256, createdAt: o.createdAt };
}
