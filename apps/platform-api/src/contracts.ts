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

/* ── auth (C1, §30) ─────────────────────────────────────────────────── */
export const LoginBodySchema = z
  .object({
    email: z.string().min(3).max(320),
    // el máximo real (256 caracteres) lo aplica platform-auth; acá solo se corta lo absurdo
    password: z.string().min(1).max(1024),
  })
  .strict();

export const MeResponseSchema = z.object({
  user: z.object({ id: z.string().uuid(), name: z.string(), email: z.string(), organization: z.string() }),
  roles: z.array(z.enum(['OPERATOR', 'INTERNAL_APPROVER', 'ADMIN', 'EXTERNAL_APPROVER'])),
  externalContractIds: z.array(z.string().uuid()),
  /** Token para `X-CSRF-Token` en toda mutación. null fuera de una sesión (provider DEV). */
  csrfToken: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
});

/* ── approval (C2, §17–20, §30) ─────────────────────────────────────── */
const Uuid = z.string().uuid();
const IsoDate = z.string().datetime();

export const VersionParamsSchema = z.object({ id: Uuid }).strict();
export const EvidenceParamsSchema = z.object({ id: Uuid, evidenceId: Uuid }).strict();
export const ContractParamsSchema = z.object({ id: Uuid }).strict();

/** Idempotency-Key obligatoria en evidencia, approve y reject (§28). */
export const IdempotencyHeadersSchema = UploadHeadersSchema;

export const EvidenceFieldsSchema = z.object({ type: z.enum(['EMAIL', 'PDF', 'MESSAGE', 'OTHER']) }).strict();

/** El cliente cita el hash que vio: la decisión es sobre la versión EXACTA. Nada de contractId: el scope lo deriva el backend. */
export const ApproveBodySchema = z.object({ evidenceId: Uuid, versionHash: Sha }).strict();
export const RejectBodySchema = z.object({ reason: z.string().trim().min(1).max(2000), versionHash: Sha }).strict();
export const FourEyesBodySchema = z.object({ fourEyesRequired: z.boolean() }).strict();

export const EvidenceResponseSchema = z.object({
  id: Uuid,
  showVersionId: Uuid,
  type: z.enum(['EMAIL', 'PDF', 'MESSAGE', 'OTHER']),
  originalFilename: z.string(),
  mimeType: z.enum(['application/pdf', 'message/rfc822', 'text/plain', 'image/png', 'image/jpeg']),
  sizeBytes: z.number().int().positive(),
  sha256: Sha,
  uploadedBy: Uuid,
  uploadedAt: IsoDate,
});

export const ShowVersionResponseSchema = z.object({
  id: Uuid,
  campaignId: Uuid,
  contractId: Uuid,
  versionNumber: z.number().int().positive(),
  versionHash: Sha,
  hashAlgorithm: z.literal('sha256'),
  canonicalizationVersion: z.string(),
  hashEnvelopeVersion: z.number().int().positive(),
  showPackageSchemaVersion: z.number().int().positive(),
  compilerVersion: z.string(),
  sourceDraftId: Uuid,
  sourceDraftRevision: z.number().int().positive(),
  submittedBy: Uuid,
  submittedAt: IsoDate,
  status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']),
  fourEyesRequired: z.boolean(),
  approval: z
    .object({
      id: Uuid,
      decision: z.enum(['APPROVED', 'REJECTED']),
      actorUserId: Uuid,
      evidenceId: Uuid.nullable(),
      reason: z.string().nullable(),
      versionHash: Sha,
      createdAt: IsoDate,
    })
    .nullable(),
  evidence: z.array(EvidenceResponseSchema),
  assets: z.array(z.object({ logicalRef: z.string(), assetId: Uuid, sha256: Sha })),
});

export const FourEyesResponseSchema = z.object({ contractId: Uuid, fourEyesRequired: z.boolean(), changed: z.boolean() });
