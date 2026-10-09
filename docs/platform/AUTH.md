# Auth y roles — platform-api (M3A.1 Fase C1)

Paquete `@trust/platform-auth` + rutas en `apps/platform-api`. ADR-057.
Requisitos: master §21–24 y §27; decisiones del auditor sobre el brief C
(comentario en el PR #7).

## Usuarios y passwords

- Alta **solo por CLI** (no hay endpoint):
  ```sh
  printf '%s' "$PASSWORD" | DATABASE_URL=… pnpm --filter @trust/platform-api user:create -- \
    --email ana@affinitas.com --name "Ana" --organization Affinitas --role OPERATOR --role INTERNAL_APPROVER
  # EXTERNAL_APPROVER va atado a un contrato: --role EXTERNAL_APPROVER:<contractId>
  ```
  La contraseña sale de stdin o de `TRUST_NEW_USER_PASSWORD`, nunca de un
  argumento. Audit `USER_CREATED` con actor `null` y sin email ni hash.
- Email normalizado (NFC, trim, minúsculas); la base además lo exige.
- **Argon2id** con `m=19456 KiB, t=2, p=1` (`ARGON2_PARAMS`, mínimo OWASP).
  La base rechaza cualquier hash que no sea `$argon2id$`. Política: 12–256
  caracteres.
- Benchmark reproducible antes de subir parámetros:
  `pnpm --filter @trust/platform-auth bench:argon2 -- --runs 20`. Medición en el
  sandbox de desarrollo (2 vCPU Xeon 2.1 GHz): actual p50≈19 ms;
  m=46 MiB/t=1 p50≈27 ms; m=64 MiB/t=3 p50≈146 ms. Hay que repetirlo en la
  infraestructura real.

## Sesiones

| Propiedad | Implementación |
|---|---|
| Token | 32 bytes aleatorios (256 bits), base64url. En la base, solo `sha256(token)` |
| Vencimiento | absoluto, del servidor (`expires_at`, reloj de PostgreSQL). `TRUST_SESSION_TTL_MINUTES`, 480 por defecto |
| Revocación | logout revoca la propia; cambio de roles revoca **todas** las del usuario; usuario deshabilitado → ninguna vale |
| Rotación | cada login crea una sesión nueva y revoca la que viniera en la cookie (sin session fixation) |
| Cookie | `HttpOnly; SameSite=Lax; Path=/`, sin `Domain`, `Expires` = vencimiento |
| Producción | nombre `__Host-trust_session` + `Secure` (forzado; `TRUST_COOKIE_SECURE=false` hace fallar el arranque) |

## CSRF

Token sincronizado atado a la sesión: `HMAC-SHA256(token de sesión, "trust-csrf-v1")`.
En la base se guarda su sha256 (`csrf_token_hash`). Lo devuelven `login` y
`/auth/me`; toda mutación con sesión (todo lo que no sea GET/HEAD/OPTIONS)
exige `X-CSRF-Token` igual al de **esa** sesión → si no, `403 CSRF_TOKEN_INVALID`,
antes de mirar roles o leer el cuerpo. El login no tiene sesión todavía: exige
`application/json` (`415` si no), que un formulario cross-site no puede mandar
sin preflight CORS, y la cookie es SameSite=Lax.

## UIs de navegador y CORS (E3a, ADR-063)

`apps/platform-web` y `apps/control` (Builder) llaman a la API **directo desde
el navegador**, con `credentials: 'include'`. La cookie de sesión es del host de
la API (host-only; `__Host-` en producción), así que **no hay proxy**: el login
también va directo a la API y esa única cookie le sirve a las dos UIs.

Despliegue: hosts HTTPS del **mismo site** (`web.<site>`, `control.<site>`,
`api.<site>`). Con `SameSite=Lax` la cookie viaja entre hosts del mismo site y
no entre sites distintos.

`TRUST_CORS_ORIGINS` (orígenes exactos separados por coma; vacío = sin CORS):

| Caso | Respuesta |
|---|---|
| Arranque con `*`, `null`, path, barra final o credenciales en la URL | falla el arranque |
| Arranque en producción con un origen `http:` | falla el arranque |
| Preflight de un origen listado | `204` con `Access-Control-Allow-Origin: <origen>`, `Allow-Credentials: true`, métodos `GET, POST, PUT, PATCH, OPTIONS`, headers `Content-Type, X-CSRF-Token, Idempotency-Key, X-Request-Id`, `Max-Age: 600` |
| Solicitud de un origen listado | headers CORS con credenciales; expone `X-Request-Id`, `Idempotent-Replayed`, `Retry-After` |
| Preflight de un origen no listado | `403 ORIGIN_NOT_ALLOWED`, sin headers CORS |
| Mutación con `Origin` no listado (aunque traiga cookie y CSRF válidos) | `403 ORIGIN_NOT_ALLOWED` antes de mirar la sesión; no escribe |
| GET con `Origin` no listado | la respuesta normal, **sin** headers CORS (el navegador no deja leerla) |
| Sin `Origin` (CLI, tests, servidor a servidor) | igual que antes de E3a |

Siempre que llega `Origin`, la respuesta lleva `Vary: Origin`. **CSRF no
cambia**: un origen permitido sin `X-CSRF-Token` sigue recibiendo
`403 CSRF_TOKEN_INVALID`. CORS decide quién lee; CSRF protege las escrituras.

En desarrollo por `http://localhost` la cookie no es `Secure` ni `__Host-` y los
puertos no separan cookies: eso no prueba la topología de producción. El gate
de navegador multihost (hosts distintos, TLS, cookie `__Host-` real) es de E3c.

## Login y rate limit

`POST /api/v1/auth/login` `{email, password}`:

1. Rate limit por email normalizado (5 / 15 min) y por dirección (50 / 15 min;
   IPv4 /32, IPv6 /64, IPv4-mapeada como IPv4). Si corta: `429 RATE_LIMITED` con
   `Retry-After`, **sin** Argon2 y **sin** audit.
2. Verificación en tiempo constante: si el usuario no existe o está deshabilitado
   se verifica contra un hash señuelo.
3. Respuesta idéntica para inexistente / password mala / deshabilitado:
   `401 INVALID_CREDENTIALS`.
4. Audit `AUTH_LOGIN_FAILED` `{reason: UNKNOWN_USER|BAD_PASSWORD|USER_DISABLED}`
   (inexistente → `actor_user_id = null`) o `AUTH_LOGIN_SUCCEEDED` (entidad =
   sesión). Nunca email, IP, password, cookie ni token.

**Memoria acotada** (auditoría C1 #1, OWASP API4:2023): la ventana es igual
para todas las claves y una clave solo se inserta cuando no existe, así que el
orden del `Map` es el orden de vencimiento; cada intento barre las vencidas
desde el principio (O(1) amortizado). Tope duro de 100 000 claves: al llegar,
se descarta la más vieja (`stats().evicted` lo cuenta). Para resetear el
contador de una víctima por esa vía, un atacante tendría que crear 100 000
claves dentro de la ventana, y cada dirección crea como mucho 50 claves de
email por ventana. Una IP inválida cae en un único balde y el email se recorta
a 320 caracteres: ningún valor del request crea claves arbitrarias.

La IP es la del socket salvo que se declare `TRUST_PROXY_HOPS` (detrás de un
reverse proxy hay que hacerlo, o todos comparten la IP del proxy). El contador
vive en memoria del proceso: con varias instancias cada una cuenta por su lado
(store compartido → BL-10).

## Rutas

| Ruta | Auth | Respuesta |
|---|---|---|
| `POST /api/v1/auth/login` | — | 200 `{user, roles, externalContractIds, csrfToken, expiresAt}` + cookie |
| `POST /api/v1/auth/logout` | sesión + CSRF | 204, cookie borrada, sesión revocada |
| `GET /api/v1/auth/me` | sesión | igual que login |
| `/api/v1/assets*` | sesión (+CSRF en POST), rol OPERATOR o ADMIN | ver API.md; sin rol → `403 FORBIDDEN` |

## Roles y scope por contrato (§22, §24)

- Roles: OPERATOR, INTERNAL_APPROVER, ADMIN, EXTERNAL_APPROVER; se combinan.
- La autorización es server-side y por ruta (`requireActor(provider, req, roles)`).
- Internos: alcance a todos los contratos del edificio. **EXTERNAL_APPROVER**:
  la fila existe y se testea, pero no da ningún permiso salvo que estén
  prendidos `EXTERNAL_APPROVAL_ENABLED=true` **y** `contracts.external_approval_enabled`;
  aun así, solo sobre sus contratos (`canAccessContract`). El `contractId` que
  manda el cliente nunca autoriza: el backend deriva `externalContractIds`.
- Los Assets siguen siendo visibles solo para quien los creó (como en B4).

## Provider de desarrollo

`DevelopmentActorProvider` (`X-Dev-Actor`) queda **solo para tests**: el
servidor ya no lo usa y no arranca si `TRUST_DEV_ACTOR_PROVIDER` está definida.
