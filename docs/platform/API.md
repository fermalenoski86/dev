# platform-api — M3A.1 Fase B4

`apps/platform-api` · Fastify 5 · contratos Zod en `src/contracts.ts`.
Arranque: `pnpm --filter @trust/platform-api start` (variables en `.env.example`).

## Rutas

| Método | Ruta | Qué hace | Respuestas |
|---|---|---|---|
| GET | `/health` | proceso vivo | 200 `{status:"ok"}` |
| GET | `/ready` | PostgreSQL (`SELECT 1`) + storage (`ping`) + binarios de medios (chequeados UNA vez al arrancar) | 200 `ready` / 503 `not_ready` con `checks` |
| POST | `/api/v1/assets` | upload multipart → pipeline B3 | 201 READY · 200 replay · 4xx/5xx contrato de error |
| GET | `/api/v1/assets/:id` | un Asset del actor | 200 · 400 · 401 · 404 |
| GET | `/api/v1/assets/:id/status` | `{id, status, rejection}` | 200 · 400 · 401 · 404 |
| GET | `/api/v1/assets?status=&limit=&cursor=` | Assets del actor, más nuevos primero | 200 `{items, nextCursor}` · 400 |

No hay `PATCH`, `PUT` ni `DELETE` de Assets (§26): responden 404 `NOT_FOUND`.

## Estrategia de upload (una sola, §18)

Una solicitud `multipart/form-data`: **primero los campos**, después el archivo.

| Parte | Obligatoria | Validación |
|---|---|---|
| `surfaceType` | sí | tiene que existir en `deriveSurfaceFormats(EL_TRUST)` |
| `requiredDurationMs` | no | entero 1…3 600 000 |
| `file` | sí | el archivo; fluye por stream al temporal |

Headers: `Idempotency-Key` (obligatorio, 8–200 ASCII visibles) y, en
desarrollo, `X-Dev-Actor`. Cualquier otro campo → 400.

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
curl -H "X-Dev-Actor: $USER_UUID" -H "Idempotency-Key: campania-42-master-v1" \
     -F surfaceType=horizontal -F "file=@master.mp4;type=video/mp4" \
     http://127.0.0.1:4000/api/v1/assets
```

Salida real de estos comandos (READY, replay, REJECTED, 401):
`pnpm --filter @trust/platform-api smoke`, copiada en `docs/reviews/M3A1_FASE_B4_SALIDA.txt`.

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

## Identidad (§19) — DEV ONLY

`RequestActor { userId, source }` lo resuelve un `ActorProvider`. Hoy existe solo
`DevelopmentActorProvider`: lee `X-Dev-Actor`, exige un usuario **existente y
habilitado** en la base y, si no, 401. No hay UUID por defecto. `createServer`
se niega a arrancar con `NODE_ENV=production` o sin
`TRUST_DEV_ACTOR_PROVIDER=enabled`. Fase C reemplaza el provider por sesión real
sin tocar rutas ni servicios.

Visibilidad hasta Fase C: un actor ve solo los Assets que creó; lo ajeno es 404
(no 403, para no revelar existencia).

## Observabilidad (§23)

Logs JSON (pino). `requestId` por request: el `X-Request-Id` del cliente si es
seguro (`[A-Za-z0-9._-]{8,128}`), si no un UUID; vuelve en el header y en todo
error. El upload registra `assetId, requestId, bytes, durationMs, result,
rejection, replayed, filename` (versión `displayFilename`). Se redactan
`authorization`, `cookie`, `x-dev-actor` e `idempotency-key`; nunca se loggea
el contenido del archivo.

## Docker Compose (§35)

`docker-compose.yml` (postgres 16, minio, platform-api) queda preparado y **no
fue ejecutado**: el entorno de los agentes no tiene Docker.
