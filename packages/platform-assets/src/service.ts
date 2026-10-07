import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { appendAuditEvent } from '@trust/platform-audit';
import { type AssetRejection, AssetRejectionSchema } from '@trust/platform-contracts';
import { type Database, requestFingerprint, withIdempotency } from '@trust/platform-db';
import {
  type MediaCheckOptions,
  type MediaRuntime,
  type MediaValidationResult,
  ObjectStorageTempSource,
  type SurfaceFormats,
  checkMedia,
  parseSurfaceType,
} from '@trust/platform-media';
import { type ObjectStorage, StorageIntegrityError, StorageLimitError, type TempObjectInfo } from '@trust/platform-storage';
import type { Kysely, Selectable } from 'kysely';
import { displayFilename, normalizeOriginalFilename } from './filename';
import { limitBody } from './limited-body';

/**
 * AssetUploadService — M3A.1 Fase B3 (§5, §14–17, §20, §27, §31–33).
 *
 * Algoritmo (fronteras DB/storage, sin transacción distribuida — ver
 * docs/platform/ASSETS.md):
 *
 *   0. surfaceType válido para EL_TRUST (si no, error de request: no hay Asset).
 *   1. STREAM → temporal con tempId del servidor; SHA-256 y bytes DURANTE el
 *      stream; corte en MAX_UPLOAD_BYTES. Nada entero en RAM.
 *   2. Idempotency-Key (opcional): fingerprint = operación + surfaceType +
 *      nombre + sha256 + tamaño (si supera el límite: sha256 de los primeros
 *      límite+1 bytes, ver limitBody). Mismo actor+key+fingerprint → misma respuesta;
 *      otro contenido → 409 IDEMPOTENCY_KEY_REUSED. El Asset se crea DESPUÉS de
 *      esta decisión: un retry HTTP nunca crea un segundo Asset.
 *   3. TX: Asset UPLOADING + audit ASSET_UPLOADED.
 *   4. vacío / demasiado grande → TX: REJECTED + ASSET_REJECTED.
 *   5. TX: VALIDATING (sha256, tamaño) + ASSET_VALIDATION_STARTED.
 *   6. ffprobe → validar contra EL_TRUST → decodificar un frame (B2).
 *      Rechazo → TX: REJECTED (código + detalle) + ASSET_REJECTED.
 *   7. commitContentAddressed: idempotente; si el blob ya existe se verifica su
 *      sha256 real y se deduplica. Nunca se borra un blob final.
 *   8. TX: StoredObject (crear o reusar por sha256) + Asset READY + ASSET_VALIDATED.
 *      La base verifica que Asset y StoredObject coincidan (migración 0002).
 *   9. Siempre: el temporal se borra (finally). Si algo quedó, lo limpia el TTL.
 *
 * Si la base falla en el paso 8, el blob queda como objeto content-addressed
 * huérfano y SEGURO (nadie lo borra, otro upload del mismo contenido lo
 * reusa); el Asset queda VALIDATING (no terminal) y ningún evento dice
 * VALIDATED. El retry con la misma Idempotency-Key recupera: la reserva de la
 * key se revierte con el fallo, el pipeline corre de nuevo y deduplica el blob.
 */
export interface AssetUploadConfig {
  maxUploadBytes: number;
  formats?: SurfaceFormats;
}

export interface AssetUploadDeps {
  db: Kysely<Database>;
  storage: ObjectStorage;
  media: MediaRuntime;
  config: AssetUploadConfig;
  /** Solo para inyectar inspectores en pruebas de unidad; por defecto, ffprobe/ffmpeg reales. */
  mediaOptions?: Pick<MediaCheckOptions, 'inspector' | 'decoder'>;
}

export interface UploadInput {
  actorId: string;
  surfaceType: string;
  originalFilename: string;
  body: Readable;
  idempotencyKey?: string;
  requiredDurationMs?: number;
  signal?: AbortSignal;
  /**
   * Se llama cuando el cuerpo terminó de llegar al temporal y ANTES de crear
   * el Asset o reservar la Idempotency-Key. Si lanza, no queda nada: ni Asset,
   * ni key, ni temporal. La API lo usa para validar lo que viene después del
   * archivo en el multipart (auditoría B4 #1).
   */
  afterBody?: () => Promise<void>;
}

export type AssetStatus = 'UPLOADING' | 'VALIDATING' | 'READY' | 'REJECTED';

/** Vista pública del Asset: sin paths, sin tempId, sin stderr. */
export interface AssetView {
  id: string;
  status: AssetStatus;
  surfaceType: string;
  originalFilename: string;
  sha256: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  container: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  durationMs: number | null;
  storedObjectId: string | null;
  rejection: AssetRejection | null;
}

export interface UploadResult {
  asset: AssetView;
  /** true = respuesta repetida de un intento anterior con la misma Idempotency-Key. */
  replayed: boolean;
}

export const UPLOAD_OPERATION = 'asset.upload';

type Recibido = { kind: 'ok'; temp: TempObjectInfo } | { kind: 'too_large'; limitBytes: number; prefixSha256: string };

export class AssetUploadService {
  constructor(private readonly deps: AssetUploadDeps) {
    if (!Number.isSafeInteger(deps.config.maxUploadBytes) || deps.config.maxUploadBytes < 1) {
      throw new Error('maxUploadBytes tiene que ser un entero >= 1');
    }
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const { db, storage, config } = this.deps;
    const surfaceType = parseSurfaceType(input.surfaceType, config.formats);
    const originalFilename = normalizeOriginalFilename(input.originalFilename);
    const tempId = randomUUID(); // nunca deriva del nombre del archivo
    try {
      const recibido = await this.recibir(tempId, input.body);
      if (input.afterBody) await input.afterBody();
      const run = () => this.procesar({ ...input, surfaceType, originalFilename }, tempId, recibido);
      if (!input.idempotencyKey) return { asset: await run(), replayed: false };
      const fingerprint = requestFingerprint(UPLOAD_OPERATION, {
        surfaceType,
        originalFilename,
        requiredDurationMs: input.requiredDurationMs ?? null,
        content: recibido.kind === 'ok'
          ? { sha256: recibido.temp.sha256, sizeBytes: recibido.temp.sizeBytes }
          : { tooLarge: true, limitBytes: recibido.limitBytes, prefixSha256: recibido.prefixSha256 },
      });
      const r = await withIdempotency(db, { key: input.idempotencyKey, actorId: input.actorId, operation: UPLOAD_OPERATION, fingerprint }, async () => ({
        status: 201,
        body: await run(),
      }));
      return { asset: r.body, replayed: r.replayed };
    } finally {
      await storage.deleteTemporary(tempId).catch(() => {});
    }
  }

  private async recibir(tempId: string, body: Readable): Promise<Recibido> {
    const limitBytes = this.deps.config.maxUploadBytes;
    // El corte lo hace limitBody (con huella del prefijo); el maxBytes del
    // storage queda como segunda barrera.
    const limitado = limitBody(body, limitBytes);
    try {
      return { kind: 'ok', temp: await this.deps.storage.putTemporary(tempId, limitado.stream, { maxBytes: limitBytes }) };
    } catch (e) {
      if (!(e instanceof StorageLimitError)) throw e;
      body.destroy(); // abortar el stream del cliente: no se sigue consumiendo
      const prefixSha256 = limitado.prefixSha256();
      if (!prefixSha256) throw e; // el storage cortó primero: no debería pasar
      return { kind: 'too_large', limitBytes, prefixSha256 };
    }
  }

  private async procesar(input: UploadInput, tempId: string, recibido: Recibido): Promise<AssetView> {
    const { db, storage, media, config } = this.deps;
    const display = displayFilename(input.originalFilename);

    const asset = await db.transaction().execute(async (trx) => {
      const a = await trx
        .insertInto('assets')
        .values({ original_filename: input.originalFilename, surface_type: input.surfaceType, created_by: input.actorId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await appendAuditEvent(trx, {
        actorUserId: input.actorId, action: 'ASSET_UPLOADED', entityType: 'asset', entityId: a.id,
        metadata: recibido.kind === 'ok'
          ? { sha256: recibido.temp.sha256, sizeBytes: recibido.temp.sizeBytes, surfaceType: input.surfaceType, filename: display }
          : { tooLarge: true, limitBytes: recibido.limitBytes, prefixSha256: recibido.prefixSha256, surfaceType: input.surfaceType, filename: display },
      });
      return a;
    });

    if (recibido.kind === 'too_large') {
      return this.rechazar(asset.id, input.actorId, {
        code: 'ASSET_TOO_LARGE', message: 'El archivo supera el tamaño máximo permitido.', details: { limitBytes: recibido.limitBytes },
      });
    }
    const { temp } = recibido;
    if (temp.sizeBytes === 0) {
      return this.rechazar(asset.id, input.actorId, { code: 'ASSET_EMPTY', message: 'El archivo está vacío.', details: { sizeBytes: 0 } });
    }

    await db.transaction().execute(async (trx) => {
      await trx.updateTable('assets').set({ status: 'VALIDATING', sha256: temp.sha256, size_bytes: temp.sizeBytes }).where('id', '=', asset.id).execute();
      await appendAuditEvent(trx, { actorUserId: input.actorId, action: 'ASSET_VALIDATION_STARTED', entityType: 'asset', entityId: asset.id, metadata: { sha256: temp.sha256 } });
    });

    let r: MediaValidationResult;
    try {
      r = await checkMedia(media, new ObjectStorageTempSource(storage, tempId, media.scratchDir), input.surfaceType, {
        formats: config.formats, requiredDurationMs: input.requiredDurationMs, signal: input.signal, ...this.deps.mediaOptions,
      });
    } catch (e) {
      if (e instanceof StorageIntegrityError) return this.rechazarPorStorage(asset.id, input.actorId);
      throw e; // infraestructura (binario ausente, cancelación): el Asset queda VALIDATING, no terminal
    }
    if (!r.ok) return this.rechazar(asset.id, input.actorId, r.error);
    if (r.media.mimeType !== 'video/mp4') {
      // el validador ya exige MP4; esto protege la invariante si eso cambiara
      return this.rechazar(asset.id, input.actorId, { code: 'ASSET_BAD_CONTAINER', message: 'El contenedor no es MP4.' });
    }

    let commit;
    try {
      commit = await storage.commitContentAddressed(tempId, { sha256: temp.sha256 });
    } catch (e) {
      if (e instanceof StorageIntegrityError) return this.rechazarPorStorage(asset.id, input.actorId);
      throw e;
    }
    if (commit.sizeBytes !== temp.sizeBytes) return this.rechazarPorStorage(asset.id, input.actorId);

    const { media: m } = r;
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('stored_objects')
        .values({ sha256: temp.sha256, storage_key: commit.key, mime_type: m.mimeType as string, size_bytes: temp.sizeBytes })
        .onConflict((oc) => oc.column('sha256').doNothing())
        .execute();
      const so = await trx.selectFrom('stored_objects').select(['id']).where('sha256', '=', temp.sha256).executeTakeFirstOrThrow();
      await trx
        .updateTable('assets')
        .set({
          status: 'READY', stored_object_id: so.id, mime_type: m.mimeType, container: m.container,
          width: m.width, height: m.height, fps: m.fpsValue, codec: m.codec, duration_ms: m.durationMs,
        })
        .where('id', '=', asset.id)
        .execute();
      await appendAuditEvent(trx, {
        actorUserId: input.actorId, action: 'ASSET_VALIDATED', entityType: 'asset', entityId: asset.id,
        afterHash: temp.sha256,
        metadata: { storedObjectId: so.id, sha256: temp.sha256, deduplicated: !commit.created },
      });
    });
    return this.get(asset.id);
  }

  private rechazarPorStorage(assetId: string, actorId: string): Promise<AssetView> {
    return this.rechazar(assetId, actorId, { code: 'ASSET_STORAGE_ERROR', message: 'No se pudo verificar el archivo almacenado.' });
  }

  private async rechazar(assetId: string, actorId: string, rejection: AssetRejection): Promise<AssetView> {
    const r = AssetRejectionSchema.parse(rejection);
    await this.deps.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('assets')
        .set({ status: 'REJECTED', rejection_code: r.code, rejection_detail: JSON.stringify({ message: r.message, details: r.details ?? {} }) })
        .where('id', '=', assetId)
        .execute();
      await appendAuditEvent(trx, { actorUserId: actorId, action: 'ASSET_REJECTED', entityType: 'asset', entityId: assetId, metadata: { code: r.code } });
    });
    return this.get(assetId);
  }

  async get(assetId: string): Promise<AssetView> {
    const a = await this.deps.db.selectFrom('assets').selectAll().where('id', '=', assetId).executeTakeFirstOrThrow();
    return toView(a);
  }
}

const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

export function toView(a: Selectable<Database['assets']>): AssetView {
  const detail = a.rejection_detail as { message?: string; details?: Record<string, unknown> } | null;
  return {
    id: a.id,
    status: a.status,
    surfaceType: a.surface_type,
    originalFilename: a.original_filename,
    sha256: a.sha256,
    sizeBytes: num(a.size_bytes),
    mimeType: a.mime_type,
    container: a.container,
    width: a.width,
    height: a.height,
    fps: num(a.fps),
    codec: a.codec,
    durationMs: a.duration_ms,
    storedObjectId: a.stored_object_id,
    rejection: a.rejection_code
      ? AssetRejectionSchema.parse({ code: a.rejection_code, message: detail?.message ?? a.rejection_code, details: detail?.details })
      : null,
  };
}
