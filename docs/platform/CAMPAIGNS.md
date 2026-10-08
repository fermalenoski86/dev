# Campaigns y drafts — M3A.1 Fase D1

`@trust/platform-campaigns` (servicio + regla de superficies) · rutas en
`apps/platform-api/src/campaign-routes.ts` · ADR-060. Brief:
`docs/briefs/M3A1_FASE_D.md` §D1 (aprobado en #13). Sin migración nueva: las
tablas son de Fase A.

## Rutas (bajo `/api/v1`)

| Método | Ruta | Roles | Respuestas |
|---|---|---|---|
| POST | `/advertisers` | ADMIN | 201 · 400 · 403 · 409 `ADVERTISER_EXISTS` |
| GET | `/advertisers?limit&cursor` | OPERATOR · INTERNAL_APPROVER · ADMIN | 200 `{items, nextCursor}` |
| POST | `/contracts` | ADMIN | 201 · 400 · 403 · 404 · 422 `CONTRACT_INVALID` |
| GET | `/contracts?advertiserId&limit&cursor` · `/contracts/:id` | internos | 200 · 404 |
| PATCH | `/contracts/:id` | ADMIN | 200 · 400 (p. ej. `advertiserId`) · 403 · 404 · 422 |
| POST | `/campaigns` `{contractId, name, takeoverDraft?}` | OPERATOR · ADMIN | 201 · 403 · 404 · 422 `DRAFT_INVALID` / `SURFACE_NOT_CONTRACTED` |
| GET | `/campaigns?contractId&limit&cursor` · `/campaigns/:id` | internos | 200 · 404 |
| GET | `/campaigns/:id/draft` | internos | 200 `{campaignId, draftId, revision, updatedAt, takeoverDraft}` |
| PUT | `/campaigns/:id/draft` `{takeoverDraft, expectedRevision}` | OPERATOR · ADMIN | 200 · 400 · 403 · 404 · 409 `DRAFT_CONFLICT` / `INVALID_STATE_TRANSITION` · 422 |

Toda mutación exige sesión + CSRF (C1). EXTERNAL_APPROVER no usa estas rutas
(el portal externo está fuera de alcance). Cuatro ojos sigue en su ruta propia
`PUT /contracts/:id/four-eyes` (C2): `PATCH` no lo toca.

## Concurrencia optimista (§8, §9)

`PUT /campaigns/:id/draft` es un `UPDATE … WHERE revision = expectedRevision`
en una transacción. Si no coincide, **no se escribe nada** y responde:

```json
{ "code": "DRAFT_CONFLICT", "details": { "serverRevision": 7, "clientRevision": 5, "serverUpdatedAt": "…" } }
```

Sin merge automático ni last-write-wins. Una revisión "del futuro" también es
conflicto. El trigger de 0001 exige que la revisión avance exactamente 1. No
hay Idempotency-Key (decisión 4): un retry después de un éxito da 409 con
`serverRevision = clientRevision + 1`, y el cliente lo reconcilia leyendo el
draft. Audit `DRAFT_UPDATED` con `beforeHash`/`afterHash` = sha256 del draft
canónico (JCS), nunca el JSON.

## Superficies del contrato (§6, decisión 1)

Un draft "usa" una pantalla si algún moment le da una directiva que no es
`hold` (`play` o `black`):

- `upperMode: master` → `upper` usa screen_a y screen_b (y la horizontal si `includeHorizontalInMaster`);
- `upperMode: independent` → `corrientes` usa screen_a y `pellegrini` usa screen_b;
- `horizontal` usa horizontal.

Si alguna no está en `contracts.allowed_surfaces` → 422
`SURFACE_NOT_CONTRACTED` con `details.screens`. Se aplica al crear la campaña
con draft, en el `PUT` del draft y en el submit (C3). Reducir las superficies
de un contrato **no reescribe** drafts ni versiones: la regla vale para las
escrituras y submits siguientes.

`allowedSurfaces` de un contrato se valida contra las pantallas del modelo del
edificio (`buildingSurfaceIds`) y se guarda ordenado y sin repetidos.

## Campaign (§7, §32)

Se crea con su Draft inicial en la misma transacción (por defecto
`PRESET_EMPTY` con el nombre de la campaña) y `CAMPAIGN_CREATED`.
`GET /campaigns/:id` devuelve a la vez `currentDraft {id, revision, updatedAt}`
y `latestApprovedVersion {id, versionNumber, versionHash}`: es lo que la UI
necesita para mostrar "APPROVED VERSION vN" y "WORKING DRAFT".

Audit: `ADVERTISER_CREATED` (sin datos comerciales), `CONTRACT_CREATED`,
`CONTRACT_UPDATED` (campos cambiados), `CAMPAIGN_CREATED`, `DRAFT_UPDATED`.
