import { VERSION_PAGE_DEFAULT, VERSION_PAGE_MAX } from '@trust/platform-approval';
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

/** OTHER existe en el modelo (§19) pero no está habilitado en C2: no hay un tipo inerte validado (auditoría C2 #1). */
export const EvidenceFieldsSchema = z.object({ type: z.enum(['EMAIL', 'PDF', 'MESSAGE']) }).strict();

/** El cliente cita el hash que vio: la decisión es sobre la versión EXACTA. Nada de contractId: el scope lo deriva el backend. */
export const ApproveBodySchema = z.object({ evidenceId: Uuid, versionHash: Sha }).strict();
export const RejectBodySchema = z.object({ reason: z.string().trim().min(1).max(2000), versionHash: Sha }).strict();
/** C3: el cliente cita la revisión del draft que vio (concurrencia optimista). */
export const SubmitBodySchema = z.object({ draftRevision: z.number().int().min(1) }).strict();
export const CampaignParamsSchema = z.object({ id: Uuid }).strict();
export const FourEyesBodySchema = z.object({ fourEyesRequired: z.boolean() }).strict();

export const EvidenceResponseSchema = z.object({
  id: Uuid,
  showVersionId: Uuid,
  type: z.enum(['EMAIL', 'PDF', 'MESSAGE', 'OTHER']),
  originalFilename: z.string(),
  mimeType: z.enum(['application/pdf', 'message/rfc822', 'text/plain']),
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

/* ── BL-31: historial de versiones por campaña ─────────────────────── */
export const VersionListQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(VERSION_PAGE_MAX).default(VERSION_PAGE_DEFAULT), cursor: Uuid.optional() })
  .strict();
/** Resumen mínimo: sin paquete, evidencia, contrato ni quién envió/decidió. */
export const VersionSummaryResponseSchema = z
  .object({
    id: Uuid,
    versionNumber: z.number().int().positive(),
    versionHash: Sha,
    status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']),
    sourceDraftRevision: z.number().int().positive(),
    submittedAt: IsoDate,
  })
  .strict();

export const FourEyesResponseSchema = z.object({ contractId: Uuid, fourEyesRequired: z.boolean(), changed: z.boolean() });

/* ── campaigns y drafts (D1, §5–9, §30) ─────────────────────────────── */
const Texto = (max: number) => z.string().trim().min(1).max(max);
export const IdParamsSchema = z.object({ id: Uuid }).strict();
export const ListQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: Uuid.optional(), advertiserId: Uuid.optional(), contractId: Uuid.optional() })
  .strict();

export const AdvertiserBodySchema = z
  .object({
    legalName: Texto(200),
    taxId: Texto(32),
    commercialName: Texto(200).nullable().optional(),
    contacts: z.array(z.object({ name: Texto(200), email: z.string().email().max(320).optional(), phone: z.string().max(40).optional(), role: z.string().max(100).optional() }).strict()).max(20).optional(),
  })
  .strict();

const ContractStatus = z.enum(['DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED']);
const Metadata = z.record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).refine((m) => Object.keys(m).length <= 50, 'máximo 50 claves');
export const ContractBodySchema = z
  .object({
    advertiserId: Uuid,
    name: Texto(200),
    startsAt: IsoDate,
    endsAt: IsoDate,
    status: ContractStatus.optional(),
    allowedSurfaces: z.array(z.string().min(1).max(64)).min(1).max(20),
    externalApprovalEnabled: z.boolean().optional(),
    metadata: Metadata.optional(),
  })
  .strict();
export const ContractPatchSchema = ContractBodySchema.omit({ advertiserId: true }).partial().strict();

export const CampaignBodySchema = z.object({ contractId: Uuid, name: Texto(200), takeoverDraft: z.unknown().optional() }).strict();
/** §8: toda actualización lleva expectedRevision. El draft lo valida el servicio con TakeoverDraftSchema. */
export const DraftPutBodySchema = z.object({ takeoverDraft: z.unknown(), expectedRevision: z.number().int().min(1) }).strict();

export const AdvertiserResponseSchema = z.object({
  id: Uuid, legalName: z.string(), taxId: z.string(), commercialName: z.string().nullable(), contacts: z.array(z.unknown()),
  status: z.enum(['ACTIVE', 'INACTIVE']), createdAt: IsoDate, updatedAt: IsoDate,
});
export const ContractResponseSchema = z.object({
  id: Uuid, advertiserId: Uuid, name: z.string(), startsAt: IsoDate, endsAt: IsoDate, status: ContractStatus,
  allowedSurfaces: z.array(z.string()), fourEyesRequired: z.boolean(), externalApprovalEnabled: z.boolean(),
  metadata: z.record(z.string(), z.unknown()), createdAt: IsoDate, updatedAt: IsoDate,
});
export const CampaignResponseSchema = z.object({
  id: Uuid, contractId: Uuid, name: z.string(), lifecycleStatus: z.enum(['ACTIVE', 'ARCHIVED']),
  currentDraft: z.object({ id: Uuid, revision: z.number().int().positive(), updatedAt: IsoDate }).nullable(),
  latestApprovedVersion: z.object({ id: Uuid, versionNumber: z.number().int().positive(), versionHash: Sha }).nullable(),
  createdAt: IsoDate, updatedAt: IsoDate,
});
export const DraftResponseSchema = z.object({
  campaignId: Uuid, draftId: Uuid, revision: z.number().int().positive(), updatedAt: IsoDate, takeoverDraft: z.record(z.string(), z.unknown()),
});
export const pageOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), nextCursor: Uuid.nullable() });
