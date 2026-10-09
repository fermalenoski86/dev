# M3A.1 — FASE E3: UI de plataforma y E2E Playwright de §41 — brief corto

**Origen:**
- master §41 (E2E Playwright), §47 (screenshots y video), §42 (no tocar M2C.2)
  y §48;
- decisión de Fer en **#31**, opción (a): la UI de login, campaña y aprobación
  vive en una **app nueva, `apps/platform-web`**;
- auditoría de E2 (#29): primero se acuerda este brief y recién después se
  implementa.

Este brief no agrega requisitos: ordena los del master en checkpoints y marca
con ❓ lo que el master no decide.

**Propuesto por Claude el 2026-10-09**, con E2 aprobada y mergeada en `main@0234055`.
**Re-entrega 1 (2026-10-09):** corrige el [P1] de la auditoría (arquitectura de
sesión entre hosts) e incorpora los ajustes a ❓2, ❓3, BL-28 y BL-29.
**Re-entrega 2 (2026-10-09):** agrega el segundo login del operador de §41 y el
ADR de la arquitectura de sesión. El detalle de ambas está al final.

## Qué NO se toca

`apps/control` (Builder y experiencia ejecutiva M2C.2), los renderers, la
geometría, los screenshots congelados y `e2e/` (los 14 de M2C siguen siendo
gate). De `apps/control` solo cambia **la variable de entorno**
`NEXT_PUBLIC_TRUST_API_URL` con la que se levanta: ningún archivo. Tampoco
cambia la arquitectura de storage B1. El contrato de la API solo suma CORS por
allowlist (ver "Arquitectura de sesión").

## Arquitectura de sesión (decisión ❓1, corregida)

**Las dos UIs hablan directamente con `platform-api`.** No hay proxy de mismo
origen en ningún lado. La cookie de sesión es host-only (`__Host-trust_session`
en producción, sin `Domain`), así que tiene que emitirla y recibirla **el host
de la API**. Un proxy en `platform-web` dejaría la cookie en el host de la web,
y el Builder, que llama a la API directo, recibiría `401` (hallazgo [P1]).

- **Topología:** tres hosts HTTPS del **mismo site**:
  - `web.<site>` → `platform-web`;
  - `control.<site>` → `apps/control`;
  - `api.<site>` → `platform-api`.
  - Es **requisito de despliegue**. La cookie es `SameSite=Lax`: entre hosts
    del mismo site viaja en `fetch` con `credentials: 'include'`; entre sites
    distintos no viaja. El brief no pide cambiar `SameSite`.
- **`platform-api`: CORS por allowlist exacta.**
  - `TRUST_CORS_ORIGINS` es una lista de orígenes exactos (esquema + host +
    puerto). Si está vacía, no hay CORS (comportamiento actual).
  - Al arrancar se rechaza `*`, un valor que no sea un origen válido y, en
    producción, un origen `http:`.
  - Para un origen permitido: `Access-Control-Allow-Origin: <origen>` (nunca
    `*`), `Access-Control-Allow-Credentials: true` y `Vary: Origin`.
  - En el preflight: métodos y headers explícitos (`Content-Type`,
    `X-CSRF-Token`, `Idempotency-Key`, `If-Match` si aplica) y `Max-Age` acotado.
  - Para un origen no permitido: el preflight responde **sin** headers CORS,
    así que el navegador bloquea. Además, defensa en profundidad: una mutación
    con header `Origin` presente y fuera de la allowlist responde
    `403 ORIGIN_NOT_ALLOWED` antes de tocar la sesión. Los clientes sin
    `Origin` (CLI, tests) no cambian.
  - Se implementa como hook de Fastify **sin dependencia nueva**. Lleva tests
    de plataforma: preflight permitido y rechazado, credenciales,
    `Vary: Origin`, el 403 y CSRF intacto (una mutación con origen permitido y
    sin `X-CSRF-Token` sigue dando `403 CSRF_TOKEN_INVALID`).
- **CSRF:** no cambia. Cada UI obtiene el token de `POST /auth/login` o de
  `GET /auth/me` y lo manda en `X-CSRF-Token`.
- **`platform-web`:** usa `NEXT_PUBLIC_TRUST_API_URL` (la misma convención que
  D3). Las llamadas a la API salen **del navegador**: los Server Components no
  ven la cookie, porque es de otro host. La guarda de sesión es del lado del
  cliente: `GET /auth/me`; si da 401, va a `/login`.
- **`apps/control`:** sin cambios de código. Se levanta con
  `NEXT_PUBLIC_TRUST_API_URL=https://api.<site>`. Una vez logueado en
  `platform-web`, la cookie del host de la API ya existe y D3 la usa.

## E3a — `apps/platform-web`: esqueleto, sesión, CORS y campañas

- **App y cliente HTTP:**
  - Next 14 + React 18, el mismo stack que `apps/control`, sin dependencias
    nuevas fuera de las que ya usa el monorepo.
  - Consume **solo `platform-api`**, con cookie `HttpOnly` y el CSRF de C1, sin
    tokens en `localStorage`.
  - El cliente HTTP es un módulo con `fetch` y `baseUrl` inyectados, no
    `fetch()` en componentes, igual que §31 y D3. Siempre manda
    `credentials: 'include'`.
- **CORS por allowlist en `platform-api`**, como se describe arriba, con sus
  tests y la documentación en `docs/platform/AUTH.md`.
- **ADR-063 en `docs/architecture/DECISIONS.md`** (enlazado desde ADR-057): "Dos
  UIs de navegador directas contra la API cross-origin". Cubre:
  - la topología de tres hosts;
  - por qué la cookie host-only vive en el host de la API (el [P1] de la
    auditoría);
  - el requisito de despliegue same-site HTTPS y por qué no se cambia
    `SameSite`;
  - la allowlist exacta, `Vary: Origin`, el 403 por `Origin` y CSRF sin
    cambios;
  - las alternativas descartadas: proxy de mismo origen, rewrite en
    `apps/control` y editor mínimo;
  - el gate multihost (`session-multihost.spec.ts`).
- **Login / logout** (`/login`): `POST /auth/login` y `GET /auth/me`. Si no hay
  sesión, redirige a login. Logout revoca la sesión en el servidor.
- **Campañas** (`/campaigns`): lista con `GET /campaigns` y alta con
  `POST /campaigns`. El alta elige un contrato existente; los contratos los
  crea ADMIN. Cada rol ve solo lo que la API le devuelve: la UI no reimplementa
  permisos.

## E3b — Campaña, assets, envío y aprobación de cuatro ojos

- **Detalle de campaña** (`/campaigns/:id`):
  - APPROVED VERSION vN con su **hash exacto**, y el WORKING DRAFT con su
    revisión, por separado (§32);
  - enlace al Builder: `https://control.<site>/?campaign=<id>` (D3).
- **Assets**: upload multipart (`POST /assets`, Idempotency-Key). Muestra el
  estado READY o REJECTED con el motivo de ffprobe y el SHA-256.
- **Enviar a aprobación**: `POST /campaigns/:id/submit` con `draftRevision`.
  Muestra el hash de la versión creada (§41 "hash visible").
- **Revisión** (`/versions/:id`), para INTERNAL_APPROVER:
  - ve la versión, el hash y los assets;
  - adjunta evidencia (`POST …/evidence`);
  - aprueba o rechaza citando el `versionHash`.
  - Si la API rechaza por cuatro ojos o por un hash distinto, la UI muestra el
    error: la regla vive en el servidor y la UI no la duplica.
- **Accesibilidad (BL-28):**
  - todos los controles tienen nombre accesible y foco visible;
  - los errores de la API se anuncian con `role="alert"`.

## E3c — E2E Playwright de §41 por rol, evidencia §47 y matriz

- **Hosts distintos, no solo puertos.**
  - Chrome se lanza con `--host-resolver-rules` que mapea `web.trust.test`,
    `control.trust.test` y `api.trust.test` a `127.0.0.1`.
  - Delante de cada app hay un terminador TLS de test: un script Node con
    `node:https`, sin dependencias. El certificado autofirmado se genera con
    `openssl` en el `globalSetup` y **no se versiona**.
  - Playwright usa `ignoreHTTPSErrors`.
  - `platform-api` arranca en modo producción para la cookie:
    `TRUST_COOKIE_SECURE=true`, así que la cookie es `__Host-trust_session`.
  - `TRUST_CORS_ORIGINS=https://web.trust.test:<p>,https://control.trust.test:<p>`.
- **Specs nuevos** en `e2e-platform/` con su propio
  `playwright.platform.config.ts`, separados de los de M2C congelados.
  - **`session-multihost.spec.ts`** (la reproducción del [P1], ahora como gate):
    1. login en `web.trust.test`;
    2. la cookie `__Host-trust_session` existe **solo** para `api.trust.test`
       (se verifica con `context.cookies()`), no para la web;
    3. `control.trust.test/?campaign=<id>`: el Builder hace `/auth/me` → 200;
    4. guardar hace `PUT` con CSRF → 200, y el indicador muestra la revisión
       nueva;
    5. una `fetch` desde una página servida en un origen **no** listado
       (`evil.trust.test`) falla en el navegador: el preflight sale sin
       `Access-Control-Allow-Origin` y no hay escritura en la base;
    6. logout → el Builder recibe 401 en la próxima llamada.
  - **`flow-41.spec.ts`**, exactamente el flujo de §41 (`M3A1_MASTER.md`
    §41). Los **tres logins son por el formulario de la UI**, cada uno en un
    contexto de navegador nuevo y sin `storageState`:
    1. **OPERATOR — login**: crear campaña → el Builder (`apps/control`) guarda
       el draft en el backend → subir assets válidos → enviar → hash visible
       → **logout**. El test guarda el valor de la cookie de esa sesión y
       verifica que, después del logout, `GET /auth/me` con esa cookie da
       401.
    2. **INTERNAL_APPROVER (otro usuario) — login**: ver la versión → adjuntar
       evidencia → aprobar.
    3. **OPERATOR — login nuevo**, en un contexto nuevo:
       - la cookie de sesión es **distinta** de la revocada en el paso 1;
       - la campaña muestra APPROVED VERSION, el **hash exacto** del paso 1 y
         el working draft aparte;
       - editar crea o modifica el draft, y la versión aprobada (fila y hash)
         no cambia.
  - **`a11y.spec.ts`** (BL-28):
    - `@axe-core/playwright` en login, campañas y revisión, con **cero
      violaciones**;
    - el recorrido principal (login → campaña → enviar; login → revisión →
      aprobar) se completa **solo con teclado**: foco visible y errores
      anunciados.
    - No se afirma conformidad WCAG completa: es un escaneo automático más
      recorridos.
- **Datos y sesiones** (BL-25, con la precisión de la auditoría):
  - en el `globalSetup`, el CLI de C1 crea **una cuenta por rol y por worker**:
    `operator-w<N>`, `approver-w<N>` y `admin-w<N>`;
  - contratos por API como ADMIN, y contrato y campaña **propios de cada
    worker**;
  - sesión por rol con login por API y `storageState` en un directorio
    temporal, sin cookies en el repo. Se usa en `a11y.spec.ts` y en los specs
    que no prueban el login. `flow-41.spec.ts` y `session-multihost.spec.ts`
    no lo usan: hacen el login por la UI, y un `storageState` posterior a un
    logout tendría un token revocado.
- **CI:**
  - job nuevo `e2e-platform` con PostgreSQL 16, ffmpeg, platform-api,
    platform-web, apps/control y Google Chrome del runner (igual que
    `e2e-m2c`);
  - `retries: 0` y trace `retain-on-failure`.
- **§47 y manifest (❓3 + BL-29):**
  - video y screenshots de Builder → Guardar → Enviar → Hash → Aprobar →
    versión inmutable, publicados como **artifact de CI** con
    `retention-days: 90` explícito. No hay binarios en el repo.
  - El artifact incluye `evidence-manifest.json`:
    - commit SHA;
    - navegador y versión;
    - roles y usuarios por worker;
    - `campaignId`, `versionId` y `versionHash`;
    - specs, con el resultado de cada test;
    - el archivo de cada screenshot y video con su SHA-256.
  - CI **valida** el manifest antes de subirlo, con un validador Node sin
    dependencias y sus tests. Falla si falta un campo, si un archivo listado no
    existe, si un SHA-256 no coincide o si un test no está en `passed`.
- **Matriz (BL-23):**
  - E3-41 y E3-47 pasan a *cubierto* solo con tags en los títulos de
    Playwright y el reporte JSON de Playwright del job `e2e-platform`, que
    exige `passed`;
  - hasta entonces quedan *pendiente*.

Gate de cada checkpoint: verify, build, PostgreSQL, bootstrap, media,
mutaciones, acceptance y **M2C 14/14**; desde E3c, también `e2e-platform`.
Las mutaciones nuevas cubren la allowlist CORS, el 403 de origen, el cliente
HTTP y las guardas de UI.

## Decisiones (estado tras la auditoría)

1. **Arquitectura de sesión:** las dos UIs van directo a la API, en hosts del
   mismo site, con CORS por allowlist exacta. Reemplaza la propuesta anterior
   (proxy en web + CORS para el Builder), que tenía el [P1]. Se descartan:
   - (b) el rewrite en `apps/control`: toca la app congelada y deja la cookie
     en el host de control;
   - (c) el editor mínimo: no cumple §41.
2. **Alta de usuarios para el E2E:** el CLI de C1 en el `globalSetup`, una
   cuenta por rol y por worker. Aceptada con la precisión de BL-25. BL-27
   sigue diferida.
3. **Evidencia §47:** artifact de CI con manifest validado y `retention-days`
   explícito. Aceptada con ajuste: BL-29 se incorpora a E3c.
4. **Estética:** UI funcional y sobria, sin design system nuevo. Aceptada.

## Fuera de alcance

UI de administración de usuarios y contratos (BL-27), portal externo
(EXTERNAL_APPROVER por UI), Scheduler/EDGE/Deploy, i18n, BL-26 y cualquier
cambio de `SameSite` o del nombre de la cookie.

## Propuestas de mejora

- **BL-28 · Accesibilidad operativa:** aceptada con el ajuste del auditor e
  incorporada a E3b (nombres, foco y alertas) y a E3c (`a11y.spec.ts`). Suma
  una dependencia de dev: `@axe-core/playwright`.
- **BL-29 · Manifest de evidencia:** aceptada e incorporada a E3c.

## Re-entrega 1 — AUDIT: CAMBIOS (PR #32, comentario 6084515242)

| Hallazgo | Respuesta |
|---|---|
| [P1] cookie `__Host-` host-only: el proxy en web y el CORS para el Builder no comparten sesión | Corregido. No hay proxy: las dos UIs van directo a la API en hosts del mismo site, con CORS por allowlist exacta (sin `*`, `credentials: true`, `Vary: Origin`, 403 a mutaciones con origen no listado) y CSRF intacto. El E2E multihost `session-multihost.spec.ts` es gate: hosts distintos con TLS y la cookie `__Host-` real, login → `/auth/me` desde el Builder → `PUT` con CSRF → logout, y origen no listado bloqueado. |
| ❓2 una cuenta por rol y por worker | Incorporado en E3c "Datos y sesiones". |
| ❓3 manifest y `retention-days` | Incorporado en E3c "§47 y manifest" (BL-29). |
| ❓4 | Sin cambios (aceptada). |
| BL-28 con teclado, foco, nombres y alertas | Incorporado en E3b y en `a11y.spec.ts` (E3c). |
| BL-29 | Aceptada e incorporada a E3c. |

## Re-entrega 2 — AUDIT: CAMBIOS (PR #32, comentario 6086497095)

| Hallazgo | Respuesta |
|---|---|
| [P1] falta el segundo login del operador de §41; un `storageState` posterior al logout tiene el token revocado | Corregido. En `flow-41.spec.ts` los tres logins son por la UI, en contextos nuevos y sin `storageState`. El paso 1 verifica que la cookie revocada da 401. El paso 3 hace un **login nuevo** del operador, exige una cookie distinta de la revocada y comprueba el hash exacto, el working draft separado y que editar no cambia la versión aprobada. `storageState` queda solo para los specs que no prueban el login. |
| [P2] la arquitectura de sesión/CORS no tiene ADR como entregable | Corregido. E3a entrega **ADR-063**, enlazado desde ADR-057: topología, por qué la cookie vive en el host de la API, same-site, allowlist/CSRF, alternativas descartadas y gate multihost. |
