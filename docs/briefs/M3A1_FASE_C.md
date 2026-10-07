# M3A.1 — FASE C: auth, roles y approval — brief derivado

**Origen:** `M3A1_MASTER.md` §44 (FASE C = auth · roles · approval), con los
requisitos de §17–24, §27, §28, §30, §38–40. A diferencia de Fase B, **no hay
un brief escrito por Fer para Fase C**: este documento no agrega requisitos.
Solo ordena los del master en checkpoints y deja marcado lo que el master no
decide. Cada punto cita su sección.

**Propuesto por Claude el 2026-10-07; aprobado por el auditor el mismo día con
las decisiones de abajo** (comentario en el PR #7). Los ❓ originales quedan
resueltos por esas decisiones; ver ADR-057.

### Decisiones del auditor (vinculantes)

1. **C3 (submit) es parte de Fase C**, testeado sobre un Draft persistido por
   fixture/servicio, sin UI.
2. **Evidencia:** `POST /show-versions/:id/evidence`, límite configurable, hash
   por stream; detección por **bytes reales** con allowlist cerrada (OTHER solo
   para tipos inertes documentados); se sirve siempre como descarga
   (`Content-Disposition: attachment`, `nosniff`). Tests de MIME declarado falso,
   tamaño y contenido rechazado.
3. **Audit:** se aceptan `AUTH_LOGIN_SUCCEEDED` y `AUTH_LOGIN_FAILED`.
   Inexistente → `actor_user_id = null`. La metadata nunca lleva email,
   password, cookie, token ni IP cruda. El rate limit va antes de que crezca el audit.
4. **Autorización C2:** rol + scope de contrato server-side en lectura de
   ShowVersion, evidencia, approve y reject. Tests: INTERNAL_APPROVER fuera de
   scope, EXTERNAL_APPROVER deshabilitado y acceso cruzado.
5. **Sesiones y passwords:** token ≥128 bits, solo su hash persistido; rotación
   en login y en cambio de privilegios; vencimiento y revocación server-side.
   Cookie de producción `__Host-`, host-only, Secure, HttpOnly, SameSite=Lax,
   Path=/. Argon2id con parámetros explícitos, al menos m=19 MiB / t=2 / p=1, y
   benchmark reproducible registrado antes de elegir valores mayores.

BL-10 se implementa después de tener actor real (C1); BL-11 sigue como spike aparte.

Ya existe y NO se rehace (Fase A/B): las tablas `users`, `user_roles`,
`sessions`, `approval_evidence` y `approvals`; el trigger de cuatro ojos; la
cadena de audit; la idempotencia; `createShowVersion`; el storage
content-addressed; platform-api con `ActorProvider`. M2C.2 sigue congelado
(§42). No se toca Scheduler, EDGE ni Deploy.

---

## C1 — Auth y roles (§21, §22, §23, §24, §39)

1. **Usuarios.** Argon2id (§21) con `@node-rs/argon2`: binario prebuilt, sin
   postinstall, compatible con `allowBuilds`. Email único normalizado (ya
   existe el CHECK). Alta de usuarios **solo por CLI de administración**
   (`pnpm --filter @trust/platform-api user:create`), con audit `USER_CREATED`.
   Por API no se crean usuarios (§30 no lo lista).
2. **Sesiones server-side** (§23) en la tabla `sessions`. Se guarda el
   sha256 del token, nunca el token. Cookie `HttpOnly`, `SameSite=Lax`,
   `Secure` en producción, `Path=/`. Expiran y se pueden revocar. Logout
   revoca la sesión.
3. **CSRF** (§23) en toda mutación con sesión: token sincronizado contra
   `csrf_token_hash`, header `X-CSRF-Token`. GET/HEAD sin efectos.
4. **Rate limiting de login** (§23): por email normalizado y por dirección
   (IPv4 /32, IPv6 /64, por el bypass citado en BL-10). Respuesta 429 con
   `Retry-After`. Mensaje de error idéntico para usuario inexistente y
   password incorrecta, y tiempo constante: se verifica contra un hash dummy.
5. **Rutas** (§30): `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
   (usuario, roles y token CSRF).
6. **`SessionActorProvider`** reemplaza a `DevelopmentActorProvider` en
   producción sin tocar servicios (ADR-056). `RequestActor` suma `roles` y
   `contractIds`. El provider de desarrollo queda solo para tests.
7. **Roles** (§22): OPERATOR, INTERNAL_APPROVER, ADMIN, EXTERNAL_APPROVER,
   y una persona puede tener varios. La autorización es server-side, por ruta
   (§23). Upload y lectura de Assets: OPERATOR o ADMIN. **EXTERNAL_APPROVER
   está modelado y testeado, pero deshabilitado por defecto** (flag
   `EXTERNAL_APPROVAL_ENABLED=false` y `contracts.external_approval_enabled`).
8. **Scope por contrato** (§24): el backend deriva los contratos visibles. El
   `contractId` que manda el cliente nunca autoriza nada. Tests de acceso
   cruzado.
9. **Audit** (§27): `USER_CREATED`, `ROLE_CHANGED`, `AUTH_LOGIN_SUCCEEDED` y
   `AUTH_LOGIN_FAILED` (decisión 3).

**Estado C1:** implementado en este PR; detalle en `docs/platform/AUTH.md` y
`docs/reviews/M3A1_FASE_C1.md`.

Gate C1: verify, build, PG, bootstrap, media, mutaciones (nuevas: hash
Argon2id omitido, sesión sin expiración, CSRF omitido, rol ignorado,
external habilitado, cross-contract permitido) y E2E M2C. El CI es la
evidencia independiente.

## C2 — Approval (§17–20, §28)

1. **Evidencia** (§19, decisión 2): `POST /show-versions/:id/evidence` multipart, por el mismo storage content-addressed
   que los Assets: hash incremental, límite, nombre como metadata. Inmutable
   (trigger existente). Tipos: EMAIL, PDF, MESSAGE, OTHER.
   Detección por bytes reales con allowlist cerrada (OTHER solo para tipos
   inertes documentados), sin ejecutar nada; se sirve como descarga
   (`Content-Disposition: attachment`, `nosniff`).
2. **Aprobar / rechazar** (§17, §20): `POST /show-versions/:id/approve`
   (evidencia obligatoria) y `POST /show-versions/:id/reject` (motivo
   obligatorio). Requieren INTERNAL_APPROVER, o EXTERNAL_APPROVER del contrato
   si está habilitado. Siempre sobre la ShowVersion exacta y su hash. Las
   transiciones inválidas dan 409 `INVALID_STATE_TRANSITION`. Ambas usan
   Idempotency-Key (§28): un reintento no duplica.
3. **Cuatro ojos** (§18): quien envió no aprueba, aunque tenga los dos roles.
   Ya lo garantiza el trigger. La API devuelve 403 `FOUR_EYES_VIOLATION`.
   Para desactivarlo hace falta ADMIN, y queda el audit `FOUR_EYES_DISABLED`
   por contrato.
4. **Audit** (§27): `VERSION_APPROVED` y `VERSION_REJECTED` en la misma
   transacción que la Approval.
5. Lectura `GET /show-versions/:id`, con el estado derivado de su Approval.

Gate C2: lo de C1 más las mutaciones de §46 (four eyes, approve sin
evidencia, reject sin motivo, transición inválida, retry duplicado).

**Estado C2:** implementado en `fase/m3a1-c2`; detalle en `docs/platform/APPROVAL.md`
y `docs/reviews/M3A1_FASE_C2.md`.

## C3 — Submit (dentro de Fase C, decisión 1)

§17 dice que enviar exige preflight válido, compila server-side, crea la
ShowVersion y congela el hash. Eso necesita leer el Draft de una Campaign
(§8, §30 `/campaigns/:id/draft`), que es la frontera con **Fase D** (Builder
repository integration, §31).

Acordado: **C3 = `POST /campaigns/:id/submit` sobre el Draft que ya está en
la base** (compilador y preflight existentes, `createShowVersion`,
`VERSION_SUBMITTED`, Idempotency-Key), **sin** CRUD de Campaign ni
sincronización del Builder, que quedan para D. Se testea sobre un Draft
persistido por fixture/servicio, sin UI.

## Fuera de alcance

Portal externo, Builder sync, Campaign CRUD completo, Scheduler, EDGE,
Deploy, Proof of Play, billing. BL-10 (rate limit por actor en uploads) y
BL-11 (OpenAPI) van en sus propios PR después de C1, con los ajustes que
acordó el auditor (ver `docs/collab/BACKLOG.md`).
