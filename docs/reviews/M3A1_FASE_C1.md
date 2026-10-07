# M3A.1 — Fase C1: auth, sesiones, CSRF, roles y scope por contrato

**Estado:** entregado para auditoría. C2 (approval) y C3 (submit) **no iniciados**.
B1–B4 sin cambios de arquitectura; M2C.2 sin tocar.

**Rama:** `fase/m3a1-c` · PR #7 contra `main` (sincronizada con `main` en
`8262c83`, que ya trae B2–B4). Brief aprobado con decisiones:
`docs/briefs/M3A1_FASE_C.md`. ADR-057. Detalle técnico: `docs/platform/AUTH.md`.

**CI independiente:** se completa con el link del run sobre el HEAD exacto en el
comentario de entrega del PR #7.

## Resultados (ejecución real, 2026-10-07, este entorno)

Node 22.22.0 · pnpm 12.5.1 · PostgreSQL 16 · ffmpeg 6.1.1. Salida completa en
`M3A1_FASE_C1_SALIDA.txt`.

| Gate | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK (nuevas: @node-rs/argon2 2.0.2, @fastify/cookie 11.0.2) |
| `pnpm verify` | **625 passed + 1 skipped**, lint 0 errores (11 warnings preexistentes) |
| `pnpm build` | OK |
| PostgreSQL 16 (`vitest.platform.config.ts`) | **141 passed + 6 skipped** (nuevos: 12 platform-auth, 14 auth HTTP, 3 CLI, 1 de rol en api) |
| `bootstrap-smoke.sh` | 6 passed |
| media (`vitest.media.config.ts`) | 63 passed |
| mutaciones (150 reglas) | corrida completa: 149 atrapadas, **1 sobrevivió** (IPv6 /64: su comando no corría el test unitario que la atrapa). Comando corregido y regla re-corrida: atrapada → 150/150. El CI corre las 150 juntas |
| E2E M2C (14) | **no corrido localmente** (sin Chrome con H.264); evidencia: job `e2e-m2c` del CI |
| smoke con curl | OK: login, me, 403 sin CSRF, upload READY, replay, REJECTED, logout, 401 |
| `bench:argon2` | m19/t2/p1 p50≈19 ms en este entorno |

## Qué se entrega

1. **`@trust/platform-auth`** (nuevo): `password` (Argon2id explícito, hash
   señuelo, política 12–256), `tokens` (256 bits, sha256, CSRF por HMAC),
   `sessions` (emitir, buscar, revocar, revocar todas, roles efectivos),
   `rate-limit` (email + dirección IPv4 /32 · IPv6 /64), `access` (roles y
   scope por contrato), `users` (alta y cambio de roles con audit), `login`.
2. **platform-api:** `SessionActorProvider`; `requireActor(provider, req, roles)`
   con CSRF en toda mutación con sesión y rol por ruta; `POST /api/v1/auth/login`,
   `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`; Assets exigen OPERATOR o
   ADMIN; `createServer` usa solo sesión (el provider DEV queda para tests y
   `TRUST_DEV_ACTOR_PROVIDER` hace fallar el arranque); `TRUST_PROXY_HOPS`.
3. **CLI** `user:create` (password por stdin o variable, nunca por argumento).
4. **Audit:** `AUTH_LOGIN_SUCCEEDED` / `AUTH_LOGIN_FAILED` en la unión de
   acciones; sin email/IP/password/cookie/token.
5. **Benchmark** `bench:argon2` con la medición de este entorno en AUTH.md.
6. **Smoke con curl** que se loguea de verdad (cookie jar + CSRF).
7. **Mutaciones nuevas (19):** las 6 pedidas en el brief (Argon2id omitido,
   sesión sin expiración, CSRF omitido, rol ignorado, external habilitado,
   cross-contract permitido) y 13 más (parámetros Argon2 bajados, revocada
   vale, deshabilitado conserva sesión, CSRF de otra sesión, cambio de rol sin
   revocar, login sin rotar, rate limit después del audit, rate limit apagado,
   IPv6 por dirección completa, email en el audit, cookie sin HttpOnly, login
   no-JSON, logout sin revocar).

## Cómo cumple las decisiones del auditor

| Decisión | Dónde |
|---|---|
| 3 · audit de login, actor null si no existe, sin datos sensibles, rate limit antes | `login.ts`; tests `auth.db.test.ts` (platform-auth) "inexistente, password mala y deshabilitado…" y "rate limit: el intento cortado NO… escribe audit"; mutaciones "audit de login con email", "rate limit después del audit" |
| 5 · token ≥128 bits, solo hash | `tokens.ts` (256 bits); test "éxito: sesión nueva, token solo hasheado" |
| 5 · rotación en login y en cambio de privilegios | `auth-routes.ts` (revoca la previa), `users.setUserRoles` (revoca todas); tests de rotación en ambos niveles |
| 5 · vencimiento y revocación server-side | `lookupSession` con el reloj de PostgreSQL; tests de vencida/revocada/deshabilitado |
| 5 · cookie `__Host-`, host-only, Secure, HttpOnly, Lax, Path=/ | test "producción: cookie `__Host-`…"; arranque falla en prod sin Secure |
| 5 · Argon2id explícito ≥ m19/t2/p1 + benchmark | `ARGON2_PARAMS`; CHECK de la base; `bench:argon2` |
| 4 · scope de contrato server-side | `access.canAccessContract` + tests de acceso cruzado (las rutas de C2 lo van a usar) |

## Decisiones (para validar)

1. **Rutas bajo `/api/v1/auth/*`** (§29 versiona toda la API; §30 lista
   `/auth/*` relativo a esa base).
2. **CSRF = HMAC(token de sesión)** en vez de un segundo aleatorio: atado a la
   sesión, `/auth/me` lo puede volver a dar sin guardarlo en claro; la base
   guarda su sha256 y `lookupSession` lo compara.
3. **Login exige `application/json`** (415 si no) como defensa de login-CSRF,
   sumada a SameSite=Lax.
4. **Scope:** los roles internos alcanzan a todos los contratos (§24 solo
   restringe a EXTERNAL_APPROVER); EXTERNAL_APPROVER necesita flag global +
   contrato habilitado y aun así solo ve los suyos.
5. **Assets:** OPERATOR o ADMIN; la visibilidad sigue siendo por creador (como
   en B4). Compartir entre operadores es decisión aparte.
6. **Rate limit en memoria** con límites 5/15 min por email y 50/15 min por
   dirección; un login exitoso libera el email, no la dirección. Multiinstancia
   → BL-10.
7. **Audit de login fallido por usuario deshabilitado** lleva el id del usuario
   (la decisión 3 solo pide null para el inexistente).

## No hecho a propósito

C2 (evidencia, approve/reject), C3 (submit), BL-10, BL-11. Idle timeout de
sesión (solo vencimiento absoluto; ver propuestas). UI de login.

## Propuestas de mejora (≤ 3)

- **BL-12 · Rechazar passwords filtradas en el alta.** NIST SP 800-63B §5.1.1.2
  pide comparar contra listas de passwords comprometidas; OWASP ASVS 4.0 V2.1.7
  igual. Propuesta: lista local versionada (top 100k, sin red) consultada en
  `assertPasswordPolicy`. ~0,5 día. Criterio: `user:create` con una password de
  la lista falla con `WEAK_PASSWORD`.
- **BL-13 · Idle timeout además del vencimiento absoluto.** OWASP Session
  Management Cheat Sheet ("Session Expiration"): las aplicaciones de riesgo
  alto usan idle de 2–5 min y las de bajo riesgo 15–30 min, además del absoluto.
  Propuesta: `last_seen_at` en `sessions` (migración 0003) actualizado como
  mucho una vez por minuto, idle de 30 min configurable. ~0,5 día. Criterio:
  test que mueve `last_seen_at` y la sesión deja de valer.

Fuentes: https://pages.nist.gov/800-63-3/sp800-63b.html ·
https://github.com/OWASP/ASVS/blob/v4.0.3/4.0/en/0x11-V2-Authentication.md ·
https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
