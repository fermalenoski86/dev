# PROGRESO — reporte verificable por pista

> Generado por `pnpm progress:generate` desde `scripts/collab/entregables.mjs` (P-02). No editar a mano:
> CI corre `pnpm progress:check` y falla si este archivo no coincide con lo generado.
> No es un archivo de memoria: es un reporte derivado de datos que se pueden comprobar.

**Cómo leerlo.** Cada entregable tiene tres columnas independientes; ninguna implica otra:
`código` = PR mergeado en `main` con comentario `AUDIT: APROBADO` enlazado (sin AUDIT no cuenta);
`probado simulado` = tests que CI corre, citados por archivo (un test acredita solo lo que prueba);
`probado con equipo real` = evidencia física con referencia, condiciones, fecha y responsable (nunca se marca desde el repo solo).
Solo conteos `n/N` por pista y columna; **no hay porcentaje global**. `0/0` significa que todavía no hay entregables definidos, que no es lo mismo que `0/N` (definidos y pendientes).
Los briefs aprobados y las herramientas de proceso se listan al final y **no cuentan** como funcionalidad.

## Resumen por pista

| Pista | Entregables definidos | Código (PR + AUDIT) | Probado simulado | Probado con equipo real |
|---|---|---|---|---|
| Software de gestión (plataforma + platform-web) | 24 | 21/24 | 24/24 | 0/24 |
| Integración NovaStar / procesador LED | **0/0 — entregables todavía no definidos** | — | — | — |
| DMX / Art-Net / iluminación | **0/0 — entregables todavía no definidos** | — | — | — |
| Reloj / cúpula | **0/0 — entregables todavía no definidos** | — | — | — |
| Hardware físico e instalación | **0/0 — entregables todavía no definidos** | — | — | — |

**Equipo real: 0/24 en todo el repo.** Nada de lo listado se probó con el procesador LED, las pantallas, la iluminación ni el reloj reales; todo lo verde de arriba es software probado en simulación/CI.

## Software de gestión (plataforma + platform-web)

Código 21/24 · Probado simulado 24/24 · Probado con equipo real 0/24

| Id | Entregable | Brief / referencia | Código (PR + AUDIT) | Probado simulado | Probado con equipo real |
|---|---|---|---|---|---|
| M2C | CREATE (Takeover Builder, compiler) y PLAY (ShowEngine); M2C.2 congelado | `docs/architecture/FREEZE_M2C2.md` | ✗ entregado antes de que existiera el repo en GitHub (2026-10-06); auditado en chat, sin PR ni AUDIT enlazable | ✔ §48: 19 · verify-build: `show-engine/compile.test.ts`, `show-engine/preflight.test.ts`, `show-engine/playback.test.ts`, `show-authoring/authoring.test.ts` · e2e-m2c: `e2e/experience.spec.ts`, `e2e/builder.spec.ts` | — sin evidencia |
| M3A1-A | Fases A/A.1: esquema relacional (migración 0001), roles mínimos, ShowVersion inmutable, cuatro ojos por contrato, auditoría encadenada | `docs/briefs/M3A1_FASE_A1.md` | ✗ entregado antes de que existiera el repo en GitHub (2026-10-06); auditado en chat, sin PR ni AUDIT enlazable | ✔ postgres: `platform-db/schema.db.test.ts`, `platform-audit/audit.db.test.ts` · §48: 10, 17, 18 | — sin evidencia |
| M3A1-B1 | Fases B1/B1.1: almacenamiento content-addressed (disco local y S3 compatible) con contrato de tests compartido | `docs/briefs/M3A1_FASE_B.md` | ✗ entregado antes de que existiera el repo en GitHub (2026-10-06); auditado en chat, sin PR ni AUDIT enlazable | ✔ verify-build: `platform-storage/local-disk.test.ts` · compose-smoke: `platform-storage/s3.contract.test.ts` | — sin evidencia |
| M3A1-B1-FIX | B1 · limpieza con TTL 0 compara mtime con resolución de ms (corrección) | `docs/reviews/M3A1_FIX_B1_CLEANUP.md` | ✔ [#12](https://github.com/fermalenoski86/dev/pull/12) `87591f0` · [AUDIT](https://github.com/fermalenoski86/dev/pull/12#issuecomment-6074016623) sobre `34dcf24` | ✔ verify-build: `platform-storage/local-disk.test.ts` | — sin evidencia |
| M3A1-B2 | Fase B2: inspección y validación de medios con ffprobe/ffmpeg reales, remediación y gate de mutaciones | `docs/briefs/M3A1_FASE_B2.md` | ✔ [#2](https://github.com/fermalenoski86/dev/pull/2) `5ba9f1a` · [AUDIT](https://github.com/fermalenoski86/dev/pull/2#issuecomment-6030654008) sobre `a35eb5b` | ✔ verify-build: `platform-media/validator.test.ts` · media: `platform-media/media.real.test.ts`, `platform-media/remediation.real.test.ts`, `platform-media/process.real.test.ts` · §48: 5 | — sin evidencia |
| M3A1-B3 | Fase B3: AssetUploadService, migración 0002, audit e idempotencia | `docs/briefs/M3A1_FASE_B.md` | ✔ [#3](https://github.com/fermalenoski86/dev/pull/3) `decbb00` · [AUDIT](https://github.com/fermalenoski86/dev/pull/3#issuecomment-6033692739) sobre `4e28768` | ✔ postgres: `platform-assets/upload.db.test.ts`, `platform-db/asset-consistency.db.test.ts`, `platform-db/idempotency.db.test.ts` · §48: 4, 6 | — sin evidencia |
| M3A1-B4 | Fase B4: platform-api (Fastify), health/readiness, errores y remediación | `docs/briefs/M3A1_FASE_B.md` | ✔ [#5](https://github.com/fermalenoski86/dev/pull/5) `0341d15` · [AUDIT](https://github.com/fermalenoski86/dev/pull/5#issuecomment-6037450237) sobre `3311097` | ✔ postgres: `platform-api/api.db.test.ts`, `platform-api/upload-limits.db.test.ts` | — sin evidencia |
| M3A1-C1 | Fase C1: autenticación, sesiones, roles y rate limit | `docs/briefs/M3A1_FASE_C.md` | ✔ [#7](https://github.com/fermalenoski86/dev/pull/7) `4ea6cbd` · [AUDIT](https://github.com/fermalenoski86/dev/pull/7#issuecomment-6043735018) sobre `8c4709a` | ✔ postgres: `platform-auth/auth.db.test.ts`, `platform-api/auth.db.test.ts` · verify-build: `platform-auth/rate-limit.test.ts` | — sin evidencia |
| M3A1-C2 | Fase C2: evidencia congelada y approve/reject con cuatro ojos (migración 0003) | `docs/briefs/M3A1_FASE_C.md` | ✔ [#8](https://github.com/fermalenoski86/dev/pull/8) `4a75fa4` · [AUDIT](https://github.com/fermalenoski86/dev/pull/8#issuecomment-6047750632) sobre `cf7f23e` | ✔ postgres: `platform-api/approval.db.test.ts`, `platform-db/approval-schema.db.test.ts` · verify-build: `platform-approval/detect.test.ts` · §48: 12, 13, 14 | — sin evidencia |
| M3A1-C3 | Fase C3: submit server-side sobre el Draft persistido (recompila, preflight, ShowVersion, hash determinista) | `docs/briefs/M3A1_FASE_C.md` | ✔ [#10](https://github.com/fermalenoski86/dev/pull/10) `053318d` · [AUDIT](https://github.com/fermalenoski86/dev/pull/10#issuecomment-6050622175) sobre `1e9e965` | ✔ postgres: `platform-api/submit.db.test.ts` · verify-build: `platform-contracts/canonical.test.ts` · §48: 7, 8, 9, 10, 11 | — sin evidencia |
| M3A1-D1 | Fase D1: API de Campaign y Draft con concurrencia optimista | `docs/briefs/M3A1_FASE_D.md` | ✔ [#16](https://github.com/fermalenoski86/dev/pull/16) `164f518` · [AUDIT](https://github.com/fermalenoski86/dev/pull/16#issuecomment-6055509787) sobre `14f0ca2` | ✔ postgres: `platform-api/campaigns.db.test.ts` · verify-build: `platform-campaigns/surfaces.test.ts` · §48: 1, 3, 15, 16 | — sin evidencia |
| M3A1-D2 | Fase D2: repositorio del Builder con offline y conflicto (§9, §31) | `docs/briefs/M3A1_FASE_D.md` | ✔ [#18](https://github.com/fermalenoski86/dev/pull/18) `f23f262` · [AUDIT](https://github.com/fermalenoski86/dev/pull/18#issuecomment-6061535285) sobre `d42bf12` | ✔ verify-build: `builder-repository/repository.test.ts`, `builder-repository/session.test.ts` · postgres: `platform-api/builder-repository.db.test.ts` · §48: 2 | — sin evidencia |
| M3A1-D3 | Fase D3: el Builder usa el CampaignRepository + indicador de versión (#15) | `docs/briefs/M3A1_FASE_D.md` | ✔ [#27](https://github.com/fermalenoski86/dev/pull/27) `2e39d3f` · [AUDIT](https://github.com/fermalenoski86/dev/pull/27#issuecomment-6076998058) sobre `66b1f44` | ✔ verify-build: `control/useBuilderStore.test.ts`, `control/builder/CampaignStatus.test.ts` · postgres: `platform-api/builder-d3.db.test.ts` | — sin evidencia |
| M3A1-E1 | Fase E1: hardening y entregables (BL-10, BL-11, §33 restore drill, §34 logs sin secretos, §35 compose + S3, §47) | `docs/briefs/M3A1_FASE_E.md` | ✔ [#23](https://github.com/fermalenoski86/dev/pull/23) `4c42e91` · [AUDIT](https://github.com/fermalenoski86/dev/pull/23#issuecomment-6075263530) sobre `2f30671` | ✔ postgres: `platform-api/restore-drill.db.test.ts`, `platform-api/logs-sin-secretos.db.test.ts`, `platform-db/bootstrap.smoke.db.test.ts`, `platform-api/contract.db.test.ts` · compose-smoke: `platform-storage/s3.contract.test.ts` | — sin evidencia |
| MEDIA-FIXTURES-FIX | Media · carrera del caché de fixtures entre workers paralelos (corrección) | `docs/reviews/FIX_MEDIA_FIXTURES_SALIDA.txt` | ✔ [#25](https://github.com/fermalenoski86/dev/pull/25) `0db8730` · [AUDIT](https://github.com/fermalenoski86/dev/pull/25#issuecomment-6071404533) sobre `df98ff9` | ✔ verify-build: `platform-media/fixtures.test.ts` | — sin evidencia |
| M3A1-E2 | Fase E2: E2E de plataforma por HTTP real + matriz de aceptación §48 ejecutable (BL-23) | `docs/briefs/M3A1_FASE_E.md` | ✔ [#29](https://github.com/fermalenoski86/dev/pull/29) `0234055` · [AUDIT](https://github.com/fermalenoski86/dev/pull/29#issuecomment-6080498773) sobre `ea635b1` | ✔ postgres: `platform-api/e2e-flow.db.test.ts` · verify-build: `scripts/acceptance/matrix.test.ts` · §48: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19 | — sin evidencia |
| M3A1-E3A | Fase E3a: apps/platform-web (login, campañas) directo a la API + CORS por allowlist | `docs/briefs/M3A1_FASE_E3.md` | ✔ [#34](https://github.com/fermalenoski86/dev/pull/34) `88f8a9a` · [AUDIT](https://github.com/fermalenoski86/dev/pull/34#issuecomment-6089938993) sobre `f8ff978` | ✔ verify-build: `platform-web/api.test.ts`, `platform-web/session.test.ts`, `platform-web/views.test.ts`, `platform-web/build-env.test.ts` · postgres: `platform-api/cors.db.test.ts`, `platform-api/platform-web-client.db.test.ts` | — sin evidencia |
| M3A1-E3B | Fase E3b: campaña, assets, envío y aprobación de cuatro ojos en platform-web | `docs/briefs/M3A1_FASE_E3.md` | ✔ [#36](https://github.com/fermalenoski86/dev/pull/36) `754d319` · [AUDIT](https://github.com/fermalenoski86/dev/pull/36#issuecomment-6091297474) sobre `24336db` | ✔ verify-build: `platform-web/views-e3b.test.ts`, `platform-web/api-e3b.test.ts`, `platform-web/draft-assets.test.ts` · postgres: `platform-api/platform-web-e3b.db.test.ts` | — sin evidencia |
| M3A1-E3C | Fase E3c: E2E Playwright de §41 en navegador (hosts HTTPS distintos, __Host-), evidencia §47 y matriz | `docs/briefs/M3A1_FASE_E3.md` | ✔ [#38](https://github.com/fermalenoski86/dev/pull/38) `cc6c4d8` · [AUDIT](https://github.com/fermalenoski86/dev/pull/38#issuecomment-6093558367) sobre `a233ee2` | ✔ navegador: E3-41, E3-47 · e2e-platform: `e2e-platform/flow-41.spec.ts`, `e2e-platform/session-multihost.spec.ts`, `e2e-platform/a11y.spec.ts` · verify-build: `scripts/e2e-platform/manifest.test.ts` | — sin evidencia |
| BL-31 | BL-31: historial de versiones por campaña (API + platform-web) | `docs/collab/BACKLOG.md` | ✔ [#42](https://github.com/fermalenoski86/dev/pull/42) `1db6944` · [AUDIT](https://github.com/fermalenoski86/dev/pull/42#issuecomment-6105271159) sobre `f8d129d` | ✔ postgres: `platform-api/versions-history.db.test.ts`, `platform-api/platform-web-bl31.db.test.ts` · verify-build: `platform-web/views-bl31.test.ts`, `platform-web/api-bl31.test.ts`, `platform-contracts/versions.test.ts` · e2e-platform: `e2e-platform/history.spec.ts` | — sin evidencia |
| BL-07 | BL-07: reporte read-only de Assets no terminales vencidos | `docs/collab/BACKLOG.md` | ✔ [#45](https://github.com/fermalenoski86/dev/pull/45) `e19ac23` · [AUDIT](https://github.com/fermalenoski86/dev/pull/45#issuecomment-6106041561) sobre `70d7456` | ✔ postgres: `platform-api/assets-stale-report.db.test.ts` | — sin evidencia |
| BL-08 | BL-08: reporte read-only de blobs huérfanos con período de gracia (cero borrados) | `docs/collab/BACKLOG.md` | ✔ [#48](https://github.com/fermalenoski86/dev/pull/48) `5f06eff` · [AUDIT](https://github.com/fermalenoski86/dev/pull/48#issuecomment-6106938699) sobre `9e0a1d0` | ✔ postgres: `platform-api/blobs-orphan-report.db.test.ts` | — sin evidencia |
| F3A | F3(a): versión vigente administrativa y rollback con cuatro ojos (migración 0004 + API) | `docs/briefs/F3A_REDEPLOY.md` | ✔ [#56](https://github.com/fermalenoski86/dev/pull/56) `8fae6fe` · [AUDIT](https://github.com/fermalenoski86/dev/pull/56#issuecomment-6113127134) sobre `20d6620` | ✔ postgres: `platform-api/active-version.db.test.ts`, `platform-db/active-version-schema.db.test.ts` | — sin evidencia |
| F3A-UI | F3(a) UI: versión vigente en platform-web (pedir / confirmar / cancelar con intención ante resultado incierto) | `docs/briefs/F3A_UI.md` | ✔ [#64](https://github.com/fermalenoski86/dev/pull/64) `2ee3551` · [AUDIT](https://github.com/fermalenoski86/dev/pull/64#issuecomment-6118661022) sobre `9830a07` | ✔ navegador: F3A-UI-1, F3A-UI-2, F3A-UI-3 · verify-build: `platform-web/views-f3a.test.ts`, `platform-web/api-f3a.test.ts` · postgres: `platform-api/platform-web-f3a.db.test.ts` · e2e-platform: `e2e-platform/active-version.spec.ts` | — sin evidencia |

## Integración NovaStar / procesador LED

**0/0 — entregables todavía no definidos.** Fuera de M3A por el brief maestro (`docs/briefs/M3A1_MASTER.md`, "NO implementar todavía"); entra con TRUST EDGE (M3C). Sin brief ni entregables definidos.

## DMX / Art-Net / iluminación

**0/0 — entregables todavía no definidos.** Fuera de M3A por el brief maestro ("NO implementar todavía: DMX"). Sin brief ni entregables definidos.

## Reloj / cúpula

**0/0 — entregables todavía no definidos.** Sin brief ni entregables definidos. La medición de sincronía (BL-06) depende de hardware y de acceso al edificio: "Fer decide".

## Hardware físico e instalación

**0/0 — entregables todavía no definidos.** Sin brief ni entregables definidos. Decisiones de producto registradas en `docs/collab/DECISIONES.md` (#61: medidas de EL_TRUST, dos TB60); la marquesina sigue abierta con el proveedor.

## Fuera de las pistas (no cuentan como funcionalidad)

**Briefs acordados.** Un brief aprobado define qué se va a construir; no prueba que exista.

| Id | Brief | Archivo | Acordado (PR + AUDIT) |
|---|---|---|---|
| BRIEF-D | Brief de Fase D (API de Campaign/Draft y Builder) | `docs/briefs/M3A1_FASE_D.md` | ✔ [#13](https://github.com/fermalenoski86/dev/pull/13) `c845f35` · [AUDIT](https://github.com/fermalenoski86/dev/pull/13#issuecomment-6051885581) sobre `5135901` |
| BRIEF-E | Brief de Fase E (hardening, E2E y aceptación) | `docs/briefs/M3A1_FASE_E.md` | ✔ [#20](https://github.com/fermalenoski86/dev/pull/20) `8debee5` · [AUDIT](https://github.com/fermalenoski86/dev/pull/20#issuecomment-6067934329) sobre `e88ed3c` |
| BRIEF-E3 | Brief de Fase E3 (platform-web + E2E Playwright de §41) | `docs/briefs/M3A1_FASE_E3.md` | ✔ [#32](https://github.com/fermalenoski86/dev/pull/32) `1494c15` · [AUDIT](https://github.com/fermalenoski86/dev/pull/32#issuecomment-6088307539) sobre `178f8d1` |
| BRIEF-F3A | Brief F3(a): versión vigente y rollback con cuatro ojos | `docs/briefs/F3A_REDEPLOY.md` | ✔ [#50](https://github.com/fermalenoski86/dev/pull/50) `0742479` · [AUDIT](https://github.com/fermalenoski86/dev/pull/50#issuecomment-6110866495) sobre `9a6bc30` |
| BRIEF-F3A-UI | Brief F3(a) UI: vista de versión vigente en platform-web | `docs/briefs/F3A_UI.md` | ✔ [#60](https://github.com/fermalenoski86/dev/pull/60) `1140616` · [AUDIT](https://github.com/fermalenoski86/dev/pull/60#issuecomment-6115363443) sobre `9907002` |

**Proceso y herramientas de colaboración.** Software del repo que no es producto.

| Id | Qué | Referencia | Código (PR + AUDIT) | Probado simulado |
|---|---|---|---|---|
| ISSUE26-OBS | Issue #26: observabilidad del E2E M2C intermitente (paso 1) y pintores vivos vs muertos (paso 2) | `docs/collab/BACKLOG.md` | ✔ [#40](https://github.com/fermalenoski86/dev/pull/40) `d4b15e8` · [AUDIT](https://github.com/fermalenoski86/dev/pull/40#issuecomment-6094441354) sobre `fd07e14` · [#41](https://github.com/fermalenoski86/dev/pull/41) `9482624` · [AUDIT](https://github.com/fermalenoski86/dev/pull/41#issuecomment-6094441446) sobre `85ba52f` | ✗ sin test |
| P-03 | P-03: auditoría basada en riesgo (risk.mjs sobre el diff real, alto ante la duda, check riesgo con declaración y Pruebas adversarias) | `docs/reviews/P03.md` | ✔ [#82](https://github.com/fermalenoski86/dev/pull/82) `db31db9` · [AUDIT](https://github.com/fermalenoski86/dev/pull/82#issuecomment-6223642598) sobre `8a5a39d` | ✔ verify-build: `scripts/collab/risk.test.ts` |
| P-04 | P-04: diagnóstico de fallas de CI (plazo y vigía, evidencia sanitizada aun sin checkout, política sin reintentos, causa no determinada con issue) | `docs/reviews/P04.md` | ✔ [#75](https://github.com/fermalenoski86/dev/pull/75) `3a8e4fc` · [AUDIT](https://github.com/fermalenoski86/dev/pull/75#issuecomment-6186511591) sobre `8bd04c5` | ✔ verify-build: `scripts/ci/run.test.sh` |
| P-05 | P-05: trabajo paralelo controlado (paralelo.sh R1–R4/R3b/R4b, paralelo-reevaluar.sh, workflow paralelo.yml desde main, handoff con fase activa) | `docs/reviews/P05.md` | ✔ [#69](https://github.com/fermalenoski86/dev/pull/69) `4fd1f03` · [AUDIT](https://github.com/fermalenoski86/dev/pull/69#issuecomment-6135785390) sobre `2fd28b9` | ✔ verify-build: `scripts/collab/paralelo.test.sh`, `scripts/collab/handoff.test.sh` |
| P-02 | P-02: PROGRESO.md generado desde este manifiesto (progress.mjs generate/check/verificar-github) | `docs/reviews/P02.md` | ✔ [#67](https://github.com/fermalenoski86/dev/pull/67) `68b7e22` · [AUDIT](https://github.com/fermalenoski86/dev/pull/67#issuecomment-6125999057) sobre `65b3775` | ✔ verify-build: `scripts/collab/progreso.test.ts` |
| P-01 | P-01: handoff.sh — compare-and-swap y push solo fast-forward para HANDOFF.md | `docs/reviews/P01.md` | ✔ [#58](https://github.com/fermalenoski86/dev/pull/58) `e7bac5a` · [AUDIT](https://github.com/fermalenoski86/dev/pull/58#issuecomment-6121930565) sobre `fb77a49` | ✔ verify-build: `scripts/collab/handoff.test.sh` |

## Cómo se mantiene

- Un entregable nuevo se agrega a `scripts/collab/entregables.mjs` cuando su PR se mergea con `AUDIT: APROBADO`; antes de eso no existe para este reporte.
- Evidencia con equipo real: la carga una persona en `real: [{ referencia, condiciones, fecha, responsable }]` de ese entregable; el validador rechaza referencias a tests, corridas de CI o simuladores y responsables que sean agentes.
- `node scripts/collab/progress.mjs verificar-github` comprueba contra la API de GitHub (fuera de CI) que cada PR citado está mergeado con ese SHA y que cada comentario AUDIT existe en ese PR, empieza con `AUDIT: APROBADO` y menciona el SHA auditado.
