MASTER OF TRUST — M3A.1
FASE B — STORAGE + ASSET VALIDATION + API FOUNDATION

CONTEXTO

FASE A + Integrity Gate A.1 están APROBADAS.

Ya existe y NO debe rehacerse:

- PostgreSQL schema
- migrations
- trust_owner / trust_app
- ShowVersion inmutable
- show_version_assets sellado
- StoredObject content-addressed
- Asset lifecycle:
  UPLOADING
  → VALIDATING
  → READY
  o
  → REJECTED
- cuatro ojos por contrato
- audit chain
- hash JCS / RFC 8785
- idempotency con fingerprint
- building capabilities derivadas de EL_TRUST

NO tocar M2C.2.

NO empezar todavía:
- Builder API integration
- approvals UI
- scheduler
- deploy
- EDGE
- Proof of Play
- cameras
- billing
- external portal

==================================================
1. OBJETIVO DE FASE B
==================================================

Implementar el pipeline real:

UPLOAD
→ TEMPORARY OBJECT
→ STREAM SHA-256
→ FFPROBE
→ FRAME DECODE
→ VALIDATE AGAINST BUILDING CAPABILITY
→ CONTENT-ADDRESSED COMMIT
→ Asset READY

o:

UPLOAD
→ VALIDATION FAIL
→ Asset REJECTED
→ motivo exacto
→ cleanup temporal

Al cerrar Fase B, un MP4 real debe poder entrar por API y quedar:

READY

o:

REJECTED

con código y detalle reproducibles.

==================================================
2. STORAGE PACKAGE
==================================================

Implementar:

packages/platform-storage

Interface:

ObjectStorage

mínimo:

putTemporary()
readTemporary()
statTemporary()
deleteTemporary()

putIfAbsent()
exists()
stat()
read()
stream()

commitContentAddressed()

No permitir paths libres desde input del usuario.

La app nunca recibe un storageKey arbitrario enviado por frontend.

==================================================
3. LOCAL DISK STORAGE
==================================================

Implementar LocalDiskStorage real.

Requisitos:

- root configurado por env
- temporary/ separado de immutable/
- creación exclusiva
- path traversal bloqueado
- symlink traversal bloqueado
- no sobrescribir blobs finales
- fsync/rename atómico cuando corresponda
- permisos restrictivos

Layout sugerido:

storage/
  tmp/
  sha256/
    ab/
      abcdef....mp4

El nombre original NUNCA define el path físico.

==================================================
4. S3-COMPATIBLE STORAGE
==================================================

Implementar S3CompatibleStorage detrás de la misma interface.

NO acoplar dominio a AWS.

Config por env:

S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY
S3_SECRET_KEY
S3_FORCE_PATH_STYLE

Debe funcionar con:
- MinIO
- AWS S3 compatible
- otros proveedores compatibles

Si MinIO no puede ejecutarse en este entorno:
- implementar
- compilar
- tests de contrato preparados
- documentar claramente que el test de integración S3 queda para CI/compose

NO fingir ejecución.

==================================================
5. UPLOAD PIPELINE
==================================================

Crear servicio:

AssetUploadService

Flujo:

1. crear Asset en UPLOADING
2. recibir stream
3. escribir a temporary storage
4. calcular SHA-256 DURANTE el stream
5. contar bytes reales
6. verificar límites
7. pasar Asset a VALIDATING
8. ejecutar media inspection
9. validar capability
10. decodificar frame
11. commit content-addressed
12. crear/reusar StoredObject
13. asociarlo al Asset
14. Asset → READY
15. audit ASSET_VALIDATED

Si falla validación:

Asset → REJECTED
rejection_code
rejection_detail estructurado
audit ASSET_REJECTED
borrar temporal

No dejar objetos huérfanos.

==================================================
6. STREAMING

NO cargar archivos completos a RAM.

Usar streams.

Hash SHA-256 incremental.

Límite configurable:

MAX_UPLOAD_BYTES

Default razonable para desarrollo, documentado.

Si supera límite:

ASSET_TOO_LARGE

Abortar stream y borrar temporary.

==================================================
7. FILENAME

Guardar originalFilename como metadata.

Sanitizar para:
- logs
- headers
- downloads

Pero NO usarlo para construir paths.

Probar:
../
..\
unicode extraño
null-like names
extensiones múltiples

==================================================
8. MEDIA INSPECTION

Crear:

MediaInspector

Implementación real:

FfprobeMediaInspector

Usar ffprobe mediante spawn/execFile seguro.

NO shell interpolation.

Nunca:

exec(`ffprobe ${filename}`)

Sí:
spawn/execFile con args separados.

Timeout configurable.

Capturar:
- container
- video codec
- width
- height
- fps
- duration
- stream count
- pixel format si está disponible

Rechazar si no hay exactamente un stream de video usable,
salvo decisión explícita y documentada.

==================================================
9. FRAME DECODE

No alcanza con ffprobe.

Decodificar al menos un frame real con ffmpeg.

Crear:

FrameDecoder

Validar que:
- proceso termina bien
- frame producido > 0 bytes

Si falla:

ASSET_CORRUPT

Timeout obligatorio.

No guardar el frame salvo que haga falta para futuro thumbnail.

==================================================
10. BUILDING CAPABILITIES

NO hardcodear resoluciones en platform-api.

Usar deriveSurfaceFormats() / autoridad compartida basada en EL_TRUST.

Debe soportar:

towers_ab
screen_a
screen_b
horizontal

Los valores actuales esperados vienen del modelo:

towers_ab:
2592 × 576

screen_a:
1152 × 576

screen_b:
1440 × 576

horizontal:
1920 × 412

Pero los tests deben comprobar que salen de la autoridad del edificio.

==================================================
11. VALIDACIÓN DE VIDEO

Para cada Asset comparar:

surfaceType
resolution
codec
fps
duration

Reglas actuales:

container:
MP4

codec:
H.264 / AVC

fps:
25 o 30 fps

resolution:
exacta según capability

duration:
>= requiredDurationMs cuando se conoce el requerimiento

En upload aislado puede validarse técnicamente sin show.

Si todavía no existe requiredDuration:
Asset puede quedar READY técnicamente.

Luego Submit volverá a validar si cubre el rango temporal exacto del ShowPackage.

No mezclar esa validación futura con Fase B.

==================================================
12. FPS

No comparar floats ingenuamente.

ffprobe puede devolver:

25/1
30/1
30000/1001

Definir política explícita.

Si aceptamos solamente 25.000 y 30.000 exactos:
documentarlo.

Si 29.97 queda fuera:
rechazar con:

ASSET_BAD_FPS

No aceptar por accidente.

==================================================
13. MIME / CONTAINER

No confiar en Content-Type del upload.

Guardar el declarado solo como metadata temporal si hace falta.

La autoridad es la inspección real del archivo.

READY debe reflejar:
- container real
- codec real
- dimensiones reales
- duración real

==================================================
14. STORED OBJECT CONSISTENCY

Antes de READY:

StoredObject debe coincidir con Asset:

Asset.stored_object_id
→ StoredObject real

Validar:

asset.size_bytes = stored_object.size_bytes

asset.mime_type coherente con media inspeccionada

sha256 del blob = StoredObject.sha256

No permitir READY con metadata contradictoria.

Agregar test específico.

==================================================
15. DEDUPLICACIÓN

Caso:

subo exactamente el mismo MP4 dos veces.

Resultado:

2 Asset records pueden existir
pero:
1 StoredObject físico

Mismo sha256:
reusar StoredObject.

No reescribir blob.

Probar concurrencia:

dos uploads simultáneos del mismo contenido
→ un solo StoredObject final.

==================================================
16. FAILURE ATOMICITY

Definir claramente fronteras DB/storage.

No hay transacción distribuida.

Implementar estrategia compensatoria:

- blob temporal hasta validar
- commit content-addressed idempotente
- DB transaction para StoredObject + Asset READY
- cleanup si DB falla

Si blob final ya existía:
NO borrarlo por fallo del segundo Asset.

Documentar algoritmo.

==================================================
17. REJECTION CODES

Definir en platform-contracts enum Zod:

ASSET_TOO_LARGE
ASSET_EMPTY
ASSET_BAD_CONTAINER
ASSET_BAD_CODEC
ASSET_BAD_RESOLUTION
ASSET_BAD_FPS
ASSET_TOO_SHORT
ASSET_NO_VIDEO
ASSET_MULTIPLE_VIDEO_STREAMS
ASSET_CORRUPT
ASSET_INSPECTION_TIMEOUT
ASSET_STORAGE_ERROR

No devolver solamente texto libre.

Guardar:

rejection_code

y detail JSON estructurado si hace falta.

==================================================
18. API FOUNDATION

Implementar apps/platform-api con Fastify.

Base:

/api/v1

Por ahora rutas de Asset + health.

No construir todavía toda Campaign API.

Endpoints mínimos:

GET /health
GET /ready

POST /api/v1/assets
GET /api/v1/assets/:id
GET /api/v1/assets
GET /api/v1/assets/:id/status

Si el diseño requiere upload separado:

POST /api/v1/assets/uploads
POST /api/v1/assets/uploads/:id/finalize

es aceptable.

Elegir UNA estrategia limpia y documentarla.

==================================================
19. AUTH TEMPORAL PARA FASE B

No implementar todavía todo platform-auth si pertenece a Fase C.

Pero las rutas de assets NO deben quedar conceptualmente públicas.

Para tests/desarrollo se permite un DevelopmentActorProvider
o mecanismo explícito equivalente.

NO hardcodear un UUID mágico dentro de handlers.

Diseñar:

RequestActor

para que Fase C pueda reemplazarlo por sesión real sin reescribir servicios.

Documentar claramente:

DEV ONLY.

==================================================
20. IDEMPOTENCY

Finalize/upload commit debe usar Idempotency-Key.

Mismo actor + key + mismo fingerprint:
mismo resultado.

Misma key + distinto contenido/fingerprint:
409 IDEMPOTENCY_KEY_REUSED.

No duplicar Asset final por retry HTTP.

==================================================
21. REQUEST VALIDATION

Zod en:
params
query
headers relevantes
response

Multipart:
validar campos.

surfaceType:
debe existir en building capabilities.

No aceptar strings arbitrarios.

==================================================
22. ERROR CONTRACT

Usar estructura:

{
  code,
  message,
  details?,
  requestId
}

HTTP coherente:

400 input inválido
404 asset inexistente
409 idempotency/conflict
413 tamaño
415 tipo no procesable si corresponde
422 media inválida
500 error interno

No filtrar:
paths internos
stack traces
SQL
secrets

==================================================
23. OBSERVABILITY

Cada request:

requestId

Logs JSON estructurados.

Para upload registrar:

assetId
requestId
bytes
duration
result

NO loggear:
archivo completo
tokens
cookies
secrets

==================================================
24. HEALTH

GET /health

solo indica proceso vivo.

GET /ready

comprueba:

PostgreSQL
storage

NO ejecutar ffprobe pesado por cada readiness probe.

Puede validar presencia/configuración binaria de forma cacheada.

==================================================
25. STORAGE ORPHANS

Agregar servicio/comando de housekeeping:

cleanupTemporaryObjects()

Elimina temporales vencidos.

TTL configurable.

NO borrar blobs finales content-addressed.

Agregar test.

==================================================
26. API NO MODIFICA ASSET TERMINAL

No crear endpoint para:

PATCH READY asset
DELETE READY asset

En Fase B no hay borrado de Asset terminal desde API.

Si hace falta ocultarlo en el futuro:
será otra operación de negocio.

==================================================
27. AUDIT

Integrar audit real.

Eventos:

ASSET_UPLOADED
ASSET_VALIDATION_STARTED
ASSET_VALIDATED
ASSET_REJECTED

Cada transición dentro de transacción correcta.

Audit debe seguir verificando cadena.

Un fallo a mitad del pipeline no puede dejar evento diciendo READY si Asset no quedó READY.

==================================================
28. TEST FIXTURES

Crear archivos de test mínimos y deterministas.

Necesitamos fixtures reales:

valid_towers_ab_25.mp4
valid_horizontal_30.mp4

y casos inválidos generados durante tests o fixtures:

bad_resolution
bad_codec
bad_fps
too_short
corrupt
empty

No meter videos enormes al repo.

Generarlos con ffmpeg durante setup si el entorno lo permite.

Documentar comandos.

==================================================
29. TESTS STORAGE

LocalDiskStorage:

- put temp
- read
- stat
- traversal
- symlink traversal
- commit
- putIfAbsent
- dedup
- concurrent same hash
- cleanup temp
- never overwrite final blob

S3 contract tests:
mismo contrato.

==================================================
30. TESTS MEDIA

ffprobe real:

- video válido
- resolución
- codec
- fps
- duración
- sin video
- corrupto
- timeout simulado/controlado

frame decode:
- frame real
- corrupto falla

==================================================
31. TESTS PIPELINE

PostgreSQL real + LocalDiskStorage real.

Happy path:

upload
→ VALIDATING
→ StoredObject
→ READY

Invalid:

upload
→ REJECTED

Comprobar:
- rejection_code exacto
- temporal eliminado
- no StoredObject basura
- audit correcto

==================================================
32. TEST CONCURRENTE DE DEDUP

Dos uploads simultáneos del mismo archivo:

Asset A READY
Asset B READY

A.stored_object_id
=
B.stored_object_id

stored_objects count para ese SHA:
1

Archivo final físico:
1

==================================================
33. TEST DE FALLO DB DESPUÉS DE COMMIT STORAGE

Simular:

blob final existe
→ transacción DB falla

Resultado:
- no corrupción
- blob content-addressed puede quedar como objeto huérfano seguro
  o ser reconciliado según estrategia documentada
- retry idempotente recupera correctamente

No borrar un blob que otra operación pueda estar usando.

==================================================
34. SECURITY

Upload limit.

Timeout de:
ffprobe
ffmpeg

Concurrency limit para inspecciones pesadas.

No permitir zip/executable processing.

Nunca ejecutar uploaded content.

Temp dir no web-accessible.

Path traversal imposible.

Filename jamás pasa como shell.

==================================================
35. DOCKER COMPOSE

Agregar:

postgres
minio
platform-api

si Docker Compose ya corresponde a esta fase.

Como el entorno actual no tiene Docker:

NO afirmar que fue ejecutado.

Debe quedar preparado para CI.

Local tests:
PostgreSQL real
LocalDiskStorage

==================================================
36. ENV

Actualizar .env.example:

DATABASE_URL
STORAGE_DRIVER=local|s3
LOCAL_STORAGE_ROOT

S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY
S3_SECRET_KEY
S3_FORCE_PATH_STYLE

MAX_UPLOAD_BYTES
MEDIA_PROBE_TIMEOUT_MS
MEDIA_DECODE_TIMEOUT_MS
TEMP_OBJECT_TTL_MS

No secretos reales.

==================================================
37. NO IMPLEMENTAR TODAVÍA

NO:

Campaign CRUD completo
Builder sync
Auth real
Approvals API
Scheduler
Deploy
EDGE
Proof of Play
Audience Analytics
external portal

Eso viene después.

==================================================
38. CHECKPOINTS

FASE B1
ObjectStorage
LocalDiskStorage
S3 adapter
tests

ENTREGAR checkpoint.

FASE B2
MediaInspector
FrameDecoder
validator
fixtures
tests

ENTREGAR checkpoint.

FASE B3
AssetUploadService
DB integration
audit
idempotency
tests

ENTREGAR checkpoint.

FASE B4
Fastify API
health/readiness
security
E2E API

ENTREGAR final Fase B.

No avanzar silenciosamente de B1 a B4 si aparece una contradicción del modelo.

==================================================
39. GATE FASE B

Ejecutar:

pnpm install --frozen-lockfile
pnpm verify
pnpm build

PostgreSQL real:
migration up
platform DB tests

Storage tests reales

ffprobe real
ffmpeg real

API integration tests

python3 scripts/mutation-check.py

pnpm e2e

pnpm verify cierre

M2C.2 congelado:
sus 14 E2E deben seguir pasando.

==================================================
40. MUTATION CHECK

Agregar mutaciones específicas:

- hash del upload se ignora
- BAD_RESOLUTION aceptado
- BAD_CODEC aceptado
- BAD_FPS aceptado
- TOO_SHORT aceptado
- corrupto aceptado
- READY sin StoredObject
- dedup desactivado
- temp no limpiado
- Asset REJECTED entra READY
- path traversal permitido

Todas deben ser atrapadas.

==================================================
41. ENTREGA

Entregar:

trust-platform-m3a1-faseB.zip
M3A1-FaseB.patch

docs:
M3A1_FASE_B.md
storage architecture
asset validation matrix
API routes
env
ADRs

Resultados reales.

Fixtures/comandos usados.

Ejemplos de:

Asset READY
Asset REJECTED

y un curl/documentación equivalente para subir un archivo.

==================================================
42. CRITERIO DE ACEPTACIÓN

FASE B se considera cerrada si puedo:

1. subir MP4 real;
2. no se carga entero en RAM;
3. calcular SHA-256 real;
4. inspeccionarlo con ffprobe;
5. decodificar frame con ffmpeg;
6. validar formato según EL_TRUST;
7. guardarlo content-addressed;
8. obtener Asset READY;
9. repetir upload y deduplicar StoredObject;
10. subir uno incorrecto y obtener REJECTED con causa exacta;
11. no dejar temporales basura;
12. retries HTTP no duplican operación;
13. API responde con contratos Zod;
14. audit registra transiciones;
15. M2C.2 no tiene regresión.

No declarar Fase B cerrada si storage, ffprobe, frame decode o PostgreSQL
están mocked en el happy path principal.