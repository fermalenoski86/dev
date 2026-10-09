# M3A.1 — Fase E3a: `apps/platform-web` (esqueleto, sesión, CORS y campañas)

**Estado:** entregado para auditoría. Autorizado por el auditor al aprobar el
brief E3 ([#32](https://github.com/fermalenoski86/dev/pull/32#issuecomment-6088307539)):
"comenzar E3a … `apps/platform-web` base, cliente browser directo,
login/logout, campañas, CORS allowlist, documentación AUTH y ADR-063".
No toca `apps/control`, M2C.2, `e2e/`, la arquitectura de storage B1 ni el
contrato de rutas de la API (solo suma CORS).

**Rama:** `fase/m3a1-e3a` desde `main@8b448ad`. Brief: `docs/briefs/M3A1_FASE_E3.md` §E3a.

## Resultados (ejecución real, 2026-10-09, este entorno)

Node 22.22.0 · pnpm 12.5.1 · PostgreSQL 16.15 · ffprobe 6.1. Salida en `M3A1_FASE_E3A_SALIDA.txt`.

| Gate | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK. Lockfile: solo el importer nuevo `apps/platform-web` (versiones que ya usa el monorepo) |
| `pnpm verify` | **719 passed + 1 skipped** (17 nuevos de platform-web). Lint: 0 errores y los mismos 12 warnings |
| `pnpm build` | OK, incluye `apps/platform-web` (`/`, `/login`, `/campaigns`, estáticas) |
| PostgreSQL 16 | **264 passed + 6 skipped** (17 nuevos: `cors.db.test.ts` 14, `platform-web-client.db.test.ts` 3) |
| `bootstrap-smoke.sh` | 6 passed |
| media | 63 passed |
| mutaciones | **11/11 nuevas `e3a:` atrapadas** (tanda 247:258); autoprueba OK. La corrida completa de las 258 queda en CI |
| acceptance | 19 puntos y 12 tags; doc regenerado (solo cambia el motivo de E3-41/E3-47) |
| `docs:contract` | `openapi.json` sin diff; `DELIVERY.md` suma los 5 archivos de test |
| E2E M2C (14) | **No ejecutado localmente** (no hay Chrome con H.264). Evidencia: job `e2e-m2c` de CI |

Además, un **smoke de navegador real** (no es gate): Chromium con hosts
distintos `web.trust.test` / `api.trust.test` / `evil.trust.test`, API real y
`next start`. Login, cookie solo en el host de la API, alta de campaña,
logout → 401 y bloqueo desde un origen no listado. Detalle al final de la
SALIDA. El gate multihost con TLS y `__Host-` real es E3c.

## Qué se entrega

1. **CORS por allowlist exacta en `platform-api`** (`src/cors.ts`, registrado
   en `buildApp` antes de toda ruta; `TRUST_CORS_ORIGINS` en `server.ts` y
   `.env.example`).
   - Validación al arrancar: rechaza `*`, `null`, paths, barra final,
     credenciales en la URL, otros esquemas y, en producción, `http:`.
   - Origen permitido: `Access-Control-Allow-Origin: <origen>`,
     `Allow-Credentials: true`, `Expose-Headers` (`X-Request-Id`,
     `Idempotent-Replayed`, `Retry-After`).
   - Preflight: 204 con métodos y headers explícitos y `Max-Age: 600`. También
     responde sobre rutas inexistentes (no filtra un 404 al navegador).
   - Origen no listado: preflight 403 sin headers CORS; mutación →
     `403 ORIGIN_NOT_ALLOWED` antes de mirar la sesión, aunque traiga cookie y
     CSRF válidos, y sin escribir. Un GET responde sin headers CORS.
   - `Vary: Origin` siempre que llega `Origin`.
   - Sin `Origin`, o con la lista vacía: exactamente como antes de E3a.
   - Sin dependencias nuevas (hook `onRequest` de Fastify).
2. **`apps/platform-web`** (Next 14 + React 18 + Zod, versiones que ya usa el
   monorepo; sin rewrites ni proxy).
   - `src/lib/api.ts`: `PlatformClient` con `fetch` y `baseUrl` inyectados.
     Siempre `credentials: 'include'` y `cache: 'no-store'`. El CSRF vive solo
     en memoria: se toma de `login` o `/auth/me`; una mutación sin token pide
     `/auth/me` primero. Un 401 lo borra. Respuestas validadas con Zod; los
     errores del servidor llegan tal cual (código, mensaje, requestId).
   - `src/lib/session.ts`: guardas puras. Sin sesión → `/login?next=…`. `next`
     restringido a rutas internas (corta `//host`, `/\host`, esquemas,
     caracteres de control y bucles a `/login`).
   - `SessionGate`: la sesión se resuelve en el navegador (`GET /auth/me`),
     porque la cookie es de otro host (ADR-063). Muestra estado de carga,
     error de configuración (`NEXT_PUBLIC_TRUST_API_URL` ausente) o error de
     red.
   - `/login`: formulario con etiquetas, autocompletado y error
     `role="alert"`. Logout revoca en el servidor.
   - `/campaigns`: lista (contrato, working draft rev, APPROVED VERSION vN con
     el hash completo) y alta (contrato + nombre). Un 403 del servidor se
     muestra tal cual: la UI no reimplementa permisos.
   - Accesibilidad básica (BL-28, parte E3b/E3a): foco visible
     (`:focus-visible`), skip link, `caption` y `scope` en la tabla, estados
     con `role="status"`. axe y el recorrido solo con teclado son de E3c.
   - Encabezados `X-Content-Type-Options`, `Referrer-Policy` y
     `X-Frame-Options`; sin `X-Powered-By`.
3. **Docs**:
   - **ADR-063** (enlazado desde ADR-057): topología, por qué la cookie vive en
     el host de la API, same-site HTTPS, allowlist/CSRF, alternativas
     descartadas y gate multihost;
   - `docs/platform/AUTH.md` §"UIs de navegador y CORS";
   - `apps/platform-web/README.md`.
4. **Tests**:
   - `apps/platform-api/src/cors.db.test.ts` (14): parseo y arranque,
     preflight permitido y rechazado, credenciales, `Vary`, CSRF intacto,
     403 por origen sin escritura, GET de otro origen, sin `Origin` y sin
     allowlist. Usa la cookie de producción `__Host-trust_session`.
   - `apps/platform-api/src/platform-web-client.db.test.ts` (3): el cliente de
     la web contra la API real por HTTP. Un `fetch` hace de navegador (jar de
     la cookie de la API, `Origin`, exige los headers CORS para leer).
     - OPERATOR: login → me → contratos → crea campaña → logout revoca.
     - INTERNAL_APPROVER: crear da 403 del servidor.
     - Origen no listado: no puede loguearse.
   - `apps/platform-web/src/**`: 17 unitarios (cliente, guardas y vistas).
5. **11 mutaciones `e3a:`**: CORS con `*`, sin `Vary`, sin el 403 de defensa,
   preflight sin `X-CSRF-Token`, allowlist no exacta, `http` en producción,
   cliente sin credenciales, cliente sin CSRF, CSRF conservado después de un
   401, open redirect en `next` y sin redirección a login.
6. **Matriz BL-23**: E3-41 y E3-47 siguen ⏳ pendientes. Solo se actualizó su
   motivo: el E2E de navegador es E3c.

## Decisiones de Claude a validar

1. **Lista vacía = sin CORS y sin 403 por `Origin`.** El brief dice "Si está
   vacía, no hay CORS (comportamiento actual)". El 403 de defensa aplica solo
   con allowlist. Activarlo siempre cambiaría el comportamiento de despliegues
   sin UIs de navegador.
2. **Preflight de origen no listado → 403 con cuerpo JSON** (sin headers
   CORS). El navegador bloquea igual que con un 204 vacío, y el 403 deja rastro
   en logs (`cors.rejected`).
3. **GET de origen no listado → respuesta normal sin headers CORS** (no 403).
   Un GET no escribe, y el navegador no deja leerla. Los clientes sin `Origin`
   no cambian.
4. **El test del cliente vive en `apps/platform-api`**
   (`platform-web-client.db.test.ts`), donde están las dependencias de base y
   el job `postgres`. Importa el cliente por ruta relativa: `platform-web` no
   depende de paquetes de plataforma.
5. **Alta de campaña visible para todo rol.** Si el rol no puede, la API da
   403 y se muestra. No se oculta por rol en la UI, para no duplicar la regla.

## Propuestas de mejora (≤ 3)

- **BL-30 · `NEXT_PUBLIC_TRUST_API_URL` validada en el build de producción.**
  Problema: hoy un build sin la variable compila y la app muestra el error en
  runtime. Beneficio: un despliegue mal configurado falla antes de salir.
  Prioridad P2, ~1 h, dentro de E3c (cuando exista el job `e2e-platform` que
  construye con la variable). Criterio: `next build` con `NODE_ENV=production`
  sin la variable, o con una URL `http:`, falla con un mensaje claro.
