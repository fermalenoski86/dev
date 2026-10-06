import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  CopyObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand,
  ListObjectsV2Command, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { HashingCounter, descartar } from './hashing';
import {
  StorageConflictError, StorageIntegrityError, assertContentKey, assertTempId, contentKeyFor, parseTempMeta, shaDeClave,
} from './keys';
import type { BlobInfo, CommitResult, ObjectStorage, TempObjectInfo } from './types';

/**
 * S3CompatibleStorage — Fase B1 + Integrity Gate B1.1.
 *
 *   tmp/<tempId>/reservation   RESERVA exclusiva (PutObject If-None-Match: *)
 *   tmp/<tempId>/data          contenido
 *   tmp/<tempId>/meta.json     se escribe AL FINAL (If-None-Match: *)
 *   sha256/ab/<64hex>          final canónico, sin extensión
 *
 * QUÉ GARANTIZA (documentado en docs/platform/STORAGE.md):
 *   · un tempId se reserva una sola vez; estados parciales no se reutilizan;
 *   · un blob final EXISTENTE solo se acepta si su SHA-256 real (se lee y se
 *     hashea) coincide con su clave: el tamaño solo no alcanza;
 *   · un blob final NUEVO se copia pidiendo checksum SHA-256 al servidor y se
 *     verifica contra la clave; si el proveedor no lo devuelve, se re-hashea.
 * QUÉ NO GARANTIZA por sí solo: que nadie con credenciales del bucket lo
 * altere después. Eso lo cubre el bucket con versionado + object lock, y la
 * verificación al deduplicar.
 */
export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

const status = (e: unknown) => (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const noEncontrado = (e: unknown) => {
  const n = (e as { name?: string })?.name;
  return n === 'NotFound' || n === 'NoSuchKey' || status(e) === 404;
};
const precondicion = (e: unknown) => (e as { name?: string })?.name === 'PreconditionFailed' || status(e) === 412;
const hexABase64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');

export class S3CompatibleStorage implements ObjectStorage {
  readonly driver = 's3' as const;
  readonly client: S3Client;
  constructor(readonly cfg: S3Config) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  private pref(id: string) {
    return `tmp/${assertTempId(id)}/`;
  }

  private async getBody(key: string): Promise<Readable> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    if (!r.Body) throw new StorageIntegrityError('respuesta S3 sin cuerpo');
    return r.Body as Readable;
  }
  private async getText(key: string): Promise<string | null> {
    try {
      const chunks: Buffer[] = [];
      for await (const c of await this.getBody(key)) chunks.push(Buffer.from(c));
      return Buffer.concat(chunks).toString('utf-8');
    } catch (e) {
      if (noEncontrado(e)) return null;
      throw e;
    }
  }
  private async head(key: string): Promise<{ size: number; checksum?: string } | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key, ChecksumMode: 'ENABLED' }));
      return { size: Number(r.ContentLength ?? 0), checksum: r.ChecksumSHA256 };
    } catch (e) {
      if (noEncontrado(e)) return null;
      throw e;
    }
  }
  private async hashKey(key: string): Promise<{ sha256: string; sizeBytes: number }> {
    const counter = new HashingCounter();
    await pipeline(await this.getBody(key), counter, descartar());
    return { sha256: counter.digest(), sizeBytes: counter.bytes };
  }

  async putTemporary(tempId: string, source: Readable, opts: { maxBytes?: number } = {}): Promise<TempObjectInfo> {
    const p = this.pref(tempId);
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: `${p}reservation`, Body: '', IfNoneMatch: '*' }));
    } catch (e) {
      if (precondicion(e)) throw new StorageConflictError('el tempId ya está reservado');
      throw e;
    }
    try {
      const counter = new HashingCounter(opts.maxBytes);
      const up = new Upload({ client: this.client, params: { Bucket: this.cfg.bucket, Key: `${p}data`, Body: counter } });
      await Promise.all([pipeline(source, counter).catch((e) => { void up.abort(); throw e; }), up.done()]);
      const info: TempObjectInfo = { tempId, sizeBytes: counter.bytes, sha256: counter.digest(), createdAt: new Date() };
      await this.client.send(new PutObjectCommand({
        Bucket: this.cfg.bucket, Key: `${p}meta.json`, IfNoneMatch: '*', ContentType: 'application/json',
        Body: JSON.stringify({ ...info, createdAt: info.createdAt.toISOString() }),
      }));
      return info;
    } catch (e) {
      await this.deleteTemporary(tempId).catch(() => {});
      throw e;
    }
  }

  async statTemporary(tempId: string): Promise<TempObjectInfo | null> {
    const p = this.pref(tempId);
    if (!(await this.head(`${p}reservation`))) return null;
    const raw = await this.getText(`${p}meta.json`);
    if (raw === null) return null; // incompleto: no reutilizable, lo limpia el TTL
    const m = parseTempMeta(raw, tempId);
    const data = await this.head(`${p}data`);
    if (!data) throw new StorageIntegrityError('metadata sin datos');
    if (data.size !== m.sizeBytes) throw new StorageIntegrityError('el tamaño de los datos no coincide con la metadata');
    return { tempId, sizeBytes: m.sizeBytes, sha256: m.sha256, createdAt: new Date(m.createdAt) };
  }

  async readTemporary(tempId: string): Promise<Readable> {
    if (!(await this.statTemporary(tempId))) throw new StorageIntegrityError('el temporal no existe o está incompleto');
    return this.getBody(`${this.pref(tempId)}data`);
  }

  async deleteTemporary(tempId: string): Promise<void> {
    const p = this.pref(tempId);
    await this.client.send(new DeleteObjectsCommand({
      Bucket: this.cfg.bucket, Delete: { Objects: ['reservation', 'data', 'meta.json'].map((k) => ({ Key: `${p}${k}` })), Quiet: true },
    }));
  }

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
    const dataKey = `${this.pref(tempId)}data`;
    const real = await this.hashKey(dataKey);
    if (real.sha256 !== info.sha256 || real.sizeBytes !== info.sizeBytes) throw new StorageIntegrityError('el temporal cambió desde que se escribió');
    const key = contentKeyFor(expected.sha256);
    const created = await this.promote(dataKey, key, info.sizeBytes); // si falla, el temporal válido queda
    await this.deleteTemporary(tempId);
    return { key, created, sizeBytes: info.sizeBytes };
  }

  private async promote(fromKey: string, key: string, sizeBytes: number): Promise<boolean> {
    const sha = shaDeClave(key);
    if (await this.head(key)) {
      const existente = await this.hashKey(key); // el SHA real, no el tamaño
      if (existente.sha256 !== sha || existente.sizeBytes !== sizeBytes) throw new StorageIntegrityError('el blob final existente no corresponde a su clave');
      return false;
    }
    await this.client.send(new CopyObjectCommand({
      Bucket: this.cfg.bucket, CopySource: `${this.cfg.bucket}/${fromKey}`, Key: key, ChecksumAlgorithm: 'SHA256',
    }));
    const h = await this.head(key);
    if (h?.checksum && !h.checksum.includes('-')) {
      if (h.checksum !== hexABase64(sha)) throw new StorageIntegrityError('el checksum del servidor no coincide con la clave');
    } else {
      const copiado = await this.hashKey(key);
      if (copiado.sha256 !== sha) throw new StorageIntegrityError('la copia final no coincide con la clave');
    }
    return true;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }
  async stat(key: string): Promise<BlobInfo | null> {
    const h = await this.head(assertContentKey(key));
    return h === null ? null : { key, sizeBytes: h.size };
  }
  async read(key: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: assertContentKey(key) }));
    if (!r.Body) throw new StorageIntegrityError('respuesta S3 sin cuerpo');
    return Buffer.from(await r.Body.transformToByteArray());
  }
  async stream(key: string): Promise<Readable> {
    return this.getBody(assertContentKey(key));
  }

  /** Borra reservas (completas o a medias) cuyo objeto más reciente supera el TTL. */
  async cleanupTemporaryObjects(olderThanMs: number): Promise<number> {
    const limite = Date.now() - olderThanMs;
    const porId = new Map<string, { keys: string[]; ultima: number }>();
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: 'tmp/', ContinuationToken: token }));
      for (const o of r.Contents ?? []) {
        const id = o.Key?.split('/')[1];
        if (!o.Key || !id) continue;
        const g = porId.get(id) ?? { keys: [], ultima: 0 };
        g.keys.push(o.Key);
        g.ultima = Math.max(g.ultima, o.LastModified?.getTime() ?? 0);
        porId.set(id, g);
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    let borrados = 0;
    for (const g of porId.values()) {
      if (g.ultima > limite) continue;
      await this.client.send(new DeleteObjectsCommand({ Bucket: this.cfg.bucket, Delete: { Objects: g.keys.map((Key) => ({ Key })), Quiet: true } }));
      borrados += 1;
    }
    return borrados;
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
  }
}
