import { AssetRejectionSchema } from '@trust/platform-contracts';
import { z } from 'zod';

/**
 * Contratos Zod de la API de Assets — M3A.1 Fase B §21.
 * Entradas (params, query, headers) y SALIDAS: toda respuesta se valida antes
 * de enviarse.
 */
const Sha = z.string().regex(/^[0-9a-f]{64}$/);

export const RemediationSchema = z.object({
  summary: z.string().min(1),
  ffmpeg: z.object({ args: z.array(z.string()), displayCommand: z.string() }).optional(),
});

export const AssetResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['UPLOADING', 'VALIDATING', 'READY', 'REJECTED']),
  surfaceType: z.string(),
  originalFilename: z.string(),
  sha256: Sha.nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  mimeType: z.string().nullable(),
  container: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  fps: z.number().positive().nullable(),
  codec: z.string().nullable(),
  durationMs: z.number().int().positive().nullable(),
  storedObjectId: z.string().uuid().nullable(),
  rejection: AssetRejectionSchema.extend({ remediation: RemediationSchema }).nullable(),
});
export type AssetResponse = z.infer<typeof AssetResponseSchema>;

export const AssetStatusResponseSchema = AssetResponseSchema.pick({ id: true, status: true, rejection: true });

export const AssetListResponseSchema = z.object({
  items: z.array(AssetResponseSchema),
  nextCursor: z.string().uuid().nullable(),
});

export const ErrorResponseSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().min(1),
});

export const AssetParamsSchema = z.object({ id: z.string().uuid() }).strict();

export const AssetListQuerySchema = z
  .object({
    status: z.enum(['UPLOADING', 'VALIDATING', 'READY', 'REJECTED']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().uuid().optional(),
  })
  .strict();

/** Idempotency-Key obligatoria en el upload (§20). Mismo rango que la tabla. */
export const UploadHeadersSchema = z.object({
  'idempotency-key': z.string().min(8).max(200).regex(/^[\x21-\x7e]+$/, 'solo ASCII visible'),
});

export const UploadFieldsSchema = z
  .object({
    surfaceType: z.string().min(1).max(64),
    requiredDurationMs: z.coerce.number().int().min(1).max(3_600_000).optional(),
  })
  .strict();
