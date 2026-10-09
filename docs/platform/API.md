# platform-api — M3A.1 Fase B4

`apps/platform-api` · Fastify 5 · contratos Zod en `src/contracts.ts`.
Arranque: `pnpm --filter @trust/platform-api start` (variables en `.env.example`).

## Rutas

Contrato completo y verificado contra el registro de Fastify (E1 · BL-11):
[`openapi.json`](openapi.json) e inventario en [`DELIVERY.md`](DELIVERY.md),
regenerados con `pnpm docs:contract` (CI exige diff vacío).

| Método | Ruta | Qué hace | Respuestas |
|---|---|---|---|
| GET | `/health` | proceso vivo | 200 `{status:"ok"}` |
| GET | `/ready` | PostgreSQL (`SELECT 1`) + storage (`ping`) + binarios de medios (chequeados UNA vez al arrancar) | 200 `ready` / 503 `not_ready` con `checks` |
| POST | `/api/v1/assets` | upload multipart → pipeline B3 | 201 READY · 200 replay · 4xx/5xx contrato de error |
| GET | `/api/v1/assets/:id` | un Asset del actor | 200 · 400 · 401 · 404 |
| GET | `/api/v1/assets/:id/status` | `{id, status, rejection}` | 200 · 400 · 401 · 404 |
| GET | `/api/v1/assets?status=&limit=&cursor=` | Assets del actor, más nuevos primero | 200 `{items, nextCursor}` · 400 |
| GET | `/api/v1/show-versions/:id` | versión con estado derivado, evidencia y manifiesto (C2) | ver `APPROVAL.md` |
| POST | `/api/v1/show-versions/:id/evidence` | evidencia multipart, detección por bytes (C2) | ver `APPROVAL.md` |
| GET | `/api/v1/show-versions/:id/evidence/:evidenceId` | descarga (`attachment`, `nosniff`, CSP sandbox) (C2) | ver `APPROVAL.md` |
| POST | `/api/v1/show-versions/:id/approve` | aprobar con evidencia y hash exacto (C2) | ver `APPROVAL.md` |
| POST | `/api/v1/show-versions/:id/reject` | rechazar con motivo y hash exacto (C2) | ver `APPROVAL.md` |
| PUT | `/api/v1/contracts/:id/four-eyes` | política de cuatro ojos, solo ADMIN (C2) | ver `APPROVAL.md` |
| * | `/api/v1/advertisers`, `/api/v1/contracts[/:id]`, `/api/v1/campaigns[/:id]`, `/api/v1/campaigns/:id/draft` | Advertiser/Contract/Campaign y draft con `expectedRevision` (D1) | ver `CAMPAIGNS.md` |
| POST | `/api/v1/campaigns/:id/submit` | envía el Draft persistido: compila, preflight, ShowVersion inmutable (C3) | ver `APPROVAL.md` §Submit |

No hay `PATCH`, `PUT` ni `DELETE` de Assets (§26): responden 404 `NOT_FOUND`.

## Estrategia de upload (una sola, §18)

Una solicitud `multipart/form-data`: **primero los campos**, después el archivo.

| Parte | Obligatoria | Validación |
|---|---|---|
| `surfaceType` | sí | tiene que existir en `deriveSurfaceFormats(EL_TRUST)` |
| `requiredDurationMs` | no | entero 1…3 600 000 |
| `file` | sí | el archivo; fluye por stream al temporal |

Headers: `Idempotency-Key` (obligatorio, 8–200 ASCII visibles), la cookie de
sesión y `X-CSRF-Token` (C1, ver AUTH.md). Cualquier otro campo → 400. **`file` es la última
parte**: un campo o un segundo archivo después de `file` → 400
`VALIDATION_ERROR`. El archivo fluye al temporal mientras llega; antes de crear
el Asset o reservar la Idempotency-Key se lee el resto del multipart, y si trae
algo más se rechaza sin dejar Asset, key ni temporal (auditoría B4 #1).

¿Por qué no `uploads` + `finalize`? Una sola solicitud alcanza con la
idempotencia por contenido de B3 (el fingerprint incluye el sha256 del cuerpo, o
el de los primeros `límite+1` bytes si es demasiado grande) y evita un estado
"subido sin finalizar" que habría que limpiar. Consecuencia aceptada por el
auditor en B3: no hay un Asset `UPLOADING` observable durante la transferencia;
el progreso, si hace falta, sale de la conexión HTTP.

Límite: `MAX_UPLOAD_BYTES`. Busboy corta en `límite + 1` (sin lanzar) y
`limitBody` (B3) rechaza con `ASSET_TOO_LARGE` y la huella del prefijo. Nada se
arma en memoria: la prueba "upload por HTTP real" sube con `fetch` desde un
`Blob` leído del disco.

```bash
curl -c jar -H 'content-type: application/json' \
     --data '{"email":"ana@affinitas.com","password":"…"}' http://127.0.0.1:4000/api/v1/auth/login   # → csrfToken
curl -b jar -H "X-CSRF-Token: $CSRF" -H "Idempotency-Key: campania-42-master-v1" \
     -F surfaceType=horizontal -F "file=@master.mp4;type=video/mp4" \
     http://127.0.0.1:4000/api/v1/assets
```

Salida real de estos comandos (login, CSRF, READY, replay, REJECTED, logout, 401):
`pnpm --filter @trust/platform-api smoke`, copiada en `docs/reviews/M3A1_FASE_C1_SALIDA.txt`
(la de B4, con `X-Dev-Actor`, queda en `M3A1_FASE_B4_SALIDA.txt`).

## Mapeo HTTP del resultado

| Resultado | HTTP | Cuerpo |
|---|---|---|
| READY | 201 (200 si es replay, header `Idempotent-Replayed: true`) | el Asset |
| `ASSET_TOO_LARGE` | 413 | contrato de error, `details.asset` |
| `ASSET_BAD_CONTAINER` | 415 | ídem |
| `ASSET_STORAGE_ERROR`, `ASSET_INSPECTION_TIMEOUT` | 503 | ídem (problema nuestro o transitorio) |
| demás rechazos de media | 422 | ídem |
| Idempotency-Key reusada con otro contenido | 409 `IDEMPOTENCY_KEY_REUSED` | — |
| sin Idempotency-Key | 400 `IDEMPOTENCY_KEY_REQUIRED` | — |
| límite por actor (BL-10) | 429 `RATE_LIMITED` + header `Retry-After` (s) | `details: { reason: "CONCURRENCY" \| "RATE", retryAfterSeconds }` |
| cuerpo no multipart | 415 `UNSUPPORTED_MEDIA_TYPE` | — |
| `surfaceType` inexistente | 400 `INVALID_SURFACE_TYPE` | `details.accepted` |
| input inválido | 400 `VALIDATION_ERROR` | `details.issues[]` (path + mensaje) |
| sin actor | 401 `UNAUTHENTICATED` | — |
| Asset inexistente o ajeno | 404 `ASSET_NOT_FOUND` | — |
| cualquier otra cosa | 500 `INTERNAL_ERROR`, mensaje fijo | — |

Contrato de error (§22): `{ code, message, details?, requestId }`. Nunca:
stack, SQL, paths, stderr, secretos (test con base caída y password en la URL).

Cada rechazo trae `rejection.remediation` (BL-03): `summary` y, si se arregla
transcodificando, `ffmpeg.args` (arreglo con los marcadores `{input}` y
`{output}`; el servidor no interpola ni ejecuta nada) y `displayCommand`. Se
deriva de la misma autoridad que valida; un test real aplica la receta a cada
fixture rechazable y el resultado pasa `checkMedia`.

## Límite de uploads por actor (BL-10, E1 · §39)

Por **actor autenticado** (no por IP), en `POST /api/v1/assets`:

- concurrencia: `UPLOAD_MAX_CONCURRENT_PER_ACTOR` (default 2, rango 1–32)
  uploads/inspecciones a la vez; un 429 `CONCURRENCY` trae `Retry-After: 1`;
- tasa: `UPLOAD_MAX_PER_MINUTE_PER_ACTOR` (default 30, rango 1–10000) uploads
  empezados por ventana fija de 60 s; un 429 `RATE` trae los segundos que
  faltan para que se abra la ventana.

Se consulta después de autenticar y validar la Idempotency-Key y el
`content-type`, y **antes de leer el cuerpo y de reservar la key**: un 429 no
deja temporal, ni Asset, ni key reservada (la misma key sirve al reintentar).
Los 400/401/403/415 no consumen cupo. El cupo de concurrencia se devuelve
siempre, también si el upload falla. Tests: `upload-limits.db.test.ts`.

**Límite conocido**: el contador vive en memoria del proceso. Con varias
instancias detrás de un balanceador cada una cuenta por su lado (el límite
efectivo es N × el configurado). Un store compartido es trabajo futuro; hasta
entonces, desplegar una instancia o dividir los valores por la cantidad de
instancias. La concurrencia de procesos ffprobe/ffmpeg ya está acotada por
proceso con `MEDIA_INSPECTION_CONCURRENCY`.

## Identidad (§19) — sesión desde C1

`RequestActor { userId, source, roles, externalContractIds, session? }` lo
resuelve un `ActorProvider`. Desde C1 `createServer` usa **solo**
`SessionActorProvider` (cookie de sesión server-side, CSRF en mutaciones, roles
derivados en el backend): ver `docs/platform/AUTH.md`. `DevelopmentActorProvider`
(`X-Dev-Actor`) queda solo para tests. Las rutas de Assets exigen OPERATOR o
ADMIN (403 `FORBIDDEN`).

Visibilidad: un actor ve solo los Assets que creó; lo ajeno es 404 (no 403,
para no revelar existencia).

## Observabilidad (§23)

Logs JSON (pino). `requestId` por request: el `X-Request-Id` del cliente si es
seguro (`[A-Za-z0-9._-]{8,128}`), si no un UUID; vuelve en el header y en todo
error. El upload registra `assetId, requestId, bytes, durationMs, result,
rejection, replayed, filename` (versión `displayFilename`). Se redactan
`authorization`, `cookie`, `x-dev-actor`, `x-csrf-token`, `set-cookie` e `idempotency-key`; nunca se loggea
el contenido del archivo.

## Docker Compose (§35)

`docker-compose.yml`: `docker compose up` levanta postgres 16 y platform-api
(storage local, el default de `.env.example`), con imágenes fijadas por
digest. El entorno de los agentes no tiene daemon de Docker: el smoke real
corre en CI, job `compose-smoke` (`scripts/ci/compose-smoke.sh`): bootstrap
con psql (dos veces), `pnpm db:migrate` como `trust_owner` (dos veces),
`/ready` con database, storage y media en `ok` y login inválido = 401.

S3 de dev/CI: **SeaweedFS 4.48** fijado por digest, detrás del perfil `s3`
(`docker compose --profile s3 up`; S3 en `127.0.0.1:9000`, credenciales de
ejemplo en `docker/seaweedfs/s3.json`). Reemplaza a MinIO, que ya no se
distribuye sin login (decisión de Fer en #22). **Solo dev/CI**: no elige el
proveedor de producción, que tiene que cumplir versioning y Object Lock
(`docs/ops/BACKUPS.md`). `compose-smoke` crea el bucket, corre el contrato S3
completo (`s3.contract.test.ts`, 15 tests) contra SeaweedFS y levanta
platform-api también con `STORAGE_DRIVER=s3` (`/ready` en `ok`).

Todos los puertos del compose (5433, 9000, 4000) se publican **solo en
`127.0.0.1`** del host: las credenciales de ejemplo de SeaweedFS tienen permisos
de administración y no pueden quedar expuestas a la red. `compose-smoke` falla si
la config renderizada publica algún puerto fuera de `127.0.0.1` y comprueba el
bind real con `docker compose port seaweedfs 8333` (= `127.0.0.1:9000`). El bind
`0.0.0.0` de platform-api (`HOST`) y de SeaweedFS (`-ip.bind`) es *dentro* del
contenedor, necesario para la red interna del compose.
