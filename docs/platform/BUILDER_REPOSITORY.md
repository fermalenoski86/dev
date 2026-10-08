# Builder repository — `@trust/builder-repository` (M3A.1 Fase D2)

Master §9 (offline/conflicto) y §31 (Builder integration). ADR-061.
**No toca `apps/control`, `show-authoring` ni el formato de `DraftStorage`.**
D3 (el Builder lo usa) sigue bloqueado por el issue #15.

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

1. `save` escribe primero el draft local, en la clave de siempre. La metadata
   de sync va en una clave **aparte**, `trust.builder.sync.v1:<campaignId>`:
   `{v, campaignId, baseRevision, pending, draft}`, validada con Zod al leer.
   Si está corrupta o es de otra campaña, se ignora.
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
     campaña nueva queda para D3/E.
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
