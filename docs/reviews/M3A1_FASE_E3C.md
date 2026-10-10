# M3A.1 — Fase E3c: E2E Playwright de §41 por rol, evidencia §47 y matriz

**Estado:** entregado para auditoría. Autorizado al aprobar E3b
([#36](https://github.com/fermalenoski86/dev/pull/36)): "`e2e-platform` con hosts
HTTPS distintos y cookie `__Host-`, flujo §41 con los tres logins explícitos,
evidencia §47, BL-28/29/30 y todos los gates existentes, sin modificar las
partes congeladas".
No toca `apps/control` (solo se construye con su variable de entorno), M2C.2,
`e2e/`, `platform-api` (ni rutas ni lógica) ni la arquitectura de storage B1.

**Rama:** `fase/m3a1-e3c` desde `main@754d319`. Brief: `docs/briefs/M3A1_FASE_E3.md` §E3c.

## Resultados (ejecución real, 2026-10-10, este entorno)

Node 22.22.0 · pnpm 12.5.1 · PostgreSQL 16.15 · ffprobe 6.1. Salida en `M3A1_FASE_E3C_SALIDA.txt`.

| Gate | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK, sin dependencias nuevas (Playwright y axe se instalan aparte, como M2C) |
| `pnpm verify` | **752 passed + 1 skipped** (12 nuevos). Lint: 0 errores y los mismos 12 warnings |
| `pnpm build` | OK (no estricto: el gate de todos los días) |
| PostgreSQL 16 | 267 passed + 6 skipped |
| `bootstrap-smoke.sh` | 6 passed |
| media | 63 passed |
| mutaciones | **6/6 nuevas `e3c:` atrapadas** (tanda 267:273); autoprueba OK. La corrida completa de las 273 queda en CI |
| acceptance | 19 puntos y 12 tags; navegador 2/2 con 4 tests `[E3-N]` |
| `docs:contract` | `openapi.json` sin diff |
| **E2E de plataforma** (job nuevo `e2e-platform`) | **6/6 passed localmente** con 2 workers (Chromium 141 de Playwright). Después: `acceptance:check --playwright-results` OK y el manifest se valida con 6 tests, 1 flujo, 8 screenshots y 16 videos con SHA-256 |
| E2E M2C (14) | **No ejecutado localmente** (no hay Chrome con H.264). Evidencia: job `e2e-m2c` de CI |

**Negativos reales** (detalle en la SALIDA):
- **BL-30:** un build estricto sin URL o con `http:` falla con un mensaje
  claro; con https compila.
- **BL-28:** sin `<label>` y sin foco visible, fallan los tests de axe y de
  teclado; sin `lang`, axe falla con `html-has-lang`.

## Qué se entrega

1. **`e2e-platform/` + `playwright.platform.config.ts`**, separados de M2C:
   - `global-setup.ts`:
     - certificado autofirmado con `openssl` (no versionado);
     - `tls-proxy.mjs`: un terminador TLS sin dependencias en :8443 que
       enruta por `Host`;
     - backend real (`apps/platform-api/scripts/e2e-stack.ts`: PostgreSQL,
       usuarios por el **CLI de C1** uno por rol y por worker, y la API en modo
       producción con `__Host-trust_session` y CORS allowlist);
     - `next start` de platform-web y del Builder;
     - un contrato por worker, creado por la API como ADMIN (BL-25).
   - Chrome con `--host-resolver-rules` (`*.trust.test` → 127.0.0.1) y
     `--no-proxy-server`: hosts distintos, no solo puertos.
   - `retries: 0`, trace `retain-on-failure` y video de cada test.
2. **`session-multihost.spec.ts`**: el [P1] del brief, ahora gate.
   - La cookie existe **solo** para `api.trust.test` (Secure, HttpOnly, Lax).
   - El Builder real en `control.trust.test` hace `/auth/me` (200) y guarda
     con `PUT` + `X-CSRF-Token`, y la respuesta trae CORS para control.
   - La web servida desde `evil.trust.test` no puede leer ni escribir
     (`TypeError` en el navegador); el preflight da 403 sin CORS y no hay
     escritura.
   - Después del logout en la web, el Builder recibe 401.
3. **`flow-41.spec.ts`**: §41 exacto, serial, con los **tres logins por la UI**
   en contextos nuevos y sin `storageState`.
   1. OPERATOR crea la campaña, entra al Builder por el enlace, que guarda
      rev 2 en el backend. Sube dos MP4 reales (READY), los asigna, envía y ve
      el hash. En el logout guarda la cookie, que después da 401.
   2. INTERNAL_APPROVER abre la versión, ve el mismo hash, adjunta un PDF,
      confirma el hash y aprueba.
   3. OPERATOR, con un login nuevo, recibe una cookie distinta de la
      revocada. Ve APPROVED VERSION v1 con el hash exacto y el working draft
      aparte. Edita en el Builder (sube la revisión), y la versión sigue
      APPROVED con el mismo hash y su revisión de origen.
   - §47: 8 screenshots de los pasos y video de cada contexto.
4. **`a11y.spec.ts`** (BL-28):
   - axe (WCAG 2.0/2.1 A y AA + best practices) en `/login`, `/campaigns`,
     `/campaigns/[id]` y `/versions/[id]`, con **cero violaciones**;
   - recorrido solo con teclado, exigiendo foco visible (outline ≥ 2 px) en
     cada Tab: login con un error anunciado (`role="alert"`), campaña, enviar,
     salir; después, login del aprobador, revisión, evidencia (con flechas),
     confirmación (Espacio) y aprobar (Enter).
   - No se afirma conformidad WCAG completa.
5. **BL-29 · manifest de evidencia** (`scripts/e2e-platform/manifest.mjs`):
   - `build` copia screenshots y videos y escribe `evidence-manifest.json`
     con commit, navegador, roles, campaignId, versionId/hash, specs con su
     resultado e intentos, y el SHA-256 y tamaño de cada archivo;
   - `validate` lo exige todo, sin reintentos, con ≥ 8 screenshots y videos;
   - CI lo sube como artifact `e2e-platform-evidence` con
     `retention-days: 90`, y un test verifica que coincida con el manifest.
6. **BL-30** (`apps/platform-web/src/build-env.mjs`, cargado por `next.config`):
   - con `TRUST_BUILD_STRICT=1`, el build falla si
     `NEXT_PUBLIC_TRUST_API_URL` falta o no es https (también si
     `NEXT_PUBLIC_TRUST_BUILDER_URL`, cuando está, no lo es);
   - el job construye así y además corre los dos builds negativos;
   - README: `NEXT_PUBLIC_*` queda congelada en el build y el artefacto es
     por entorno.
7. **BL-23**: E3-41 y E3-47 pasan a **cubierto (CI)**.
   - `points.mjs`: `NAVEGADOR` con estados.
   - `matrix.mjs`: `scanPlaywrightTags`, `validateNavegador` y
     `checkPlaywrightResults`, que exige `passed` en todos los intentos.
   - La CLI acepta `--playwright-results`, y el job lo corre sobre el reporte
     JSON de Playwright.
   - El documento muestra la sección "Navegador", sin pendientes, y **no**
     declara cerrado M3A.1: eso lo declara la auditoría.
8. **CI**: job `e2e-platform` en `gates.yml`:
   - PostgreSQL 16 + ffmpeg;
   - negativos de BL-30;
   - builds para los hosts de test;
   - Playwright 1.56.1 + `@axe-core/playwright` 4.10.2 instalados con
     `--no-save` (igual que M2C: no tocan el lockfile);
   - Google Chrome del runner y 2 workers;
   - `acceptance:check --playwright-results`;
   - manifest build + validate y artifact de 90 días;
   - trazas y logs como artifact de 14 días si falla.
9. **Tests y mutaciones nuevas**:
   - 3 negativos nuevos en `matrix.test.ts`, 6 en `manifest.test.ts` y 3 en
     `build-env.test.ts`;
   - 6 mutaciones `e3c:`.

## Decisiones de Claude a validar

1. **BL-30 opt-in con `TRUST_BUILD_STRICT=1`.** `next build` siempre corre con
   `NODE_ENV=production`, así que un fail-fast incondicional rompería el
   `pnpm build` del gate `verify-build` y el de cualquier contribuidor. El
   build para desplegar y el del E2E usan la bandera, y CI prueba los dos
   negativos.
2. **`@axe-core/playwright` se instala en CI con `--no-save`, como
   Playwright**, en lugar de como devDependency. Sigue la política vigente
   (`playwright.config.ts`: Playwright no está en las dependencias del
   monorepo) y evita tocar el lockfile. El brief hablaba de "dependencia de
   dev"; la versión queda fijada en el workflow.
3. **Los datos que no son parte del recorrido de a11y se preparan por la
   API**: assets y evidencia, porque el selector de archivos del sistema no es
   operable por teclado dentro del navegador de test. §41 y el multihost hacen
   todo por la UI.
4. **El `evil.trust.test` del multihost es la misma web en un origen no
   listado**, servida por el terminador TLS: prueba el bloqueo en un navegador
   real, sin servidor extra.
5. **`apps/platform-api/scripts/e2e-stack.ts`** vive junto al CLI que usa,
   para resolver los paquetes del workspace. Es solo de test, y no se lo
   importa desde el código de producción.

## Propuestas de mejora (≤ 3)

Ninguna nueva. BL-31 queda como lo aceptó el auditor: después de cerrar E3 y
en un cambio aparte.

## Autorrevisión previa (chequeo obligatorio de Fer, 2026-10-08)

Hecha el 2026-10-10 sobre `git diff origin/main...HEAD`, antes de pedir la
auditoría. La primera entrega (`41177c1`) pasó la pelota **sin** esta sección
y con `e2e-m2c` en rojo; esta vuelta lo corrige.

### A. Requisito del brief (§E3c) → dónde se cumple

| Requisito | Dónde | Estado |
|---|---|---|
| Hosts distintos con `--host-resolver-rules` | `playwright.platform.config.ts` (`MAP *.trust.test 127.0.0.1`) | cubierto |
| Terminador TLS Node sin dependencias; cert openssl en globalSetup, no versionado | `e2e-platform/tls-proxy.mjs`; `global-setup.ts` (cert en el dir temporal del estado) | cubierto |
| `ignoreHTTPSErrors` | `support.ts` `contexto()` | cubierto |
| API en producción: `TRUST_COOKIE_SECURE=true` → `__Host-trust_session` | `apps/platform-api/scripts/e2e-stack.ts` | cubierto |
| `TRUST_CORS_ORIGINS` = web + control exactos | `global-setup.ts` → `E2E_CORS_ORIGINS` | cubierto |
| multihost 1-6 (cookie solo en api, `/auth/me` 200, PUT+CSRF, origen no listado sin leer/escribir, logout → 401) | `session-multihost.spec.ts` | cubierto |
| §41 con tres logins UI en contextos nuevos, cookie revocada → 401, cookie nueva distinta | `flow-41.spec.ts` tests 1-3 | cubierto |
| Editar no cambia la versión aprobada (fila y hash) | `flow-41.spec.ts` test 3 | cubierto vía UI: hash, estado APPROVED y «desde el draft rev 4». No se compara la fila completa de la base (p. ej. `approvedAt`); el estado inmutable lo garantiza el repositorio (E1/E2, ya auditado) |
| axe 0 violaciones en login, campañas y revisión; recorrido solo con teclado, foco visible, errores anunciados | `a11y.spec.ts` | cubierto (4 vistas) |
| Una cuenta por rol y worker con el CLI de C1; contrato por worker | `e2e-stack.ts`, `support.ts` `cuenta()`/`contrato()` | cubierto |
| `storageState` por rol en dir temporal para specs que no prueban login | — | **desvío declarado**: no se usa `storageState`; a11y hace login por la UI y prepara datos con sesiones por API (`apiSesion`). Es más estricto (más logins reales) a costa de ~1 s por test. No hay cookies en el repo |
| Job CI con PG16, ffmpeg, Chrome del runner; `retries: 0`; trace `retain-on-failure` | `gates.yml` job `e2e-platform`; `playwright.platform.config.ts` | cubierto |
| Artifact §47 con `retention-days: 90` y manifest validado antes de subir | `scripts/e2e-platform/manifest.mjs` + tests; `gates.yml` | cubierto; reforzado en esta vuelta (ver B) |
| Matriz E3-41/E3-47 cubierta solo con reporte de Playwright `passed` | `scripts/acceptance/*`, `M3A1_ACEPTACION.md` | cubierto |
| BL-30: build estricto falla sin URL o con `http:` | `apps/platform-web/src/build-env.mjs` + test; negativos en `gates.yml` | cubierto; negativos endurecidos en esta vuelta (ver B) |
| Mutaciones nuevas | `scripts/mutation-check.py` | 8 de e3c (6 + 2 de esta vuelta), todas ATRAPADAS |
| No tocar `apps/control`, `e2e/`, renderers, storage B1 | diff: solo se construye `apps/control` con su variable | cubierto |

### B. Revisión adversaria: qué encontré y qué hice

1. **[corregido] El manifest registraba el commit equivocado.** En `pull_request`,
   `GITHUB_SHA` es el merge commit sintético, no el HEAD del PR. La evidencia
   no se podía atar al SHA auditado. Ahora el manifest tiene `commit` (el árbol
   que corrió) y `headSha` (el HEAD del PR, `E2E_HEAD_SHA` en `gates.yml`), y el
   validador exige ambos. Tests: `manifest.test.ts` (negativos de `headSha` y
   CLI con los dos SHA). Mutación nueva atrapada.
2. **[corregido] Los negativos de BL-30 en CI podían pasar por el motivo
   equivocado.** Con `grep -q … && echo`, si el primer `grep` no encontraba el
   mensaje, `bash -e` no corta (el fallo está dentro de una lista `&&` que no es
   la última): un build roto por otra causa daba el negativo por bueno. Ahora
   cada `grep` usa `|| { …; exit 1; }` y busca el mensaje exacto de BL-30.
   Comprobado localmente: los dos builds estrictos fallan con exit 1 y con el
   mensaje esperado.
3. **[corregido] Los 8 screenshots de §47 se contaban en global, no por flujo.**
   Un flujo §41 podía registrar menos pasos si otro spec aportaba capturas.
   Ahora el validador exige ≥ 8 screenshots en cada flujo registrado. Test y
   mutación nuevos.
4. **[no se cambia] `flow-41` es serial con estado de módulo.** Si falla el test
   1, el 2 y el 3 se saltean y el manifest falla (exige `passed`). Es el
   comportamiento buscado: §41 es un flujo, no tres casos independientes.
5. **[no se cambia] Intermitencia `e2e-m2c`** (`experience.spec.ts:17`,
   `ready-state` en `LOADING`). No es de este PR: no toca `apps/control`, `e2e/`
   ni `playwright.config.ts`, y pasó 14/14 sobre `69fab3a` con el mismo código
   de app. Sigue #26 (pendiente de Fer) y BL-09. Se registra como posible flaky
   en el PR.
6. **Otro tenant/campaña:** cada worker tiene cuentas, contrato y campañas
   propias; el origen no listado no puede escribir (conteo antes/después).
   **Infraestructura:** si el terminador TLS pierde el upstream responde 502 y
   el test falla (no hay reintentos). **Secretos:** contraseñas y cert viven en
   el dir temporal del estado, fuera del repo.

### C. CI completo

Se exige `gates.yml` en verde sobre el HEAD exacto entregado, con `e2e-m2c` y
`mutations`. El run y el SHA van en el pedido de auditoría (issue #39 y PR #38).
