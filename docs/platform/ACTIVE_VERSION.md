# Versión vigente con cuatro ojos — F3(a)

Brief: `docs/briefs/F3A_REDEPLOY.md` (aprobado en [#50](https://github.com/fermalenoski86/dev/pull/50#issuecomment-6110866495)).
Decisión de producto: ADR-064 (Fer, [#52](https://github.com/fermalenoski86/dev/issues/52#issuecomment-6109129274)).
Código: `packages/platform-campaigns/src/active-version.ts` (servicio),
`apps/platform-api/src/active-version-routes.ts` (rutas) y
`packages/platform-db/src/migrations/0004_active_version.ts` (base).

**Qué es:** `campaigns.active_version_id` dice cuál versión APPROVED de la
campaña es la **vigente**. Es un puntero administrativo: **no despliega nada**,
no hay Deploy, EDGE ni Scheduler en M3A.1. Cuando exista Deploy (M3B/M3C), lo
va a leer.

**Reglas (A2.2):**

- Aprobar una versión **nunca** la vuelve vigente.
- Toda selección o cambio es un **pedido** de una persona más una
  **confirmación** de otra. Eso incluye la primera selección, avanzar y
  volver atrás.
- Vale aunque el contrato tenga `four_eyes_required = false`.
- Después de la migración 0004, todas las campañas quedan con
  `activeVersion: null`.

## Rutas (bajo `/api/v1`)

| Método | Ruta | Roles | Respuestas |
|---|---|---|---|
| POST | `/campaigns/:id/active-version-changes` `{versionId, versionHash, reason, expectedActiveVersionId}` | OPERATOR · ADMIN | 201 · 400 · 403 · 404 `CAMPAIGN_NOT_FOUND` / `SHOW_VERSION_NOT_FOUND` · 409 |
| POST | `/active-version-changes/:id/confirm` `{versionHash}` | INTERNAL_APPROVER · ADMIN | 200 · 403 `FOUR_EYES_VIOLATION` · 404 · 409 |
| POST | `/active-version-changes/:id/cancel` (sin cuerpo, o `{}`; cualquier otro cuerpo, incluido `null`, es 400) | quien pidió o ADMIN | 200 · 403 · 404 · 409 |
| GET | `/campaigns/:id/active-version-changes?limit&cursor` | internos | 200 `{items, nextCursor}` · 400 `INVALID_CURSOR` · 404 |
| GET | `/campaigns/:id` | internos | agrega `activeVersion` y `pendingActiveVersionChange` |

**Requisitos de las tres mutaciones:**

- Las tres exigen sesión, CSRF e `Idempotency-Key`.
- El cuerpo es `.strict()`.
- `expectedActiveVersionId` es obligatorio. Vale `null` en la primera selección.

**Los 409:**

| Código | Cuándo | ¿Cambia algo? |
|---|---|---|
| `INVALID_STATE_TRANSITION` | Versión SUBMITTED o REJECTED (`details.status`), campaña archivada (`details.lifecycleStatus`) o pedido ya terminado | No |
| `VERSION_HASH_MISMATCH` | El hash no coincide (`details.versionHash`) | No |
| `ACTIVE_VERSION_UNCHANGED` | La versión ya es la vigente | No |
| `ACTIVE_VERSION_CHANGE_PENDING` | Ya hay un pedido pendiente (`details.changeId`) | No |
| `ACTIVE_VERSION_CONFLICT` al pedir | `expected` no es la vigente (`details.activeVersionId`) | No |
| `ACTIVE_VERSION_CONFLICT` al confirmar | La vigente cambió desde el pedido | **Sí:** el pedido queda `CANCELLED` |
| `ACTIVE_VERSION_CHANGE_EXPIRED` | El pedido venció | **Sí:** el pedido queda `EXPIRED` |
| `IDEMPOTENCY_KEY_REUSED` | La misma key se usó con otra solicitud | No |

Los dos 409 que cambian algo **se devuelven**, no se lanzan, desde la función de
`withIdempotency`. Así la transacción hace COMMIT con:

- el estado terminal del pedido;
- su evento de audit;
- la respuesta guardada con su key.

Un retry con la misma key repite ese 409 sin escribir de nuevo.

## Idempotencia

Un replay devuelve el **mismo status y el mismo body** que la respuesta
original, con `idempotent-replayed: true`:

| Operación | Primera respuesta → replay |
|---|---|
| Pedir | 201 → 201 |
| Confirmar | 200 → 200 |
| Cancelar | 200 → 200 |
| 409 que terminaliza el pedido | 409 → 409 |

Un 409 de terminalización guarda el body completo. Incluye el `requestId` de la
solicitud que produjo el efecto. En el replay, el header `x-request-id` es el
del retry.

Una confirmación aplicada cuya respuesta se perdió devuelve en el retry el
mismo 200, no un 409. Los errores que no cambian nada hacen rollback, incluida
la reserva de la key.

## Vencimiento

Un pedido PENDING vence a las `ACTIVE_VERSION_CHANGE_TTL_MINUTES`: default
1440 (24 h), rango 1–10 080.

- **Reloj:** `requested_at` y la comparación usan `now()` de PostgreSQL, nunca
  el reloj del host.
- **Sin job:** el vencimiento es perezoso y se evalúa al confirmar, al cancelar
  o al pedir otro.
- **Al confirmar o cancelar:** el pedido vencido pasa a `EXPIRED`, con audit, y
  la respuesta es 409.
- **Al pedir otro:** el pedido viejo vence y el nuevo entra normalmente.
- **En la lectura:** `GET /campaigns/:id` no muestra un pendiente vencido
  aunque todavía no se haya marcado. La lectura no escribe.

## Audit

| Acción | Actor | Hashes | Metadata |
|---|---|---|---|
| `ACTIVE_VERSION_CHANGE_REQUESTED` | Quien pide | `before` = vigente (o null), `after` = destino | `campaignId`, `fromVersionId`, `toVersionId`, `toVersionNumber`, `reason` |
| `ACTIVE_VERSION_CHANGED` (entidad `campaign`) | Quien confirma | Hash anterior / hash nuevo | `campaignId`, `fromVersionId`, `toVersionId`, `requestId` (id del pedido), `requestedBy`, `reason` |
| `ACTIVE_VERSION_CHANGE_CANCELLED` | Quien cancela, o quien confirmó en un conflicto | — | `cause`: `CANCELLED_BY_USER` / `ACTIVE_VERSION_CONFLICT` |
| `ACTIVE_VERSION_CHANGE_EXPIRED` | `null` (lo decide el reloj) | — | `campaignId`, `observedBy` |

Aprobar una versión **no** genera ningún evento de vigente.

## Base (segunda barrera)

- **Puntero:** FK compuesta (la vigente es de la misma campaña) y trigger
  `ACTIVE_NOT_APPROVED`. Ni el dueño del esquema fija una versión no aprobada.
- **Permisos de `trust_app`:**
  - pierde el UPDATE de tabla sobre `campaigns`;
  - recupera UPDATE solo en `contract_id`, `name`, `current_draft_id`,
    `latest_approved_version_id`, `lifecycle_status` y `updated_at`, sin
    `active_version_id`;
  - en `active_version_changes` tiene SELECT, INSERT y UPDATE, sin DELETE.
- **Función `trust_confirm_active_version_change(change, actor, hash)`:**
  - `SECURITY DEFINER`, `search_path = public, pg_temp`, `REVOKE … FROM
    PUBLIC`, `GRANT` a `trust_app`;
  - bloquea la campaña y después el pedido;
  - no confía en el UUID que recibe: quien confirma tiene que ser un usuario
    habilitado con INTERNAL_APPROVER o ADMIN (`CONFIRMER_NOT_AUTHORIZED`);
  - repite todas las invariantes: PENDING, cuatro ojos, hash, vencimiento,
    vigente = origen con `IS DISTINCT FROM` y destino APPROVED;
  - devuelve `CONFIRMED`, `EXPIRED` o `CONFLICT`. Lo demás es un error que no
    cambia nada.
- **Tabla `active_version_changes`:**
  - un solo PENDING por campaña;
  - nace PENDING con la fecha de la base, pedido por un usuario habilitado con
    OPERATOR o ADMIN (`REQUESTER_NOT_AUTHORIZED`);
  - una sola transición, en la que solo cambian `status`, `decided_by` y
    `decided_at`;
  - CONFIRMED solo desde la función (`CONFIRM_ONLY_VIA_FUNCTION`) y nunca por
    quien pidió (trigger y CHECK);
  - EXPIRED solo si venció de verdad;
  - sin DELETE ni TRUNCATE.

## Fuera de alcance

- **Deploy, EDGE, Scheduler y Proof of Play:** quedan para M3B/M3C.
- **F3(b):** "último estado bueno conocido" en EDGE.
- **UI:** vive en `platform-web`, en `/campaigns/[id]/active-version` (brief
  `docs/briefs/F3A_UI.md`, implementado en `fase/f3a-ui` para
  [#55](https://github.com/fermalenoski86/dev/issues/55)). Ver la sección
  "Interfaz" más abajo.
- **#43:** 403 de assets para INTERNAL_APPROVER.

## Interfaz (`platform-web`, F3(a) UI)

- **Ruta:** `/campaigns/[id]/active-version`. Se llega desde `/campaigns`
  ("Versión vigente" en cada fila), desde `/versions/:id` y desde el detalle de
  campaña.
- **Qué carga:** solo `GET /campaigns/:id`, el historial de pedidos y todas las
  páginas de versiones. Nunca `GET /assets`, así funciona para INTERNAL_APPROVER
  sin depender de #43.
- **Aviso fijo:** "Versión vigente administrativa: no despliega contenido al
  edificio."
- **Acciones según rol:** las de la tabla de arriba. Quien pidió, aunque tenga
  los dos roles, ve "Lo tiene que confirmar otra persona". Confirmar tiene un
  paso explícito con origen, destino, hashes y motivo.
- **Intenciones (`apps/platform-web/src/lib/intent.ts`):** cada mutación
  congela key y payload. Ante un resultado incierto (red, cuerpo ilegible o
  5xx) se conserva la intención y "Reintentar" manda lo mismo. Ante un
  resultado definitivo se descarta y la página vuelve a leer el estado.
- **Decisiones opuestas:** confirmar y cancelar deciden sobre el mismo pedido.
  Mientras una está en vuelo o incierta, la otra queda bloqueada (botones y
  handlers) hasta resolverla o descartarla. El error de un pedido rechazado se
  sigue viendo aunque, al releer, el formulario ya no esté.
- **204:** el cliente solo lo acepta en llamadas sin cuerpo (logout). En estas
  mutaciones es una respuesta fuera de contrato y cuenta como incierta.
- **Límite:** la recuperación de un resultado incierto dura lo que dura la
  Idempotency-Key en el servidor (24 h).
