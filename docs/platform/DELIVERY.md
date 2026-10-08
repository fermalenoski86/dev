# DELIVERY — inventario de entrega de platform-api

> Generado por `pnpm docs:contract` (`apps/platform-api/src/delivery.ts`). No editar a mano:
> el test `contract.db.test.ts` exige diff vacío contra lo generado.

Contrato HTTP: [`openapi.json`](openapi.json) (OpenAPI 3.1, mismo origen). Modelo de datos: [ERD.md](ERD.md).
Errores, idempotencia y límites: [API.md](API.md). Backups y restauración: [../ops/BACKUPS.md](../ops/BACKUPS.md).

## Rutas (27, del registro de Fastify)

| Método | Ruta | Roles | CSRF | Idempotency-Key | Respuestas |
|---|---|---|---|---|---|
| GET | `/health` | pública | — | — | 200 |
| GET | `/ready` | pública | — | — | 200, 503 |
| POST | `/api/v1/auth/login` | pública | — | — | 200 |
| POST | `/api/v1/auth/logout` | cualquier sesión | sí | — | 204 |
| GET | `/api/v1/auth/me` | cualquier sesión | — | — | 200 |
| GET | `/api/v1/show-versions/:id` | OPERATOR, INTERNAL_APPROVER, ADMIN, EXTERNAL_APPROVER | — | — | 200 |
| POST | `/api/v1/show-versions/:id/evidence` | INTERNAL_APPROVER, EXTERNAL_APPROVER | sí | sí | 200, 201 |
| GET | `/api/v1/show-versions/:id/evidence/:evidenceId` | OPERATOR, INTERNAL_APPROVER, ADMIN, EXTERNAL_APPROVER | — | — | 200 |
| POST | `/api/v1/show-versions/:id/approve` | INTERNAL_APPROVER, EXTERNAL_APPROVER | sí | sí | 200, 201 |
| POST | `/api/v1/show-versions/:id/reject` | INTERNAL_APPROVER, EXTERNAL_APPROVER | sí | sí | 200, 201 |
| POST | `/api/v1/campaigns/:id/submit` | OPERATOR, ADMIN | sí | sí | 200, 201 |
| PUT | `/api/v1/contracts/:id/four-eyes` | ADMIN | sí | — | 200 |
| POST | `/api/v1/advertisers` | ADMIN | sí | — | 201 |
| GET | `/api/v1/advertisers` | OPERATOR, INTERNAL_APPROVER, ADMIN | — | — | 200 |
| POST | `/api/v1/contracts` | ADMIN | sí | — | 201 |
| GET | `/api/v1/contracts` | OPERATOR, INTERNAL_APPROVER, ADMIN | — | — | 200 |
| GET | `/api/v1/contracts/:id` | OPERATOR, INTERNAL_APPROVER, ADMIN | — | — | 200 |
| PATCH | `/api/v1/contracts/:id` | ADMIN | sí | — | 200 |
| POST | `/api/v1/campaigns` | OPERATOR, ADMIN | sí | — | 201 |
| GET | `/api/v1/campaigns` | OPERATOR, INTERNAL_APPROVER, ADMIN | — | — | 200 |
| GET | `/api/v1/campaigns/:id` | OPERATOR, INTERNAL_APPROVER, ADMIN | — | — | 200 |
| GET | `/api/v1/campaigns/:id/draft` | OPERATOR, INTERNAL_APPROVER, ADMIN | — | — | 200 |
| PUT | `/api/v1/campaigns/:id/draft` | OPERATOR, ADMIN | sí | — | 200 |
| POST | `/api/v1/assets` | OPERATOR, ADMIN | sí | sí | 200, 201 |
| GET | `/api/v1/assets/:id` | OPERATOR, ADMIN | — | — | 200 |
| GET | `/api/v1/assets/:id/status` | OPERATOR, ADMIN | — | — | 200 |
| GET | `/api/v1/assets` | OPERATOR, ADMIN | — | — | 200 |

## Migraciones (3)

- `0001_initial` (reversible)
- `0002_asset_pipeline` (reversible)
- `0003_approval` (reversible)

## Archivos de test (60)

| Archivo | Suite |
|---|---|
| `apps/platform-api/src/api.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `apps/platform-api/src/approval.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `apps/platform-api/src/auth.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `apps/platform-api/src/builder-repository.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `apps/platform-api/src/campaigns.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `apps/platform-api/src/cli/user-create.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `apps/platform-api/src/contract.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `apps/platform-api/src/logs-sin-secretos.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `apps/platform-api/src/restore-drill.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `apps/platform-api/src/submit.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `apps/platform-api/src/upload-limits.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `e2e/builder.spec.ts` | E2E (Playwright, CI) |
| `e2e/experience.spec.ts` | E2E (Playwright, CI) |
| `packages/builder-repository/src/repository.test.ts` | Unidad (`pnpm verify`) |
| `packages/control-core/src/control-core.test.ts` | Unidad (`pnpm verify`) |
| `packages/control-core/src/m2a2.test.ts` | Unidad (`pnpm verify`) |
| `packages/control-core/src/m2a3.test.ts` | Unidad (`pnpm verify`) |
| `packages/experience-core/src/composition.test.ts` | Unidad (`pnpm verify`) |
| `packages/experience-core/src/experience.test.ts` | Unidad (`pnpm verify`) |
| `packages/experience-core/src/masters.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-approval/src/detect.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-assets/src/filename.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-assets/src/limited-body.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-assets/src/upload.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `packages/platform-audit/src/audit.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `packages/platform-auth/src/auth.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `packages/platform-auth/src/rate-limit.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-campaigns/src/surfaces.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-contracts/src/building-capabilities.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-contracts/src/canonical.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-contracts/src/versions.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-db/src/approval-schema.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `packages/platform-db/src/asset-consistency.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `packages/platform-db/src/bootstrap.smoke.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `packages/platform-db/src/idempotency.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `packages/platform-db/src/idempotency.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-db/src/schema.db.test.ts` | PostgreSQL (`vitest.platform.config.ts`) |
| `packages/platform-media/src/limiter.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-media/src/media.real.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-media/src/process.real.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-media/src/rational.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-media/src/remediation.real.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-media/src/remediation.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-media/src/validator.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-storage/src/local-disk.test.ts` | Unidad (`pnpm verify`) |
| `packages/platform-storage/src/s3.contract.test.ts` | Unidad (`pnpm verify`) |
| `packages/show-authoring/src/artifacts.test.ts` | Unidad (`pnpm verify`) |
| `packages/show-authoring/src/authoring.test.ts` | Unidad (`pnpm verify`) |
| `packages/show-authoring/src/preview-session.test.ts` | Unidad (`pnpm verify`) |
| `packages/show-engine/src/compile.test.ts` | Unidad (`pnpm verify`) |
| `packages/show-engine/src/fades.test.ts` | Unidad (`pnpm verify`) |
| `packages/show-engine/src/groups.test.ts` | Unidad (`pnpm verify`) |
| `packages/show-engine/src/playback.test.ts` | Unidad (`pnpm verify`) |
| `packages/show-engine/src/preflight.test.ts` | Unidad (`pnpm verify`) |
| `packages/show-engine/src/resolve.test.ts` | Unidad (`pnpm verify`) |
| `packages/show-engine/src/shows.test.ts` | Unidad (`pnpm verify`) |
| `packages/telemetry/src/lifecycle.test.ts` | Unidad (`pnpm verify`) |
| `packages/telemetry/src/telemetry.test.ts` | Unidad (`pnpm verify`) |
| `packages/timeline/src/transport.test.ts` | Unidad (`pnpm verify`) |
| `packages/trust-3d/src/MediaTextureManager.test.ts` | Unidad (`pnpm verify`) |

## Variables de entorno (32, de `.env.example`)

`TRUST_PG_ADMIN_URL` · `TRUST_PG_OWNER_PASSWORD` · `TRUST_PG_APP_PASSWORD` · `DATABASE_URL` · `STORAGE_DRIVER` · `LOCAL_STORAGE_ROOT` · `S3_ENDPOINT` · `S3_REGION` · `S3_BUCKET` · `S3_ACCESS_KEY` · `S3_SECRET_KEY` · `S3_FORCE_PATH_STYLE` · `S3_TEST_ENDPOINT` · `MAX_UPLOAD_BYTES` · `MAX_EVIDENCE_BYTES` · `MEDIA_PROBE_TIMEOUT_MS` · `MEDIA_DECODE_TIMEOUT_MS` · `TEMP_OBJECT_TTL_MS` · `MEDIA_INSPECTION_CONCURRENCY` · `MEDIA_SCRATCH_DIR` · `FFPROBE_PATH` · `FFMPEG_PATH` · `UPLOAD_MAX_CONCURRENT_PER_ACTOR` · `UPLOAD_MAX_PER_MINUTE_PER_ACTOR` · `HOST` · `PORT` · `LOG_LEVEL` · `NODE_ENV` · `TRUST_SESSION_TTL_MINUTES` · `TRUST_COOKIE_SECURE` · `TRUST_PROXY_HOPS` · `EXTERNAL_APPROVAL_ENABLED`
