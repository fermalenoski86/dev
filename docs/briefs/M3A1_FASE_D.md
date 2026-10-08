# M3A.1 — FASE D: Builder repository integration y revisión offline/conflictos — brief derivado

**Origen:** `M3A1_MASTER.md` §44 (FASE D = Builder repository integration ·
offline revision/conflict), con los requisitos de §5–9, §27, §28, §30, §31,
§32 y §42. Como en Fase C, **no hay un brief escrito por Fer**: este documento
no agrega requisitos. Ordena los del master en checkpoints, cita cada sección
y deja marcado con ❓ lo que el master no decide o lo que choca con una regla
vigente.

**Propuesto por Claude el 2026-10-08 para acordar antes de codificar** (mismo
procedimiento que el brief C en el PR #7). Fase C quedó cerrada con C3
mergeado (#10).

Ya existe y NO se rehace: tablas `advertisers`, `contracts`, `campaigns`,
`campaign_drafts` (revisión monotónica por trigger, nunca last-write-wins),
auth/roles/scope (C1), approval (C2), submit (C3), audit, idempotencia,
`TakeoverDraftSchema`, `compileTakeoverDraft`/`validateDraft`.

---

## D1 — API de Campaign y Draft con concurrencia optimista (§5–9, §30)

1. **Advertisers y Contracts** (§5, §6, §30): `POST/GET /advertisers`,
   `POST/GET /contracts`, `PATCH /contracts/:id` (sin cambiar `advertiserId`).
   Solo ADMIN escribe; los roles internos leen. Audit `ADVERTISER_CREATED`,
   `CONTRACT_CREATED`, `CONTRACT_UPDATED` (§27). Zod en la entrada.
   `allowedSurfaces` validado contra las pantallas del modelo del edificio
   (`buildingSurfaceIds`, ya existe).
2. **Campaigns** (§7, §30): `POST /campaigns` (crea campaña + Draft inicial en
   la misma transacción, `CAMPAIGN_CREATED`), `GET /campaigns?contractId=`,
   `GET /campaigns/:id` con `currentDraft {id, revision, updatedAt}` y
   `latestApprovedVersion {id, versionNumber, versionHash}` (§7: coexisten).
   OPERATOR o ADMIN crean; scope por contrato como en C1/C2.
3. **Draft** (§8, §30): `GET /campaigns/:id/draft` → `{ takeoverDraft,
   revision, updatedAt }`. `PUT /campaigns/:id/draft { takeoverDraft,
   expectedRevision }`:
   - `TakeoverDraftSchema` en el servidor (422 `DRAFT_INVALID`);
   - `expectedRevision ≠ revision` → **409 `DRAFT_CONFLICT`** con
     `details: { serverRevision, clientRevision, serverUpdatedAt }` (§9),
     **sin escribir nada** y sin merge automático;
   - éxito: `revision + 1` (el trigger de 0001 ya lo exige), `DRAFT_UPDATED`
     en la misma transacción (con sha256 del draft canónico como `afterHash`,
     no el JSON);
   - Idempotency-Key opcional (§28 no lo exige para draft; el
     `expectedRevision` ya evita la doble escritura): ❓ ver decisión 3.
4. **Approved read-only** (§32): nada que construir en la base (las versiones
   ya son inmutables); el `GET /campaigns/:id` expone las dos cosas para que
   la UI muestre "APPROVED VERSION vN" y "WORKING DRAFT".

Gate D1: verify, build, PG, bootstrap, media, mutaciones (nuevas: conflicto
ignorado → last-write-wins, revisión no avanza, draft sin validar, audit
omitido, scope de contrato en campaigns, ADMIN-only en contracts) y E2E M2C.

**Estado D1:** implementado en `fase/m3a1-d1`; detalle en `docs/platform/CAMPAIGNS.md`
y `docs/reviews/M3A1_FASE_D1.md`.

## D2 — Repository abstraction (§31), sin tocar la UI

`CampaignRepository` en un **paquete nuevo** (`@trust/builder-repository`),
para no tocar `show-authoring` (M2C) ni `apps/control`:

- interfaz: `open(campaignId)`, `save(draft, expectedRevision)` →
  `{ ok, revision } | { conflict: { serverRevision, clientRevision, serverUpdatedAt } }`,
  `status()` (online/offline/pendiente);
- `LocalCampaignRepository`: envuelve la persistencia local actual
  (`DraftStorage`), sin cambiar su formato;
- `ApiCampaignRepository`: `fetch` inyectado (nada de `fetch()` dentro de
  componentes React, §31), CSRF y cookie de C1;
- `SyncingCampaignRepository`: guarda local siempre; online sincroniza con
  `expectedRevision`; ante 409 **no pisa el servidor** y deja el conflicto con
  las tres salidas de §9 (recuperar server, mantener local, duplicar como draft
  nuevo) como operaciones del repositorio, sin UI.
- Tests: unitarios con storage en memoria y tests contra la API real de D1
  (Fastify + PostgreSQL), incluido el ciclo offline → online → conflicto.

## D3 — Builder usa el repositorio (§31, §32) ❓ choca con una regla vigente

§31 pide que el Builder abra la campaña del backend, haga autosave con
`expectedRevision` y muestre "APPROVED VERSION vN / WORKING DRAFT" (§32).
Eso exige tocar `apps/control/src/state/useBuilderStore.ts` y la UI del
Builder. **AGENTS.md** dice: "No se toca `apps/control` ni la experiencia
ejecutiva salvo bug demostrado con test". §42 del master permite una
"adaptación mínima estrictamente necesaria para navegación/backend",
documentada.

Propuesta: D3 toca solo el store del Builder (inyecta un `CampaignRepository`,
con `LocalCampaignRepository` por defecto, así el comportamiento actual no
cambia sin backend) y agrega un indicador de estado/versión. No toca la
experiencia ejecutiva, el renderer, la geometría ni los screenshots. Los 14 E2E
de M2C tienen que seguir pasando. **Requiere decisión de Fer** (issue
`decisión-producto`): mientras tanto D1 y D2 avanzan y D3 no se inicia.

## Decisiones a validar (❓)

1. **§6 "una Campaign no puede utilizar una superficie fuera de su Contract.
   El backend valida esto server-side."** Es requisito del master, no regla
   nueva: es lo que BL-17 proponía para el submit. Propuesta: en D1, el
   `PUT draft` **y** el submit rechazan (422 `SURFACE_NOT_CONTRACTED`) un draft
   cuyo ShowPackage reproduce media en pantallas fuera de `allowed_surfaces`.
   El auditor dijo que BL-17 no se incorpora "silenciosamente": acá queda
   explícito para que lo apruebe o lo saque.
2. **Advertiser/Contract CRUD mínimo en D1** (crear, listar, editar contrato;
   sin borrar): §30 los lista y el E2E de §41 necesita crear campaña, que exige
   contrato. Alternativa: dejarlos para Fase E y crear contratos solo por CLI.
3. **Idempotency-Key en `PUT draft`:** opcional. El `expectedRevision` ya hace
   que un retry después de un éxito dé 409 (y la UI ve `serverRevision =
   clientRevision + 1`). Con key, el retry devuelve el 200 original.
4. **BL-18 (vigencia del contrato)** sigue fuera: el master no lo pide.
5. **Paquete nuevo para el repositorio** en vez de `show-authoring`, para no
   tocar código de M2C.

## Fuera de alcance

Login UI, E2E completo de §41, hardening y docs finales (Fase E), Scheduler,
EDGE, Deploy, portal externo, BL-14/15/16/18.

## Propuestas de mejora (≤ 3)

- **BL-19 · Conflicto con diff estructurado.** §9 pide devolver revisiones y
  fecha. Sumar en `details` la lista de moments cambiados (ids, no contenido)
  entre la revisión del cliente y la del servidor haría la pantalla de
  "recuperar / mantener / duplicar" mucho más útil, sin merge automático.
  Requiere guardar historia de revisiones (hoy solo hay la actual): modelo
  nuevo, decisión de producto. ~1 día.
- **BL-20 · `ETag`/`If-Match` además del `expectedRevision` en el cuerpo.**
  RFC 9110 §13.1.1 define `If-Match` para evitar el "lost update" en PUT, y
  412 Precondition Failed. Propuesta: aceptar `If-Match: "<revision>"` como
  alternativa estándar y mantener el 409 `DRAFT_CONFLICT` del master como
  respuesta (el master manda el código). ~0,5 día. Fuente:
  https://www.rfc-editor.org/rfc/rfc9110#section-13.1.1
