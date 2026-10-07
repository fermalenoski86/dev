# M3A.1 — Fase B3: AssetUploadService + DB integration — checkpoint

**Estado:** entregado para auditoría. **B4 (API) no iniciado.** Storage B1/B1.1
sin cambios de arquitectura; M2C.2 sin tocar.

**Rama:** `fase/m3a1-b3`, apilada sobre `fix/m3a1-b2-audit1` (PR #2, aprobado y
todavía sin mergear: ver "Bloqueo" abajo). El PR apunta a esa rama para que el
diff muestre solo B3.

## Resultados (ejecución real, 2026-10-07, este entorno)

Node 22.22.0 · pnpm 12.5.1 · PostgreSQL 16.15 · ffmpeg 6.1.1. Salida completa:
`M3A1_FASE_B3_SALIDA.txt`.

| Gate | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK (lockfile al día con el paquete nuevo) |
| `pnpm verify` (lint + typecheck + suite default) | exit 0 · **611 passed + 1 skipped** · lint 0 errores (11 warnings preexistentes) |
| `pnpm build` | exit 0 |
| PostgreSQL 16 real (`vitest.platform.config.ts`) | **86 passed + 6 skipped** (los 6 = bootstrap, corren por script) |
| ↳ B3 pipeline (PG + LocalDisk + ffprobe/ffmpeg reales) | 28/28 |
| ↳ B3 consistencia READY ↔ StoredObject (0002) | 10/10 |
| Bootstrap real (`bootstrap-smoke.sh`) | 6/6 |
| Media real (`vitest.media.config.ts`) | 53/53 |
| Mutaciones (`mutation-check.py`, corrida completa) | **120/120 atrapadas** (109 previas + 11 de B3) · autoprueba OK · árbol limpio después |
| E2E M2C congelado | **13/14 en este entorno — NO cuenta como gate verde.** Ver abajo. |

### E2E M2C: qué pasó, sin maquillaje

Este entorno no tiene Google Chrome (el proxy bloquea dl.google.com) y el
Chromium de Playwright no trae H.264 (14 tests en LOADING). Con el Chromium de
`@sparticuz/chromium` (153) pasan 13/14; falla siempre
`CRITERIO: las pantallas pintan frames reales durante todo el takeover`
(`signature screen_a: dejó de pintar`, framesDrawn 3 vs > 108).

**La misma falla se reproduce idéntica sobre el código aprobado de B2**
(`origin/fix/m3a1-b2-audit1`, worktree limpio, build propio). B3 no toca
`apps/`, `e2e/`, `experience-core` ni `trust-3d` (`git diff --stat` vacío).
Es el navegador de este entorno, no B3. El gate E2E queda para el job
`e2e-m2c` del CI (Google Chrome del runner), que fue verde en B2.

## Qué se implementó

| Brief | Implementación | Evidencia |
|---|---|---|
| §5 pipeline | `AssetUploadService.upload()` | test happy path: READY, metadata, blob = bytes subidos |
| §6 streaming | `putTemporary` + `HashingCounter`, corte en `MAX_UPLOAD_BYTES` | `ASSET_TOO_LARGE` con límite 4096, temporal borrado |
| §7 filename | `normalizeOriginalFilename` / `displayFilename` / `contentDispositionFor` | 15 tests unitarios + 6 nombres hostiles end-to-end |
| §14 consistencia | trigger `assets_transition_ready` (0002) | sha/tamaño/MIME/objeto ausente → rechazados por PostgreSQL |
| §15/§32 dedup | `link()` atómico + `ON CONFLICT (sha256)` | secuencial y **simultáneo**: 1 StoredObject, 1 archivo |
| §16/§33 atomicidad | ver `docs/platform/ASSETS.md` | falla REAL de PostgreSQL tras el commit de storage → retry recupera |
| §17 rechazos | `rejection_code` cerrado + `rejection_detail jsonb` | constraint + test que compara con `AssetRejectionCodeSchema` |
| §20 idempotencia | `withIdempotency` con fingerprint que incluye sha256 | replay, 409 con mismo tamaño y un byte distinto, retries simultáneos |
| §25 housekeeping | `cleanupTemporaryObjects` (B1) | test: borra temporales, nunca blobs finales |
| §27 audit | `ASSET_UPLOADED`, `ASSET_VALIDATION_STARTED`, `ASSET_VALIDATED`, `ASSET_REJECTED` | secuencia exacta por asset + `verifyChain` ok |
| §31 tests pipeline | `upload.db.test.ts` | 9 rechazos con código exacto, sin StoredObject ni blob ni temporal |
| §40 mutaciones | 11 reglas nuevas | hash ignorado, dedup off, temp no limpiado, REJECTED→READY, BAD_RESOLUTION, corrupto, READY sin objeto, sha/tamaño ajeno, terminal sin detail, tempId desde filename |

Archivos: `packages/platform-assets/` (nuevo), `packages/platform-db/src/migrations/0002_asset_pipeline.ts`,
`asset-consistency.db.test.ts`, `schema.ts`, `fixtures.ts`, `testing.ts`, `migrator.ts`;
`platform-audit` (acción `ASSET_VALIDATION_STARTED`); `platform-media/package.json`
(export `./fixtures`); `scripts/mutation-check.py`; `.github/workflows/gates.yml`
(ffmpeg en el job de PostgreSQL; PostgreSQL en el de mutaciones); docs.

## Decisiones tomadas (para validar en la auditoría)

1. **El Asset se crea después del stream**, no antes (el brief lista lo
   contrario). Motivo: el fingerprint de idempotencia necesita el sha256 del
   contenido; creando antes, cada retry HTTP crearía un Asset. El estado
   UPLOADING existe y se audita, pero dura una transacción.
2. **Fallo de infraestructura ≠ rechazo.** ffmpeg ausente, cancelación o base
   caída → excepción; el Asset queda no terminal (VALIDATING). Un archivo
   válido no queda REJECTED por culpa nuestra. Fallo de integridad del storage
   → `ASSET_STORAGE_ERROR` (es el código del brief para eso).
3. **Vacío y TOO_LARGE se rechazan desde UPLOADING** (sin pasar por
   VALIDATING): no hay nada que validar. Audit: `UPLOADED → REJECTED`.
4. **La consistencia READY ↔ StoredObject la hace cumplir PostgreSQL**, no solo
   la app (trigger + constraint). El trigger corre después de
   `assets_transition` para que una transición inválida se siga informando como tal.
5. **Blob huérfano tras fallo de la base: se deja.** Es content-addressed y
   seguro; borrarlo podría romper a otro Asset que lo use. La reconciliación
   (reporte de blobs sin StoredObject) queda propuesta (BL-08).
6. **`rejection_code` como lista cerrada en la base**, duplicada a propósito en
   la migración (una migración no importa código que puede cambiar); un test
   exige que coincida con `platform-contracts`.
7. **Harness de tests:** el pool ignora solo `57P01` (el `DROP DATABASE … WITH
   (FORCE)` del teardown). Apareció 1 vez en 4 corridas como "unhandled error"
   con todos los tests verdes; cualquier otro error del pool sigue siendo fatal.

## No hecho a propósito

- API Fastify, health/readiness, E2E API: **B4**.
- BL-03 (remediación en rechazos): va en B4, donde el cliente ve el rechazo.
- S3/MinIO: no ejecutado (sin MinIO en el entorno), como en B1/B2.

## Bloqueo de proceso (no de código)

El merge del PR #2 (aprobado) fue **denegado por los permisos de este entorno**
(merge desde un agente). Por eso no se cerró el issue #1 ni se etiquetó
`m3a1-b2`, y B3 está apilada sobre la rama de #2. Hace falta que Fer (o quien
tenga permiso) mergee #2; el PR de B3 se re-apunta a `main` después.

## Propuestas de mejora (≤ 3, observadas en esta fase)

Sin fuente externa: las tres salen de evidencia de este repo.

- **BL-07 · Assets no terminales vencidos.** Problema: tras un fallo de
  infraestructura (decisión 2) queda un Asset VALIDATING para siempre.
  Propuesta: `reapStaleAssets(olderThanMs)` → REJECTED con un código nuevo
  `ASSET_PROCESSING_ABANDONED` (cambio de contrato: requiere acuerdo) o un
  reporte operativo sin transición. Prioridad media, ~0,5 día. Criterio: un
  Asset VALIDATING con `updated_at` > TTL aparece en el reporte / termina
  REJECTED con audit; uno reciente no se toca.
- **BL-08 · Reporte de blobs huérfanos.** Problema: decisión 5. Propuesta:
  comando que lista blobs `sha256/…` sin StoredObject más viejos que un período
  de gracia; **solo reporta**, no borra. ~0,5 día. Criterio: test con un
  huérfano real (el de §33) y un blob con StoredObject: solo el primero aparece.
- **BL-09 · E2E M2C reproducible fuera de GitHub.** Problema: en este entorno y
  en el del auditor no hay Chrome con H.264; el gate E2E depende del runner.
  Propuesta: documentar y fijar en `e2e/README.md` el navegador exacto que
  sirve (o un contenedor con Chrome) y por qué el test de frames falla con
  Chromium 153 headless. ~0,5 día de investigación. Criterio: un comando
  documentado que da 14/14 en un entorno limpio sin GitHub.

Sobre las ideas de Fer (diagnóstico operativo, ensayo de escenas, rollback):
mi evaluación sigue la registrada en `docs/collab/BACKLOG.md`; B3 suma un
insumo para la idea 1 (estados no terminales y huérfanos medibles: BL-07/BL-08).
