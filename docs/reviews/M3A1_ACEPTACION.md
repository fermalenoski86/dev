# M3A.1 — Matriz de aceptación (master §48)

> **Generado** por `pnpm acceptance:generate` (`scripts/acceptance/`) desde la lista de
> puntos (`points.mjs`) y los tags `[§48.N]` en los nombres de los tests. No editar a mano:
> CI exige diff vacío y que cada test etiquetado haya **pasado**: los `[§48.N]` en el job `postgres`
> (reporte JSON de vitest) y los `[E3-N]` en el job `e2e-platform` (reporte JSON de Playwright).
> Un pendiente nunca cuenta como cubierto (BL-23).

Recorrido principal: `apps/platform-api/src/e2e-flow.db.test.ts` (E2), por HTTP real con
PostgreSQL, ffprobe, login, cookie, CSRF y logout por rol. Lo único sembrado por la base son
los usuarios (no hay endpoint de alta: es el CLI de C1).

| # | §48 | Rol | Estado | Evidencia |
|---|---|---|---|---|
| 1 | creo Campaign | OPERATOR (Advertiser y Contract: ADMIN) | **cubierto** | `e2e-flow.db.test.ts` › 2 · OPERATOR: login → crea la Campaign → el Builder (builder-repository) guarda el draft; la revisión protege la concurrencia |
| 2 | Builder guarda un Draft en PostgreSQL | OPERATOR | **cubierto** | `builder-d3.db.test.ts` › open muestra APPROVED VERSION vN y WORKING DRAFT; guardar no toca la versión aprobada (§32)<br>`e2e-flow.db.test.ts` › 2 · OPERATOR: login → crea la Campaign → el Builder (builder-repository) guarda el draft; la revisión protege la concurrencia<br>_A nivel API, sesión y store (`@trust/builder-repository`, el código del Builder desde D3). En navegador: E3-41 (el Builder real guarda por la API en otro host)._ |
| 3 | revision protege concurrencia | OPERATOR | **cubierto** | `builder-d3.db.test.ts` › otro operador escribe → CONFLICTO visible, el servidor no se pisa; "mantener la mía" es explícito<br>`e2e-flow.db.test.ts` › 2 · OPERATOR: login → crea la Campaign → el Builder (builder-repository) guarda el draft; la revisión protege la concurrencia |
| 4 | subo assets | OPERATOR | **cubierto** | `e2e-flow.db.test.ts` › 3 · OPERATOR: sube assets válidos; ffprobe los valida de verdad; quedan identificados por SHA-256 |
| 5 | ffprobe los valida realmente | OPERATOR | **cubierto** | `e2e-flow.db.test.ts` › 3 · OPERATOR: sube assets válidos; ffprobe los valida de verdad; quedan identificados por SHA-256 |
| 6 | assets quedan identificados por SHA-256 | OPERATOR | **cubierto** | `e2e-flow.db.test.ts` › 3 · OPERATOR: sube assets válidos; ffprobe los valida de verdad; quedan identificados por SHA-256 |
| 7 | envío Draft | OPERATOR | **cubierto** | `e2e-flow.db.test.ts` › 4 · OPERATOR: submit → el servidor recompila, corre el preflight y crea la ShowVersion con hash determinista |
| 8 | servidor recompila | OPERATOR → servidor | **cubierto** | `e2e-flow.db.test.ts` › 4 · OPERATOR: submit → el servidor recompila, corre el preflight y crea la ShowVersion con hash determinista |
| 9 | servidor ejecuta preflight | OPERATOR → servidor | **cubierto** | `e2e-flow.db.test.ts` › 4 · OPERATOR: submit → el servidor recompila, corre el preflight y crea la ShowVersion con hash determinista |
| 10 | crea ShowVersion inmutable | OPERATOR → servidor | **cubierto** | `e2e-flow.db.test.ts` › 4 · OPERATOR: submit → el servidor recompila, corre el preflight y crea la ShowVersion con hash determinista<br>`e2e-flow.db.test.ts` › 7 · OPERATOR: edita la campaña; la versión aprobada NO cambia (ni la fila ni el hash) |
| 11 | calcula hash determinista | servidor | **cubierto** | `e2e-flow.db.test.ts` › 4 · OPERATOR: submit → el servidor recompila, corre el preflight y crea la ShowVersion con hash determinista<br>`submit.db.test.ts` › mismo draft y mismos bytes en dos campañas (assets distintos, mismo contenido) → mismo hash, dos versiones |
| 12 | otro usuario la aprueba | INTERNAL_APPROVER (≠ OPERATOR del submit) | **cubierto** | `approval.db.test.ts` › cuatro ojos: quien envió (con los dos roles) no aprueba → 403 FOUR_EYES_VIOLATION<br>`e2e-flow.db.test.ts` › 5 · INTERNAL_APPROVER (otro usuario): login → ve la versión → adjunta evidencia → aprueba el hash exacto → logout |
| 13 | evidencia queda congelada | INTERNAL_APPROVER | **cubierto** | `e2e-flow.db.test.ts` › 5 · INTERNAL_APPROVER (otro usuario): login → ve la versión → adjunta evidencia → aprueba el hash exacto → logout |
| 14 | aprobación refiere al hash exacto | INTERNAL_APPROVER | **cubierto** | `e2e-flow.db.test.ts` › 5 · INTERNAL_APPROVER (otro usuario): login → ve la versión → adjunta evidencia → aprueba el hash exacto → logout |
| 15 | edito Campaign | OPERATOR | **cubierto** | `e2e-flow.db.test.ts` › 7 · OPERATOR: edita la campaña; la versión aprobada NO cambia (ni la fila ni el hash) |
| 16 | versión aprobada NO cambia | OPERATOR | **cubierto** | `builder-d3.db.test.ts` › open muestra APPROVED VERSION vN y WORKING DRAFT; guardar no toca la versión aprobada (§32)<br>`e2e-flow.db.test.ts` › 6 · OPERATOR: la campaña muestra APPROVED VERSION con el hash exacto y el WORKING DRAFT aparte<br>`e2e-flow.db.test.ts` › 7 · OPERATOR: edita la campaña; la versión aprobada NO cambia (ni la fila ni el hash) |
| 17 | audit log registra todo | ADMIN, OPERATOR, INTERNAL_APPROVER | **cubierto** | `e2e-flow.db.test.ts` › 8 · audit: verifyChain OK y cada evento esperado con el actor del rol que corresponde |
| 18 | ningún endpoint puede modificar ShowVersion | — | **cubierto** | `e2e-flow.db.test.ts` › ningún endpoint puede modificar una ShowVersion, y la base lo rechaza aunque alguien lo intente |
| 19 | M2C.2 sigue pasando sin regresión | — | **cubierto (CI)** | Playwright `e2e/experience.spec.ts` + `e2e/builder.spec.ts` (14 tests, job `e2e-m2c`)<br>_Solo en CI (job `e2e-m2c`, 14/14); intermitencia histórica en #26._ |

## Navegador (§41, §47)

Playwright en `e2e-platform/`, job `e2e-platform`: hosts HTTPS distintos (web/control/api.trust.test), API en
modo producción con la cookie `__Host-trust_session`, Builder real (`apps/control`) y tres logins por la UI.

| Id | Qué | Estado | Evidencia |
|---|---|---|---|
| E3-41 | §41 E2E Playwright: login, campaña, envío, aprobación por otro usuario y versión aprobada vs. working draft, en navegador | **cubierto (CI, job `e2e-platform`)** | `flow-41.spec.ts` › 1 · OPERATOR: login → crea la campaña → el Builder guarda el draft en el backend → sube assets → envía → hash visible → logout<br>`flow-41.spec.ts` › 2 · INTERNAL_APPROVER (otro usuario): login → ve la versión → adjunta evidencia → aprueba el hash exacto<br>`flow-41.spec.ts` › 3 · OPERATOR (login nuevo): APPROVED VERSION + hash exacto + working draft aparte → edita → la versión aprobada no cambia<br>`session-multihost.spec.ts` › sesión multihost: login en web, el Builder en control usa la cookie del host de la API, CSRF, origen bloqueado y logout |
| E3-47 | §47 screenshots y video del flujo | **cubierto (CI, job `e2e-platform`)** | `flow-41.spec.ts` › 1 · OPERATOR: login → crea la campaña → el Builder guarda el draft en el backend → sube assets → envía → hash visible → logout<br>`flow-41.spec.ts` › 2 · INTERNAL_APPROVER (otro usuario): login → ve la versión → adjunta evidencia → aprueba el hash exacto<br>`flow-41.spec.ts` › 3 · OPERATOR (login nuevo): APPROVED VERSION + hash exacto + working draft aparte → edita → la versión aprobada no cambia<br>_Artifact de CI `e2e-platform-evidence` con `evidence-manifest.json` validado (BL-29), retención 90 días; no se versionan binarios._ |

**Resumen:** 19/19 puntos de §48 cubiertos a nivel plataforma; navegador: 2/2 cubiertos, 0 pendientes.
Sin pendientes de navegador: la cobertura vale mientras los jobs `postgres`, `e2e-m2c` y `e2e-platform` pasen. El cierre de M3A.1 lo declara la auditoría.
