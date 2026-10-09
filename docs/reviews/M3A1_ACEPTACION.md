# M3A.1 — Matriz de aceptación (master §48)

**Origen:** brief E §E2. Cada punto de §48 tiene el test que lo prueba, el rol
real que ejecuta el paso y un estado. Los estados posibles son **cubierto**,
**pendiente** (con el motivo) o **no aplicable**. Un pendiente nunca cuenta como
cubierto.

El recorrido principal es `apps/platform-api/src/e2e-flow.db.test.ts` (E2):
- HTTP real: Fastify escuchando en un puerto;
- PostgreSQL real;
- ffprobe real sobre fixtures reales;
- login con contraseña, cookie y CSRF de C1, y logout por rol.

Nada salta la base, el hashing, la validación de assets ni la aprobación
(§48: "No declarar M3A.1 cerrado si alguno depende de mocks…"). El único dato
sembrado por la base son los tres usuarios: no existe endpoint de alta, porque
el alta es el CLI de C1.

Cada fila incluye **el paso de E2 que lo cubre** (numerado como en el test) y
los tests específicos de la fase que lo prueban en profundidad.

| # | §48 | Rol que lo ejecuta | E2 (paso) | Tests específicos | Estado |
|---|---|---|---|---|---|
| 1 | creo Campaign | OPERATOR (el Advertiser y el Contract los crea ADMIN) | 1, 2 | `campaigns.db.test.ts` | **cubierto** |
| 2 | Builder guarda un Draft en PostgreSQL | OPERATOR | 2, 3, 7: con `connectBuilderBackend` + `CampaignSession`, el mismo código que usa el Builder desde D3 | `builder-d3.db.test.ts`, `builder-repository.db.test.ts`, `useBuilderStore.test.ts` | **cubierto** a nivel API, sesión y store. El E2E de navegador del Builder es E3, todavía sin autorización (ver abajo). |
| 3 | revision protege concurrencia | OPERATOR | 2 (`expectedRevision` viejo → 409 `DRAFT_CONFLICT`, sin escribir) | `campaigns.db.test.ts`, `builder-d3.db.test.ts` (conflicto entre dos operadores) | **cubierto** |
| 4 | subo assets | OPERATOR | 3 (multipart real, Idempotency-Key y CSRF) | `api.db.test.ts` | **cubierto** |
| 5 | ffprobe los valida realmente | OPERATOR | 3: los metadatos (contenedor, resolución, fps, codec, duración) salen de ffprobe; un archivo que no es video → 422 `ASSET_CORRUPT`, `REJECTED` | `process.real.test.ts`, `api.db.test.ts` | **cubierto** |
| 6 | assets quedan identificados por SHA-256 | OPERATOR | 3: `sha256` = SHA-256 de los bytes subidos; 4: el paquete referencia el contenido, no ids | `local-disk.test.ts`, `s3.contract.test.ts` | **cubierto** |
| 7 | envío Draft | OPERATOR | 4 (`POST /campaigns/:id/submit` con `draftRevision`) | `submit.db.test.ts` | **cubierto** |
| 8 | servidor recompila | OPERATOR → servidor | 4: el servidor compila; el test recompila con el mismo compilador y el hash coincide | `submit.db.test.ts` | **cubierto** |
| 9 | servidor ejecuta preflight | OPERATOR → servidor | 4: `exportable` según el mismo `validateDraft` + preflight | `submit.db.test.ts` (escena inexistente o aspecto equivocado → 422 `PREFLIGHT_FAILED`, sin versión ni audit) | **cubierto** |
| 10 | crea ShowVersion inmutable | OPERATOR → servidor | 4 (crea), 7 (fila idéntica tras editar), §48.18 (UPDATE/DELETE rechazados) | `submit.db.test.ts`, `schema.db.test.ts` | **cubierto** |
| 11 | calcula hash determinista | servidor | 4 (hash = recomputado) | `submit.db.test.ts` (mismo draft y bytes en dos campañas → mismo hash), `platform-contracts` | **cubierto** |
| 12 | otro usuario la aprueba | INTERNAL_APPROVER (≠ OPERATOR que hizo el submit) | 5; el OPERATOR que hizo el submit recibe 403 | `approval.db.test.ts` (cuatro ojos, `FOUR_EYES_VIOLATION`) | **cubierto** |
| 13 | evidencia queda congelada | INTERNAL_APPROVER | 5: SHA-256 de la evidencia = bytes subidos; la descarga devuelve los mismos bytes; UPDATE/DELETE de `approval_evidence` rechazados | `approval.db.test.ts` | **cubierto** |
| 14 | aprobación refiere al hash exacto | INTERNAL_APPROVER | 5: otro hash → 409; la aprobación guarda el `versionHash` | `approval.db.test.ts` | **cubierto** |
| 15 | edito Campaign | OPERATOR | 7 (nuevo draft, revisión 4) | `campaigns.db.test.ts` | **cubierto** |
| 16 | versión aprobada NO cambia | OPERATOR | 6 (APPROVED VERSION con hash exacto y WORKING DRAFT aparte), 7 (fila de `show_versions` y de `approvals` idénticas) | `builder-d3.db.test.ts` (§32) | **cubierto** |
| 17 | audit log registra todo | los tres roles | 8: `verifyChain` OK; cada evento con el actor de su rol (login, advertiser, contract, campaign, draft ×3, assets, submit, evidencia, aprobación) | `audit.db.test.ts`, `restore-drill.db.test.ts` | **cubierto** |
| 18 | ningún endpoint puede modificar ShowVersion | — | §48.18: del registro de Fastify, las únicas escrituras sobre `/show-versions` son POST que crean filas nuevas (evidence/approve/reject), y no hay PUT/PATCH/DELETE; la base rechaza UPDATE/DELETE | `contract.db.test.ts` (rutas = registro), triggers de 0001 | **cubierto** |
| 19 | M2C.2 sigue pasando sin regresión | — | — | job `e2e-m2c` de CI (14/14 `experience.spec.ts` + `builder.spec.ts`) | **cubierto en CI**. Acá no corre: no hay Chrome con H.264. Ver #26 por la intermitencia histórica. |

## Lo que §41 pide y esta matriz NO cubre

- **§41 es Playwright**: login, campaña y aprobación en un navegador. E2
  recorre exactamente ese flujo, pero **por HTTP**, sin UI. La UI de login,
  campaña y aprobación no existe en ningún app, y E3 (Playwright de §41) sigue
  **sin autorización**, según la decisión vigente en HANDOFF y la auditoría de D3.
- Los screenshots y el video de §47 dependen de esa UI: quedan con E3.

Por eso M3A.1 **no se declara cerrado** con esta matriz: los 19 puntos de §48
están cubiertos a nivel plataforma, pero el E2E de navegador de §41 está
pendiente.
