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

## Qué NO se toca

`apps/control` (Builder y experiencia ejecutiva M2C.2), los renderers, la
geometría, los screenshots congelados y `e2e/` (los 14 de M2C siguen siendo
gate). Tampoco cambia la arquitectura de storage B1 ni el contrato de la API,
salvo lo que pida la decisión ❓1.

## E3a — `apps/platform-web`: esqueleto, sesión y campañas

- **App y comunicación con la API**:
  - Next 14 + React 18, el mismo stack que `apps/control`, sin dependencias
    nuevas fuera de las que ya usa el monorepo.
  - Consume **solo `platform-api`**, a través de un proxy de mismo origen:
    rewrite de `/api/v1/*` en `next.config`. Cookie `HttpOnly` y CSRF de C1,
    sin tokens en `localStorage`.
  - El cliente HTTP es un módulo con `fetch` inyectado, no `fetch()` en
    componentes, igual que §31 y D3.
- **Login / logout** (`/login`): `POST /auth/login` y `/auth/me`. Si no hay
  sesión, redirige a login. Logout revoca la sesión en el servidor.
- **Campañas** (`/campaigns`): lista con `GET /campaigns` y alta con
  `POST /campaigns` (elige el contrato, que ya existe y crea ADMIN). Cada rol
  ve solo lo que la API le devuelve; la UI no reimplementa permisos.

## E3b — Campaña, assets, envío y aprobación de cuatro ojos

- **Detalle de campaña** (`/campaigns/:id`):
  - APPROVED VERSION vN con su **hash exacto**, y el WORKING DRAFT con su
    revisión, por separado (§32);
  - acceso al Builder con `?campaign=` (D3), ver ❓1.
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

## E3c — E2E Playwright de §41 por rol, evidencia §47 y matriz

- **Specs nuevos** en `e2e-platform/` con su propio
  `playwright.platform.config.ts`, separados de los de M2C congelados. El
  flujo es exactamente el de §41:
  1. **OPERATOR**: login → crear campaña → el Builder guarda el draft en el
     backend → subir assets válidos → enviar → hash visible → logout.
  2. **INTERNAL_APPROVER** (otro usuario): login → ver la versión → adjuntar
     evidencia → aprobar.
  3. **OPERATOR**: la campaña muestra APPROVED VERSION, el hash exacto y el
     working draft aparte → editar → la versión aprobada no cambia.
- **Datos y sesiones** (BL-25, aceptada para E3 en la auditoría de D3):
  - usuarios con el CLI de C1 y contratos por API como ADMIN, en el
    `globalSetup`;
  - sesión por rol: login por API y `storageState`, sin cookies en el repo;
  - datos aislados por worker: contrato y campaña propios.
- **CI**: job nuevo `e2e-platform` con PostgreSQL 16, ffmpeg, platform-api,
  platform-web y Google Chrome del runner (igual que `e2e-m2c`). `retries: 0`
  y trace `retain-on-failure`.
- **§47**: video y screenshots de Builder → Guardar → Enviar → Hash → Aprobar
  → versión inmutable. Se publican como **artifact de CI**, no como binarios
  en el repo. El reporte enlaza el run.
- **Matriz (BL-23)**:
  - E3-41 y E3-47 pasan a *cubierto* solo con tags en los títulos Playwright
    y el reporte JSON de Playwright del job `e2e-platform`, exigiendo
    `passed`;
  - hasta entonces quedan *pendiente*.

Gate de cada checkpoint: verify, build, PostgreSQL, bootstrap, media,
mutaciones (nuevas, sobre el cliente HTTP y las guardas de UI), **M2C 14/14** y,
desde E3c, `e2e-platform`.

## Decisiones a validar (❓)

1. **Cómo entra el Builder al flujo de navegador.** §41 dice "Builder guarda
   draft en backend". El Builder vive en `apps/control` (D3, `?campaign=`).
   Desde el origen de `apps/control` no llega a la API sin CORS ni proxy.
   - **(a) Propuesta:** la API acepta CORS **solo para orígenes listados**
     (`TRUST_CORS_ORIGINS`, `credentials: true`, preflight). `apps/control` se
     levanta con `NEXT_PUBLIC_TRUST_API_URL` apuntando a la API. El cambio va
     en `platform-api` y no toca código de `apps/control`, solo su variable de
     entorno. Lleva tests de origen permitido/rechazado y CSRF intacto.
   - **(b)** `apps/control` suma un rewrite `/api/v1` en su `next.config`.
     Toca un archivo de la app congelada (D3 ya lo modificó una vez para
     `transpilePackages`).
   - **(c)** `platform-web` incluye un editor mínimo de draft y el Builder
     queda fuera del E2E de navegador. No cumple §41 al pie de la letra.
2. **Alta de usuarios para el E2E** con el CLI de C1 en el `globalSetup`, sin
   API de administración (BL-27 sigue diferida).
3. **Evidencia §47 como artifact de CI** y no versionada: el repo es público y
   no lleva binarios.
4. **Estética**: UI funcional y sobria, sin design system nuevo. No es la
   experiencia ejecutiva.

## Fuera de alcance

UI de administración de usuarios y contratos (BL-27), portal externo
(EXTERNAL_APPROVER por UI), Scheduler/EDGE/Deploy, i18n y BL-26.

## Propuestas de mejora (≤ 3)

- **BL-28 · Prueba de accesibilidad automática** en `e2e-platform` con las
  reglas de axe-core sobre login, campañas y revisión. Requiere una
  dependencia de dev (`@axe-core/playwright`): decisión del auditor. ~0,5 día.
