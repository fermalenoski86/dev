MASTER OF TRUST — M3A.1
PLATFORM BACKEND FOUNDATION

CONTEXTO

M2C.2 Executive Experience está FROZEN.

CREATE ya existe:
Takeover Builder → compiler → ShowPackage

PLAY ya existe:
ShowEngine

M3A agrega la capa BACKEND:

CREATE
→ BACKEND
→ APPROVAL
→ posteriormente SCHEDULE
→ DEPLOY
→ PLAY
→ VERIFY

NO tocar:
- ShowEngine
- compiler
- Timeline
- Control Core
- SAFE MODE
- STOP semantics
- Client Experience
- renderer
- geometría
- quads
- CabinetLayer
- formato actual de ShowPackage

El backend GUARDA y VALIDA lo que producen las capas actuales.
No redefine el runtime.

==================================================
0. DECISIÓN DE INFRAESTRUCTURA
==================================================

PRODUCCIÓN = CLOUD.

Principio:

CLOUD ADMINISTRA.
EDGE EJECUTA.

M3A implementa solamente CLOUD / CONTROL PLANE.

TRUST EDGE físico entra posteriormente en M3C.

El edificio deberá poder operar en el futuro aunque Cloud esté temporalmente
fuera de servicio, pero esa capacidad NO se implementa en M3A.

Producción prevista:

- Linux
- Docker
- Platform API
- PostgreSQL
- S3-compatible object storage
- HTTPS
- backups automáticos
- monitoring

Desarrollo local:

- Docker Compose
- PostgreSQL local
- storage local o MinIO

NO atar el código a AWS, Cloudflare, Azure, GCP ni otro proveedor específico.

Usar interfaces/abstracciones.

==================================================
1. OBJETIVO DE M3A.1
==================================================

Construir la base persistente real de MASTER OF TRUST.

Al finalizar debe existir:

- PostgreSQL
- migraciones
- API
- autenticación interna
- anunciantes
- contratos
- campañas
- drafts
- assets
- ShowVersions inmutables
- aprobaciones
- evidence
- audit log
- hashing determinista
- integración mínima con Builder

NO implementar todavía:
- Scheduler
- EDGE
- Deploy
- Proof of Play
- cámaras
- Audience Analytics
- facturación
- portal externo
- hardware
- DMX
- Modbus
- NovaStar/Brompton/Colorlight

==================================================
2. NUEVA APP

Crear dentro del monorepo:

apps/platform-api

TypeScript strict.

Reutilizar contracts y schemas en:

packages/shared-types

Crear paquetes nuevos solamente si mejoran separación real.

Propuesta:

packages/
  platform-contracts/
  platform-db/
  platform-storage/
  platform-auth/
  platform-audit/

No crear microservicios.

M3A es un modular monolith.

==================================================
3. POSTGRESQL

Usar PostgreSQL como fuente persistente principal.

Todas las entidades deben usar:

UUID
createdAt
updatedAt cuando aplique

Timestamps:
UTC.

No usar IDs incrementales públicos.

Agregar migrations versionadas.

No usar auto-sync de ORM en producción.

==================================================
4. ENTIDADES BASE

Implementar:

Advertiser
Contract
Campaign
CampaignDraft
Asset
ShowVersion
Approval
ApprovalEvidence
User
UserRole
AuditEvent

Las superficies del edificio:

screen_a
screen_b
horizontal

NO se redefinen en DB.

Usar el modelo del edificio existente como autoridad.

==================================================
5. ADVERTISER

Advertiser:

id
legalName
taxId / cuit
commercialName?
contacts
status
createdAt
updatedAt

Un advertiser puede tener múltiples contracts.

==================================================
6. CONTRACT

Contract:

id
advertiserId
name
startsAt
endsAt
status

allowedSurfaces[]
externalApprovalEnabled boolean default false

metadata opcional controlada.

Regla:

una Campaign no puede utilizar una superficie fuera de su Contract.

El backend valida esto server-side.

==================================================
7. CAMPAIGN

Campaign NO debe tener un único estado que mezcle borrador y aprobación.

Debe poder coexistir:

currentDraft
+
latestApprovedVersion

Modelo sugerido:

Campaign:
id
contractId
name
currentDraftId
latestApprovedVersionId nullable
lifecycleStatus
createdAt
updatedAt

Ejemplo válido:

Campaign McDonald's Launch

latestApprovedVersion = v3
currentDraft = draft-v4

Editar después de aprobar NO modifica v3.

==================================================
8. CAMPAIGN DRAFT

CampaignDraft:

id
campaignId
takeoverDraft JSONB
revision integer
createdBy
createdAt
updatedAt

revision es monotónica.

No implementar last-write-wins.

Toda actualización requiere:

expectedRevision

Si no coincide:

HTTP 409

error code:

DRAFT_CONFLICT

No hacer merge automático.

==================================================
9. OFFLINE / CONFLICT STRATEGY

Builder puede seguir guardando localmente.

Cuando vuelva la conexión:

intenta sincronizar con expectedRevision.

Si existe conflicto:

NO sobrescribir servidor.

Devolver:

serverRevision
clientRevision
serverUpdatedAt

La UI posteriormente podrá:

- recuperar server
- mantener local
- duplicar como nuevo draft

M3A.1 debe implementar contrato de backend para este comportamiento.

==================================================
10. SERVER-SIDE COMPILATION

P0.

El backend NO confía en un ShowPackage enviado por browser.

SEND FOR APPROVAL recibe el Draft actual.

El servidor ejecuta:

TakeoverDraft
→ Zod
→ compileTakeoverDraft existente
→ preflightShow existente
→ resolve asset checksums
→ canonical representation
→ hash
→ immutable ShowVersion

El compiler NO se modifica.

Preflight NO se duplica.

El browser puede mostrar un preview,
pero la autoridad final es server-side.

==================================================
11. SHOW VERSION

ShowVersion es INMUTABLE.

Campos mínimos:

id
campaignId
sourceDraftId
versionNumber
showPackage JSONB
versionHash
hashAlgorithm
canonicalizationVersion
showPackageSchemaVersion
compilerVersion
submittedBy
submittedAt
status

Status:

SUBMITTED
APPROVED
REJECTED

Una ShowVersion nunca recibe UPDATE de contenido.

Nunca DELETE.

Cualquier modificación genera una nueva ShowVersion.

==================================================
12. HASHING

NO implementar canonical JSON ad-hoc.

Usar una canonicalización determinista y documentada.

Preferencia:

RFC 8785 / JSON Canonicalization Scheme

El hash de versión se calcula sobre:

{
  showPackage,
  assets: [
    {
      logicalRef,
      sha256
    }
  ]
}

Los assets deben ordenarse determinísticamente.

versionHash:

SHA-256

Persistir también:

hashAlgorithm = "sha256"
canonicalizationVersion
compilerVersion
showPackageSchemaVersion

Mismo contenido + mismos assets:
mismo hash.

Cambiar un byte de un asset:
hash diferente.

Cambiar ShowPackage:
hash diferente.

==================================================
13. ASSETS

Asset:

id
sha256
originalFilename
mimeType
sizeBytes
width
height
fps
codec
durationMs
surfaceType
storageKey
status
createdBy
createdAt

Status sugerido:

UPLOADING
VALIDATING
READY
REJECTED

Un asset REJECTED no puede formar parte de una ShowVersion.

==================================================
14. VALIDACIÓN REAL DE ASSETS

No confiar en extensión ni nombre.

Usar ffprobe sobre el archivo real.

Validar:

Torres A+B:
2592 × 576
MP4
H.264
25 o 30 fps

Horizontal:
1920 × 412
MP4
H.264
25 o 30 fps

Además:

- duración
- tamaño
- codec
- fps
- resolución
- frame decodable

Decodificar al menos un frame.

Si el show reproduce 11 segundos:
el asset debe cubrir esos 11 segundos desde el offset solicitado.

Error debe indicar causa exacta.

Ejemplos:

ASSET_BAD_RESOLUTION
ASSET_BAD_CODEC
ASSET_BAD_FPS
ASSET_TOO_SHORT
ASSET_CORRUPT

==================================================
15. CONTENT-ADDRESSED STORAGE

El contenido real se identifica por SHA-256.

No permitir overwrite de un blob validado.

StorageKey sugerida:

sha256/8f/8f73abc...mp4

El filename original es metadata humana.

Si se sube dos veces el mismo contenido:
deduplicar.

Mismo nombre con bytes distintos:
nuevo Asset.

==================================================
16. STORAGE ABSTRACTION

Crear interface:

ObjectStorage

mínimo:

put
get
exists
deleteUncommitted
stat
stream/read
signed/read URL si luego corresponde

Implementaciones:

LocalDiskStorage
S3CompatibleStorage

Desarrollo:
disco o MinIO.

Producción:
S3-compatible.

No acoplar dominio a SDK de proveedor.

==================================================
17. APPROVAL FLOW

Flujo:

DRAFT
→ SUBMITTED
→ APPROVED

o:

DRAFT
→ SUBMITTED
→ REJECTED
→ nueva edición/draft
→ SUBMITTED nuevo

Enviar:

- exige preflight válido
- compila server-side
- crea ShowVersion
- congela hash

Aprobar:

- requiere APPROVER
- requiere evidencia
- quien aprueba != quien envió

Rechazar:

- requiere motivo obligatorio

Toda transición inválida:

HTTP 409
INVALID_STATE_TRANSITION

==================================================
18. FOUR-EYES PRINCIPLE

Por defecto:

quien envía NO puede aprobar su propia ShowVersion.

Incluso si tiene ambos roles.

Puede existir configuración administrativa:

fourEyesRequired boolean

default true.

Desactivar four-eyes:

requiere ADMIN
y genera AuditEvent explícito.

==================================================
19. APPROVAL EVIDENCE

Crear entidad inmutable:

ApprovalEvidence:

id
type
originalFilename
mimeType
sizeBytes
sha256
storageKey
uploadedBy
uploadedAt

Tipos iniciales:

EMAIL
PDF
MESSAGE
OTHER

Una Approval referencia evidenceId.

Una evidence utilizada en una Approval:
NO se reemplaza.

==================================================
20. APPROVAL

Approval:

id
showVersionId
decision
actorUserId
evidenceId nullable según decisión
reason
createdAt

APPROVED:
evidence obligatoria.

REJECTED:
reason obligatorio.

Siempre refiere a ShowVersion exacta.

Nunca simplemente a Campaign.

==================================================
21. USERS

User:

id
name
email
passwordHash
organization
enabled
createdAt
updatedAt

Email unique normalizado.

Password:
Argon2id.

No guardar password raw nunca.

==================================================
22. ROLES

Roles iniciales:

OPERATOR
INTERNAL_APPROVER
ADMIN
EXTERNAL_APPROVER

Una persona puede tener múltiples roles.

EXTERNAL_APPROVER:

modelado
testeado
DISABLED funcionalmente por default.

No construir portal externo todavía.

==================================================
23. AUTH

Sesiones server-side o diseño equivalente seguro.

Cookies:

HttpOnly
Secure en producción
SameSite apropiado

Login:
rate limiting.

Mutaciones:
protección CSRF cuando corresponda.

Todos los permisos se validan server-side.

Nunca confiar en botones escondidos de frontend.

==================================================
24. TENANCY / CONTRACT SCOPE

El Contract es el límite lógico futuro del acceso externo.

Nunca autorizar solamente porque UI envía:

contractId=xxx

El backend deriva qué contracts puede ver el usuario.

EXTERNAL_APPROVER:
solo contratos asociados.

Agregar tests que prueben intento de acceso cruzado.

==================================================
25. AUDIT LOG

AuditEvent:

id
actorUserId
action
entityType
entityId
timestamp
beforeHash
afterHash
metadata
previousEventHash
eventHash

Append-only.

eventHash:

SHA256(
  previousEventHash
  +
  canonicalEvent
)

Usar canonicalización determinista.

No exponer API:

UPDATE audit
DELETE audit

==================================================
26. AUDIT DB SECURITY

No depender solo del código.

El usuario PostgreSQL usado por runtime:

NO debe tener permisos UPDATE/DELETE sobre audit_events.

Agregar triggers/constraints si corresponden.

Describir la auditoría como:

append-only
tamper-evident

NO decir que es imposible de alterar ante un administrador total de infraestructura.

==================================================
27. AUDIT EVENTS OBLIGATORIOS

Registrar al menos:

ADVERTISER_CREATED
CONTRACT_CREATED
CONTRACT_UPDATED
CAMPAIGN_CREATED
DRAFT_UPDATED
ASSET_UPLOADED
ASSET_VALIDATED
ASSET_REJECTED
VERSION_SUBMITTED
VERSION_APPROVED
VERSION_REJECTED
USER_CREATED
ROLE_CHANGED
FOUR_EYES_DISABLED

Cada evento con actor y timestamp.

==================================================
28. IDEMPOTENCY

Operaciones críticas soportan:

Idempotency-Key

mínimo:

asset finalize
submit
approve
reject

Un retry HTTP no puede crear:

dos ShowVersions
dos Approvals
dos assets finales

Guardar resultado asociado a la key durante ventana definida.

==================================================
29. API

Versionada:

/api/v1

REST + JSON.

Entrada y salida validadas con Zod.

Errores estructurados:

{
  code,
  message,
  details?,
  requestId
}

Nunca devolver stack trace.

==================================================
30. ENDPOINTS INICIALES

/auth/login
/auth/logout
/auth/me

/advertisers
/contracts
/campaigns

/campaigns/:id/draft

/assets
/assets/:id

/campaigns/:id/submit

/show-versions/:id

/show-versions/:id/approve
/show-versions/:id/reject

/audit

No crear scheduler endpoints.

No deploy endpoints.

==================================================
31. BUILDER INTEGRATION

Builder deja de depender exclusivamente de localStorage.

Agregar repository abstraction:

CampaignRepository

Implementaciones:

LocalCampaignRepository
ApiCampaignRepository

No acoplar componentes React directamente a fetch().

Flujo:

abrir Campaign
→ GET backend
→ editar
→ autosave
→ PUT/PATCH draft con expectedRevision

Offline:
continúa localmente.

Online:
sincroniza.

==================================================
32. APPROVED READ-ONLY

Cuando una ShowVersion queda APPROVED:

esa versión es readonly.

La Campaign puede crear/continuar un Draft nuevo.

Nunca modificar la versión aprobada.

Mostrar en Builder:

APPROVED VERSION vN

y si existe:

WORKING DRAFT

==================================================
33. CLOUD BACKUPS

Diseñar documentación operativa desde M3A.

PostgreSQL:

- backup automático diario
- PITR preparado para producción
- retención documentada

Object storage:

- versioning en producción
- protección contra borrado accidental
- blobs de versiones aprobadas no eliminables desde UI

NO implementar infraestructura específica a proveedor si no hace falta.

Documentar interfaces y requerimientos.

==================================================
34. OBSERVABILITY

Agregar desde el inicio:

structured logs
requestId
health endpoint
readiness endpoint

mínimo:

GET /health
GET /ready

No loggear:

passwords
session tokens
cookies
raw secrets

==================================================
35. DOCKER COMPOSE

Crear entorno reproducible.

docker compose up

debe levantar:

postgres
object storage local si se usa MinIO
platform-api

Frontend existente puede correr fuera o dentro según repo.

Agregar:

.env.example

sin secretos reales.

==================================================
36. MIGRATIONS

Migraciones versionadas.

CI:

- migrate up sobre DB vacía
- tests
- down/up para migraciones declaradas reversibles
- prueba con datos

No exigir down destructivo en producción.

Producción:

forward migration + backup.

==================================================
37. DB CONSTRAINTS

No confiar únicamente en TypeScript.

Usar:

foreign keys
unique constraints
check constraints
not null
indexes

cuando corresponda.

Ejemplos:

versionHash unique
Asset.sha256 index/unique según modelo
email unique normalizado
draft revision >= 1

==================================================
38. TRANSACTIONS

Submit debe ser transacción atómica:

- validar draft
- compiler
- preflight
- resolve assets
- crear version
- registrar audit

Si algo falla:
no queda media versión.

Approve/reject:
también transacción.

==================================================
39. SECURITY

Agregar límites razonables:

request body size
upload size
content-type
filename sanitization
path traversal prevention

No ejecutar archivos subidos.

ffprobe/ffmpeg:

sin shell interpolation de filename.

Timeouts y límites de proceso.

==================================================
40. TESTS OBLIGATORIOS

Mantener TODOS los tests existentes.

Agregar mínimo:

HASHING
- mismo contenido = mismo hash
- key order diferente = mismo hash
- cambiar byte asset = hash distinto
- cambiar ShowPackage = hash distinto

VERSIONS
- immutable por API
- UPDATE directo DB bloqueado
- DELETE bloqueado
- versión aprobada permanece igual al editar campaign

DRAFTS
- expectedRevision correcto
- stale revision => 409
- offline conflict no sobrescribe

APPROVAL
- submit válido
- preflight inválido no submit
- sender no puede self-approve
- approve sin evidence falla
- reject sin reason falla
- invalid transition falla
- retry idempotente no duplica

ASSETS
- resolución incorrecta
- codec incorrecto
- fps incorrecto
- duración insuficiente
- corrupto
- SHA dedup
- mismo filename distinto contenido => nuevo asset

AUDIT
- append only
- UPDATE/DELETE bloqueados
- chain válida
- alteración rompe verifyChain()

AUTH
- password Argon2id
- login inválido
- role enforcement
- external disabled
- external cross-contract denied

MIGRATIONS
- empty DB
- populated DB
- reversible migration smoke test

==================================================
41. E2E

Playwright:

LOGIN operador
→ crear campaña
→ Builder guarda draft en backend
→ subir assets válidos
→ enviar a aprobación
→ hash visible
→ logout

LOGIN approver diferente
→ ver versión
→ adjuntar evidencia
→ aprobar

LOGIN operador
→ campaign muestra:
APPROVED VERSION
hash exacto
working draft separado

Luego editar:
→ crea/modifica draft
→ versión aprobada NO cambia

Los 14 E2E congelados de M2C.2 deben seguir pasando.

==================================================
42. NO TOCAR M2C.2

M2C.2 está FROZEN.

No cambiar:
- renderer
- UI
- geometría
- campaign presentation
- screenshots
- Executive Experience

Salvo adaptación mínima estrictamente necesaria para navegación/backend.

Si hace falta tocarla:
documentar por qué.

==================================================
43. DOCUMENTACIÓN

Crear ADRs para:

- Cloud control plane / EDGE execution plane
- immutable ShowVersion
- server-side compiler authority
- canonicalization/hash
- content-addressed assets
- optimistic concurrency
- four-eyes approval
- audit hash chain
- storage abstraction

Actualizar architecture docs.

==================================================
44. IMPLEMENTACIÓN POR FASES

NO implementar todo de golpe sin checkpoints.

FASE A
- schema DB
- migrations
- seed
- hashing
- immutable versions
- audit

FASE B
- storage
- asset validation
- API

FASE C
- auth
- roles
- approval

FASE D
- Builder repository integration
- offline revision/conflict

FASE E
- E2E
- hardening
- docs

Después de cada fase:
tests.

==================================================
45. PRIMERA RESPUESTA ANTES DE CODIFICAR

Antes de implementar, inspeccioná TODO el repo.

Responder primero con:

1. arquitectura actual relevante;
2. archivos/paquetes que se reutilizan;
3. archivos nuevos;
4. archivos existentes a modificar;
5. modelo relacional propuesto;
6. librería de DB/ORM elegida y motivo;
7. estrategia de migrations;
8. librería de RFC 8785/JCS elegida;
9. auth/session design;
10. storage abstraction;
11. riesgos;
12. cualquier contradicción real encontrada con el repo.

Después implementar SIN esperar confirmación salvo bloqueo real.

No reinterpretar ShowPackage.

==================================================
46. GATE FINAL M3A.1

Ejecutar:

pnpm install --frozen-lockfile
pnpm verify
pnpm build

Levantar PostgreSQL limpio.

migrations up
tests
migrations down/up donde sean reversibles

python3 scripts/mutation-check.py

pnpm e2e

pnpm verify

Agregar tests/mutations específicos para:

- hash
- immutable version
- four eyes
- audit chain
- optimistic revision
- asset validation

==================================================
47. ENTREGA

Entregar:

ZIP completo
patch
salida completa del gate
schema/ERD
ADRs
.env.example
docker-compose
migration list
API route list
OpenAPI o contrato equivalente
test list

Y screenshots/video corto de:

Builder
→ Guardar
→ Enviar
→ Hash
→ Aprobar
→ versión inmutable.

==================================================
48. CRITERIO DE ACEPTACIÓN

M3A.1 se considera terminado si:

1. creo Campaign;
2. Builder guarda un Draft en PostgreSQL;
3. revision protege concurrencia;
4. subo assets;
5. ffprobe los valida realmente;
6. assets quedan identificados por SHA-256;
7. envío Draft;
8. servidor recompila;
9. servidor ejecuta preflight;
10. crea ShowVersion inmutable;
11. calcula hash determinista;
12. otro usuario la aprueba;
13. evidencia queda congelada;
14. aprobación refiere al hash exacto;
15. edito Campaign;
16. versión aprobada NO cambia;
17. audit log registra todo;
18. ningún endpoint puede modificar ShowVersion;
19. M2C.2 sigue pasando sin regresión.

No declarar M3A.1 cerrado si alguno depende de mocks que salten DB,
hashing, asset validation o approval real.