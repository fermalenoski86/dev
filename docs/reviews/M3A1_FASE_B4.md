# M3A.1 — Fase B4: Fastify API, health/readiness, seguridad, E2E API — entrega final de Fase B

**Estado:** entregado para auditoría. **Fase C no iniciada.** B1/B1.1, B2 y B3
sin cambios de arquitectura; M2C.2 sin tocar.

**Rama:** `fase/m3a1-b4` · PR #5 contra `main` (B3 ya mergeada en `decbb00`;
la rama integra ese squash en `d9eb28e`, así que el diff muestra solo B4).

**CI independiente sobre `d9eb28e`:** verify-build, postgres, media, mutations y
e2e-m2c en verde — https://github.com/fermalenoski86/dev/actions/runs/37595789039

## Resultados (ejecución real, 2026-10-07, este entorno)

Node 22.22.0 · pnpm 12.5.1 · PostgreSQL 16.15 · ffmpeg 6.1.1. Salida completa en
`M3A1_FASE_B4_SALIDA.txt`.

| Gate | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK (fastify 5.6.1, @fastify/multipart 9.2.1, tsx 4.20.6) |
| `pnpm verify` | **621 passed + 1 skipped**, lint 0 errores (11 warnings preexistentes) |
| `pnpm build` | exit 0 |
| PostgreSQL 16 real | **110 passed + 6 skipped** (B4 API: 23) |
| Bootstrap | 6/6 |
| Media real | **63/63** (B4: 10 recetas de remediación con ffmpeg real) |
| Smoke con curl real contra `createServer()` | READY 201 · replay 200 · REJECTED 422 · sin actor 401 |
| Mutaciones | **129/129 ATRAPADAS** (121 previas + 8 de B4); job `mutations` del CI verde |
| E2E M2C | no ejecutado verde acá (sin Chrome H.264); job `e2e-m2c` del CI verde sobre `d9eb28e` |
| S3/MinIO, Docker Compose | **no ejecutados** (sin MinIO ni Docker) |

## Criterio de aceptación de Fase B (§42)

| # | Criterio | Evidencia |
|---|---|---|
| 1 | subir MP4 real | API: "MP4 válido → 201", "upload por HTTP real"; smoke curl |
| 2 | no se carga entero en RAM | stream multipart → `limitBody` → `putTemporary` (hash incremental); HTTP real con `Blob` desde disco |
| 3 | SHA-256 real | B3: sha del blob = sha del archivo; API devuelve `sha256` |
| 4 | ffprobe | B2/B3 reales |
| 5 | decode de frame | B2/B3 reales; `corrupt_frames` → `ASSET_CORRUPT` |
| 6 | formato según EL_TRUST | validator + `surfaceType` contra `deriveSurfaceFormats`; remediación también |
| 7 | content-addressed | B3: `storage_key = sha256/<2>/<64>` |
| 8 | Asset READY | API 201 + `GET /:id` |
| 9 | dedup | B3: secuencial y simultáneo, 1 StoredObject y 1 archivo |
| 10 | REJECTED con causa exacta | API 422/415/413 con `code` exacto, `details.asset` y remediación |
| 11 | sin temporales basura | B3: tmp y scratch vacíos tras cada caso |
| 12 | retries HTTP no duplican | API: replay 200 con el mismo id y mismo count; 409 con otro contenido |
| 13 | contratos Zod | toda respuesta pasa por `schema.parse`; los tests validan con los mismos schemas |
| 14 | audit de transiciones | B3: secuencia exacta por Asset + `verifyChain` |
| 15 | M2C.2 sin regresión | CI `e2e-m2c` sobre el HEAD; sin diff en `apps/control`, `e2e/`, `experience-core`, `trust-3d` |

## Decisiones (para validar)

1. **Una sola solicitud multipart** (no `uploads`+`finalize`): la idempotencia
   por contenido de B3 lo cubre; sin estado intermedio que limpiar.
2. **Idempotency-Key obligatoria** en el upload (400 si falta).
3. **HTTP por resultado:** 413 TOO_LARGE, 415 BAD_CONTAINER, 503
   STORAGE_ERROR/INSPECTION_TIMEOUT, 422 el resto; el cuerpo de un rechazo es
   el contrato de error con el Asset en `details.asset` (así el cliente tiene el id).
4. **Replay = 200** con `Idempotent-Replayed: true` (el original fue 201).
5. **Visibilidad por creador** hasta Fase C; lo ajeno es 404.
6. **Readiness** no lanza procesos: los binarios se verifican una vez al arrancar.
7. **`createServer` se niega** en producción y sin `TRUST_DEV_ACTOR_PROVIDER=enabled`.
8. **BL-03** como `rejection.remediation`, calculado al leer (no se guarda): si la
   autoridad cambia, cambia la sugerencia sin migrar datos.
9. **`fixtures.ts` con `import.meta.url`** (antes `__dirname`): el paquete es ESM y el smoke lo importa con tsx.

## No hecho a propósito

Auth real, roles, Campaign API, Builder sync (Fase C+). Docker Compose
preparado, no ejecutado. S3/MinIO no ejecutado.

## Propuestas de mejora (≤ 3)

- **BL-10 · Límite de tasa por actor en el upload.** Hoy nada impide que un
  actor sature la cola de inspección (concurrencia 2) con uploads grandes.
  Propuesta: límite por actor (p. ej. N uploads en curso) con 429 y
  `Retry-After`. Prioridad media, ~0,5 día; depende de Fase C para el actor
  real. Criterio: test con N+1 uploads simultáneos del mismo actor → uno 429.
- **BL-11 · OpenAPI generado desde los schemas Zod.** Los contratos ya existen;
  generar `openapi.json` en el build y un test que falle si difiere del
  comprometido. ~0,5 día. Criterio: diff vacío en CI; las agencias o el Builder
  consumen el contrato sin leer código.

Sobre las ideas de Fer: la idea 1 (diagnóstico operativo) ya tiene base en
`/ready` con chequeos separados; BL-07/BL-08 completarían la vista operativa.
