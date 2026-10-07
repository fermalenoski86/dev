# Asset pipeline — M3A.1 Fase B3

`@trust/platform-assets` · `AssetUploadService`. Une storage (B1), inspección de
medios (B2), PostgreSQL y auditoría. Sin API todavía (B4).

## Algoritmo

No hay transacción distribuida entre la base y el storage. La estrategia es
compensatoria y cada frontera está elegida para que **ningún fallo deje un
estado que diga más de lo que es cierto**.

| # | Paso | Dónde | Si falla |
|---|---|---|---|
| 0 | `surfaceType` contra `deriveSurfaceFormats(EL_TRUST)` | app | error de request; no se crea Asset |
| 1 | stream → temporal (`tempId` = UUID del servidor), SHA-256 y bytes **durante** el stream, corte en `MAX_UPLOAD_BYTES` | storage | límite → paso 4 (`ASSET_TOO_LARGE`); otro error → excepción, temporal borrado |
| 2 | Idempotency-Key (opcional): fingerprint = operación + surface + nombre + **sha256 + tamaño** | DB (fila bloqueada) | otra solicitud con la key → `409 IDEMPOTENCY_KEY_REUSED` |
| 3 | TX: Asset `UPLOADING` + `ASSET_UPLOADED` | DB | excepción |
| 4 | vacío / grande → TX: `REJECTED` + `ASSET_REJECTED` | DB | — |
| 5 | TX: `VALIDATING` (sha256, tamaño) + `ASSET_VALIDATION_STARTED` | DB | excepción |
| 6 | ffprobe → validar → decode de un frame (B2) | media | rechazo → TX `REJECTED` con código + detalle; integridad del storage → `ASSET_STORAGE_ERROR`; infraestructura → excepción, Asset queda `VALIDATING` |
| 7 | `commitContentAddressed` (idempotente, dedup verificando el SHA-256 real) | storage | integridad → `ASSET_STORAGE_ERROR` |
| 8 | TX: StoredObject (crear o reusar por sha256) + Asset `READY` + `ASSET_VALIDATED` | DB | ver abajo |
| 9 | `finally`: borrar el temporal | storage | queda para `cleanupTemporaryObjects(TTL)` |

### Por qué el Asset se crea después del stream

El brief lista "crear Asset UPLOADING" antes de "recibir stream". Se invirtió a
propósito: el fingerprint de idempotencia tiene que incluir el **contenido**
(misma key + otros bytes = 409), y el contenido solo se conoce al terminar el
stream. Si el Asset naciera antes, cada retry HTTP crearía un Asset más (y al
rechazarlo quedaría un Asset terminal duplicado). Así, un retry nunca crea un
segundo Asset. El estado `UPLOADING` existe y se audita (`ASSET_UPLOADED`), pero
dura lo que tarda una transacción.

### Fallo de la base después del commit de storage (§33)

- El blob final queda como objeto content-addressed **huérfano y seguro**: su
  clave es su sha256, nadie lo borra, y otro upload del mismo contenido lo
  reusa (dedup). No se borra nunca un blob final por el fallo de un Asset: otro
  Asset podría estar usándolo.
- El Asset queda `VALIDATING` (no terminal). Ningún evento dice `VALIDATED`: el
  evento va en la misma transacción que `READY`.
- La reserva de la Idempotency-Key se revierte con el fallo. El retry con la
  misma key corre el pipeline de nuevo, deduplica el blob y llega a `READY`; un
  tercer intento ya es replay.

Probado con una falla real de PostgreSQL (trigger del dueño del esquema), no con
un mock: `upload.db.test.ts`, "fallo de la base DESPUÉS del commit de storage".

### Consistencia READY ↔ StoredObject (§14)

La migración 0002 lo hace cumplir **en la base** (trigger
`assets_transition_ready`), aunque la app se equivoque:

- `stored_object_id` apunta a un StoredObject real (`ASSET_OBJECT_MISSING`);
- `asset.sha256 = stored_object.sha256` (`ASSET_SHA_MISMATCH`);
- `asset.size_bytes = stored_object.size_bytes` (`ASSET_SIZE_MISMATCH`);
- `asset.mime_type = stored_object.mime_type`, y un contenedor `MP4` se
  publica como `video/mp4` (`ASSET_MIME_MISMATCH`);
- READY exige `sha256`, `size_bytes`, `mime_type` y `container` (`assets_ready_complete`).

El `mime_type` y el `container` salen de la inspección, nunca del Content-Type
ni de la extensión del cliente.

### Rechazos

`rejection_code` solo admite los códigos de `AssetRejectionCodeSchema`
(constraint `assets_rejection_code_known`; un test compara las dos listas).
`rejection_detail` es `jsonb` objeto: `{ message, details }`, sin stderr ni
paths. Solo existe en `REJECTED`.

### Concurrencia y dedup (§15, §32)

Dos uploads simultáneos del mismo contenido: cada uno escribe su temporal, el
primero crea el blob con `link()` atómico y el segundo encuentra `EEXIST`,
verifica el SHA-256 real y deduplica. En la base, `INSERT … ON CONFLICT (sha256)
DO NOTHING` + `SELECT`: un solo StoredObject; los dos Assets lo referencian.

### Nombre de archivo (§7)

`normalizeOriginalFilename`: lo que se guarda (NFC, sin NUL/controles/bidi, ≤
255 caracteres). `displayFilename`: lo que va a logs y headers (último
segmento, ASCII seguro). `contentDispositionFor`: header de descarga RFC 6266 +
5987. El nombre **nunca** construye un path: temporal = UUID, final = sha256.

### Infraestructura que falla

Binario de ffmpeg ausente, cancelación, base caída: excepción, no rechazo. Un
asset válido no se marca `REJECTED` por un problema nuestro. El Asset queda en
un estado no terminal y el temporal se borra. La limpieza de Assets no
terminales viejos queda propuesta (ver reporte B3).

## Configuración

| Variable | Default | Uso |
|---|---|---|
| `MAX_UPLOAD_BYTES` | 524288000 (500 MB) | §6, `maxUploadBytesFromEnv()` |
| `TEMP_OBJECT_TTL_MS` | 86400000 | `cleanupTemporaryObjects` |
| `MEDIA_*` | ver `MEDIA.md` | B2 |
