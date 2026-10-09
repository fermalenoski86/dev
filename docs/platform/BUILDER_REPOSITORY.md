# Builder repository — `@trust/builder-repository` (M3A.1 Fase D2)

Master §9 (offline/conflicto) y §31 (Builder integration). ADR-061.
**No toca `apps/control`, `show-authoring` ni el formato de `DraftStorage`.**
D3 (el Builder lo usa, #15 opción 1): ver la sección «D3» al final.

## Interfaz

```ts
interface CampaignRepository {
  open(campaignId): Promise<OpenedCampaign>;   // draft + revision + approvedVersion (§32) + source
  save(draft, expectedRevision): Promise<SaveResult>;
  status(): RepositoryStatus;                   // connectivity, revision, pending, conflict
}
type SaveResult =
  | { kind: 'saved'; revision; updatedAt }
  | { kind: 'pending'; revision }               // guardado local, sin conexión
  | { kind: 'conflict'; conflict: { serverRevision, clientRevision, serverUpdatedAt } };
```

El 409 es un **resultado**, no una excepción: el Builder tiene que mostrarlo.
`RepositoryError` (con el `code` de la API) es para lo demás (403, 422…).
`OfflineError` = no hubo respuesta del backend: la red falló o un proxy
devolvió 502, 503 o 504.

## Implementaciones

| | Qué hace |
|---|---|
| `LocalCampaignRepository` | El comportamiento actual de M2C. Usa `saveDraft` y `loadDraft` tal cual, así que la clave `trust.builder.draft.v1` no cambia. La revisión vive en memoria y empieza en 0; un `expectedRevision` viejo da conflicto igual que en la API. |
| `ApiCampaignRepository` | La API de D1 (`GET /campaigns/:id`, `GET/PUT /campaigns/:id/draft`). El `fetch` es inyectado. Usa `credentials: 'include'` para la cookie de C1 y manda `x-csrf-token` en cada PUT. Valida las respuestas con Zod y el draft con `TakeoverDraftSchema`. |
| `SyncingCampaignRepository` | Guarda local **siempre** y después sube. Sin conexión, el cambio queda `pending` y `sync()` lo reintenta. Ante un 409 no pisa el servidor. |

## Offline y conflicto (§9)

1. `save` guarda local en dos claves con un protocolo recuperable
   (AUDIT D2, re-auditoría 2):
   1. primero el **registro de sync** `trust.builder.sync.v1:<campaignId>`
      (`{v, campaignId, baseRevision, pending, draft}`, validado con Zod al
      leer; si está corrupto o es de otra campaña, se ignora). Es la fuente de
      verdad del repositorio y **contiene el draft**;
   2. después el espejo en `trust.builder.draft.v1` (formato M2C, sin cambios);
   3. si el espejo falla, se restaura el registro anterior y se lanza
      `LOCAL_STORAGE_UNAVAILABLE`.

   Invariante: todo draft que el repositorio dejó en la clave M2C está
   también en su registro, así que un `open` posterior nunca descarta trabajo
   que llegó a disco. Hay tres casos de falla:
   - falla el registro → no se escribió nada;
   - falla el espejo → las dos claves vuelven al estado anterior;
   - falla también la restauración → el registro queda con el draft nuevo
     `pending`, y el próximo `open` lo conserva y lo sube.

   Al adoptar el draft del servidor (`open`, `recoverServer`), la clave M2C se
   pisa **solo si** tiene lo que el repositorio escribió la última vez (o está
   vacía). Si la cambió otro escritor, como el Builder actual sin repositorio,
   se conserva. Cualquier falla de storage corta antes del PUT y antes de
   tocar el estado en memoria.
2. Después hace el PUT con `expectedRevision = baseRevision`. Si no hay
   conexión, devuelve `pending`.
3. Si vuelve un 409, queda `conflict`. Mientras el conflicto esté abierto,
   **ningún `save` sube nada**; lo local se sigue guardando.
4. Las tres salidas de §9 son operaciones del repositorio, sin UI:
   - `recoverServer()`: descarta lo local y adopta la revisión vigente del servidor.
   - `keepLocal()`: es una decisión explícita del usuario. Sube lo local sobre
     la `serverRevision` que mostró el conflicto. Si el servidor volvió a
     cambiar, es otro conflicto: nunca es last-write-wins silencioso.
   - `duplicateAsNew()`: devuelve una copia de lo local y vuelve al draft del
     servidor. No escribe nada remoto (decisión 7 del brief D); crear la
     campaña nueva queda para E (D3 ofrece descargar la copia).
5. Al reabrir con trabajo `pending`, se conserva lo local y se intenta
   sincronizar.

**PUT confirmado sin respuesta** (la red se cortó después del commit): el
reintento da 409. Antes de declarar conflicto, el repositorio lee el draft del
servidor. Si la revisión es la del 409 y el contenido es exactamente el local
(`mismoDraft`, que no depende del orden de claves porque JSONB las reordena),
ya estaba guardado: devuelve `saved`. Así no hay conflicto falso ni una
segunda revisión.

## Tests

- **Unitarios** (`packages/builder-repository`, 17): usan storage en memoria y
  un doble de la API de D1 con la misma semántica.
- **Contra la API real** (`apps/platform-api/src/builder-repository.db.test.ts`, 7):
  Fastify escuchando en un puerto, PostgreSQL y sesiones reales. El "sin red"
  se simula en el `fetch` inyectado. Cubren:
  - el ciclo offline → online → conflicto;
  - las tres salidas de §9, verificando revisión, contenido y audit en la base;
  - el PUT confirmado sin respuesta;
  - reabrir con trabajo pendiente;
  - CSRF y roles.
- **Mutaciones nuevas** (9, `d2:`):
  - last-write-wins ante el 409;
  - `save` sin guardar local;
  - PUT sin CSRF;
  - `keepLocal` sin rebasar;
  - PUT perdido tomado como conflicto, y conflicto real tomado como propio;
  - local sin chequeo de revisión;
  - metadata de otra campaña;
  - offline sin `pending`.

## D3 — el Builder usa el repositorio (#15, opción 1; ADR-062)

Alcance autorizado por Fer en #15: el store del Builder con `CampaignRepository`
inyectado + indicador de versión. **No se tocan** la experiencia ejecutiva, el
renderer, la geometría ni los screenshots; los 14 E2E de M2C siguen siendo gate.

### Cómo se activa

`?campaign=<uuid>` en la URL del Builder. Sin ese parámetro (o con algo que no
sea un uuid) el Builder es **exactamente** el de M2C: `localStorage`, sin
indicador, sin red. `NEXT_PUBLIC_TRUST_API_URL` es la base de la API (vacía =
mismo origen, como asume `API.md`).

### Piezas

| Dónde | Qué |
|---|---|
| `@trust/builder-repository` · `session.ts` | `CampaignSession`: serializa los guardados (nunca dos PUT en paralelo; si se encolan varios, sube solo el último), toma el `expectedRevision` del repositorio, traduce cada resultado a `CampaignView` y expone las tres salidas de §9. `connectBuilderBackend()` lee el CSRF de `GET /api/v1/auth/me` y compone `SyncingCampaignRepository` + `ApiCampaignRepository` con el `fetch` inyectado. `campaignIdFromSearch()` valida el parámetro. |
| `apps/control` · `useBuilderStore.ts` | `campaign` / `campaignSession`; `save()` sin sesión es el de M2C sin cambios; con sesión delega en `CampaignSession`. `openCampaign` (inyectable), `connectCampaign` (composición del navegador), `syncCampaign`, `resolveConflict`. |
| `apps/control` · `CampaignStatus.tsx` | Indicador: APPROVED VERSION vN (solo lectura, §32), WORKING DRAFT rev R, estado (SINCRONIZADO / GUARDANDO / PENDIENTE · SIN CONEXIÓN / CONFLICTO / ERROR) y, ante un conflicto, los tres botones de §9 con confirmación. Sin campaña no renderiza nada. |
| `apps/control` · `TakeoverBuilder.tsx` | Al montar: con `?campaign=` abre la campaña; si no abre, cae al `loadFromStorage()` de M2C. Escucha `online` para subir lo pendiente. |

### Reglas del estado "guardado"

- El badge `SAVED` de M2C pasa a limpio solo si lo confirmado (servidor o local
  pendiente) es **el mismo draft que está en pantalla**: si se editó durante el
  guardado, sigue `UNSAVED` y el autosave sube lo nuevo.
- Un **conflicto** o un **error** dejan el draft sucio: cambiar de preset o
  importar pide confirmación, así nada pisa el trabajo que está en conflicto.
- Si la campaña no abre (sin sesión, sin permiso, sin backend), el indicador
  muestra el error y lo que se edite queda **solo en este navegador** (M2C).
  Nunca hay autosave hacia una campaña que no se abrió.
- "Duplicar" adopta el draft del servidor y ofrece **Descargar copia local**:
  crear la campaña nueva desde el Builder queda para E (no hay UI de contratos).

### Límite conocido

No hay pantalla de login en el Builder (Fase E): la sesión de C1 tiene que
existir en el navegador (cookie del mismo origen). Sin sesión, el indicador
dice `ERROR · UNAUTHENTICATED` y el Builder sigue local.
