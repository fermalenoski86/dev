# F3(a) — Volver a una versión aprobada anterior (`redeploy`) — brief para acordar

**Origen:** `docs/collab/BACKLOG.md` F3 ("Recuperación segura y trazable"),
parte (a) aceptada: "la operación `redeploy(versionId)` con audit y
four-eyes". Encargo del `AUDIT: APROBADO` de BL-08
([#48](https://github.com/fermalenoski86/dev/pull/48#issuecomment-6106938699)):
"Claude debe preparar primero un brief documental separado y devolverlo a
ChatGPT para acuerdo antes de implementar".

**Propuesto por Claude el 2026-10-11; ronda 1 de auditoría incorporada el
mismo día** ([AUDIT: CAMBIOS](https://github.com/fermalenoski86/dev/pull/50#issuecomment-6107845111):
Q1/Q3/Q4/Q5/Q6 acordadas, idempotencia completa agregada; ronda 2 cerró los
hallazgos técnicos).
**Decisión de producto recibida (ronda 3):** Fer resolvió en
[#52](https://github.com/fermalenoski86/dev/issues/52#issuecomment-6109129274)
**Q0 = A** y **Q2 = A2.2**. El brief queda incorporado a esas decisiones y
pendiente de la **auditoría final**; no se implementa `fase/f3a` antes de ella.
No hay código en este PR. Mismo
procedimiento que los briefs C y D: cada regla cita su base en el repo; lo que
el repo no decide va marcado con ❓ y se acuerda antes de codificar. Si una ❓
cambia producto, va a `decisión-producto` para Fer.

---

## 0. El choque que hay que resolver primero

`redeploy` supone un **deploy** previo, y hoy no existe:

- `M3A1_MASTER.md` §1: "NO implementar todavía: Scheduler, EDGE, **Deploy**…";
  §2: "No deploy endpoints". La cadena es CREATE → BACKEND → APPROVAL →
  *posteriormente* SCHEDULE → DEPLOY → PLAY; EDGE físico entra en **M3C**.
- Lo único que existe es `campaigns.latest_approved_version_id`, que **solo
  avanza hacia una versión más nueva** (`platform-approval/src/service.ts`,
  `version_number <`) y que la base exige APPROVED
  (`trust_campaign_latest_approved`, 0001).

Entonces "volver a desplegar" no puede significar empujar nada a un edificio.
Lo que sí se puede construir hoy, en el control plane y sin violar el master, es
**decidir cuál versión aprobada es la vigente** de una campaña, con dos
personas y con registro. Deploy (cuando exista) lee esa decisión; no la toma.

**Propuesta (opción A):** un puntero nuevo, `campaigns.active_version_id`
("versión vigente"), separado de `latest_approved_version_id`. El rollback
mueve el puntero a una versión aprobada anterior de la **misma** campaña. No
se borra, no se re-aprueba, no se toca ninguna ShowVersion (son inmutables y
selladas: hash JCS + manifiesto congelado), no se toca el audit.

Alternativas descartadas o a decidir:

- **B. Mover `latest_approved_version_id` hacia atrás.** Descartada: rompe su
  significado ("la última aprobada") y la invariante que hoy prueba el
  servicio de aprobación; mezcla "qué se aprobó" con "qué se usa".
- **C. Postergar F3(a) hasta que exista Deploy (M3B/M3C).** Descartada por Fer.

**Q0 resuelta por Fer: A** ([#52](https://github.com/fermalenoski86/dev/issues/52#issuecomment-6109129274)):
"incorporar ahora `active_version_id` / «versión vigente» por campaña como
puntero administrativo; **no** implica despliegue ni envío de contenidos al
edificio. Mantener Deploy para M3B/M3C conforme al plan maestro." Nada en esta
fase ejecuta, empuja ni programa contenido.

## 1. Modelo

1. `campaigns.active_version_id uuid NULL`, FK compuesta
   `(active_version_id, id) → show_versions(id, campaign_id)` (como
   `campaigns_latest_approved_fk`): la vigente es de **esta** campaña.
2. Trigger de segunda barrera (como `trust_campaign_latest_approved`): la
   vigente tiene una Approval `APPROVED`. Una REJECTED o SUBMITTED nunca puede
   ser vigente, aunque la app se equivoque.
3. Tabla `active_version_changes` (pedido de cambio, ver §3): `id`,
   `campaign_id`, `from_version_id` (la vigente al pedir, puede ser NULL),
   `to_version_id`, `to_version_hash`, `reason` (1–2000), `requested_by`,
   `requested_at`, `status` (`PENDING` · `CONFIRMED` · `CANCELLED` · `EXPIRED`),
   `decided_by`, `decided_at`. Un solo `PENDING` por campaña (índice único
   parcial). Inmutable salvo la transición única `PENDING →` terminal (trigger,
   como las Approvals).
4. Migración `0004_active_version`, **reversible**, con el mismo patrón de
   grants: `trust_app` no actualiza `active_version_id` por fuera de la
   función que confirma. **Q1 acordada:** función `SECURITY DEFINER`
   (como `trust_create_show_version`) con **todas** las invariantes adentro
   (campaña bloqueada `FOR UPDATE`, pedido PENDING y no vencido según `now()`
   de la base, vigente = `from_version_id`, destino APPROVED de esta campaña,
   hash, cuatro ojos), `SET search_path = public, pg_temp` (`pg_temp` al
   final), `REVOKE EXECUTE … FROM PUBLIC` y `GRANT EXECUTE` solo a `trust_app`
   (documentación de PostgreSQL, `CREATE FUNCTION`, "Writing SECURITY DEFINER
   Functions Safely"). `trust_app` no tiene UPDATE sobre `active_version_id`.
5. **Datos existentes: sin selección automática** (hallazgo 2 de la ronda 1,
   revisado en la ronda 3 para cumplir A2.2). La migración agrega la columna
   con `NULL` para **todas** las campañas, también las que ya tienen versiones
   aprobadas: **no** copia `latest_approved_version_id`.
   - Motivo: A2.2 dice que "toda selección o cambio de versión vigente requiere
     una solicitud y una confirmación explícita por una segunda persona". Copiar
     la última aprobada sería una selección sin nadie que la pida ni la
     confirme. Hoy ningún consumidor lee el puntero (no hay Deploy), así que
     arrancar en `NULL` no cambia ningún comportamiento existente.
   - `activeVersion: null` = "sin versión vigente". La primera selección de una
     campaña con aprobadas es un pedido normal con `expectedActiveVersionId: null`, confirmado por otra persona (§3).
   - Campaña sin aprobaciones → `NULL` y no se puede pedir nada (no hay destino
     APPROVED).
   - Sin audit en la migración (no hay decisión que registrar) y sin evento
     `ACTIVE_VERSION_BACKFILLED` (acordado en la ronda 2).
   - **Down:** borra tabla, función, triggers y columna sin tocar versiones ni
     aprobaciones; **up de nuevo** deja todo en `NULL` otra vez. Probado con
     datos poblados (ver §6.12).
   - Esto **reemplaza** el backfill `= latest_approved_version_id` que se cerró
     en la ronda 2 con A2.1 todavía abierta; se declara para que el auditor lo
     juzgue en la auditoría final.

## 2. ¿Qué pasa al aprobar una versión nueva?

**Q2 resuelta por Fer: A2.2** ([#52](https://github.com/fermalenoski86/dev/issues/52#issuecomment-6109129274)):
"una versión nueva aprobada **nunca** pasa automáticamente a vigente. Toda
selección o cambio de versión vigente (incluido volver a una versión anterior)
requiere una solicitud y una confirmación explícita por una segunda persona
autorizada («cuatro ojos»)."

Máquina de estados resultante (la vigente solo cambia en un lugar):

| Evento | `active_version_id` |
|---|---|
| Migración 0004 | `NULL` en todas las campañas (§1.5) |
| Submit / approve / reject de una versión | **sin cambios** (ni siquiera si es `NULL`) |
| Pedido de cambio (PENDING) | sin cambios |
| Confirmación por otra persona | pasa a `to_version_id` |
| Cancelación / vencimiento / conflicto | sin cambios |

Consecuencias: `platform-approval` **no se toca** (approve/reject siguen
iguales); no existe el evento `ACTIVE_VERSION_FOLLOWED_APPROVAL`; la única
escritura de `active_version_id` es la función de confirmación (§1.4).

## 3. Operación con cuatro ojos

Cuatro ojos hoy es "quien envió no aprueba" (§18, `FOUR_EYES_VIOLATION`, app +
trigger `trust_four_eyes`), por contrato (`four_eyes_required`). Para la
versión vigente la regla es **quien pide no confirma, siempre**: la decisión
de Fer (A2.2) exige "una segunda persona autorizada" para **toda** selección o
cambio, así que acá `four_eyes_required = false` del contrato **no** la
relaja (declarado para la auditoría final).

Consecuencia declarada: un contrato con **una sola persona** con roles de
plataforma no puede fijar nunca una vigente (nadie más confirma). Hoy no rompe
nada (no hay Deploy que lea el puntero) y es lo que pide A2.2; si se vuelve un
problema operativo, es decisión de Fer, no una excepción en el código.

1. **Pedir** — `POST /api/v1/campaigns/:id/active-version-changes`
   `{ versionId, versionHash, reason, expectedActiveVersionId }`.
   - Roles: OPERATOR · ADMIN (**Q3 acordada:** INTERNAL_APPROVER no pide).
   - CSRF + `Idempotency-Key` obligatoria (§28, ver §3.6). Cuerpo `.strict()`.
   - Campaña bloqueada (`FOR UPDATE`) y `ACTIVE` (archivada → 409
     `INVALID_STATE_TRANSITION`).
   - `versionId` de esta campaña y APPROVED (otra campaña o inexistente →
     404 `SHOW_VERSION_NOT_FOUND`; SUBMITTED/REJECTED → 409
     `INVALID_STATE_TRANSITION` con `details.status`).
   - `versionHash` = hash de la versión, si no 409 `VERSION_HASH_MISMATCH`
     (como approve: se confirma lo que se vio).
   - `expectedActiveVersionId` (uuid o `null`, obligatorio) = vigente actual
     (`null` para la primera selección), si no 409
     `ACTIVE_VERSION_CONFLICT` con `details.activeVersionId` (concurrencia
     optimista, §48.3). Con `NULL` posible de los dos lados, la comparación es
     `IS NOT DISTINCT FROM` (en SQL) / igualdad estricta con `null` (en TS),
     nunca `=`/`<>`: `v1 <> NULL` da `NULL` y un chequeo `IF … <> …` dejaría
     pasar un pedido viejo de "primera selección" sobre una vigente ya fijada.
   - Ya es la vigente → 409 `ACTIVE_VERSION_UNCHANGED`. Ya hay un PENDING →
     409 `ACTIVE_VERSION_CHANGE_PENDING` con su id.
   - 201 con el pedido. Audit `ACTIVE_VERSION_CHANGE_REQUESTED`.
2. **Confirmar** — `POST /api/v1/active-version-changes/:id/confirm`
   con cuerpo `{ versionHash }`. CSRF + `Idempotency-Key` obligatoria (§3.6).
   - Roles: INTERNAL_APPROVER · ADMIN (**Q4 acordada:** EXTERNAL_APPROVER no
     confirma cambios operativos internos en esta etapa).
   - Siempre `decided_by ≠ requested_by` → si no, 403 `FOUR_EYES_VIOLATION`,
     sin importar `four_eyes_required` del contrato; segunda barrera dentro de
     la función y en un trigger de la tabla (no hay forma de confirmar el
     propio pedido).
   - Relee todo con la campaña bloqueada: pedido `PENDING` y no vencido, la
     vigente sigue siendo `from_version_id` (`IS NOT DISTINCT FROM`, ver §3.1;
     si no, 409
     `ACTIVE_VERSION_CONFLICT` y el pedido queda `CANCELLED`, **persistido**:
     ver §3.7), destino sigue APPROVED, hash coincide.
   - Mueve `active_version_id`, marca `CONFIRMED`, audit
     `ACTIVE_VERSION_CHANGED` con `beforeHash`/`afterHash` = hash de la
     versión anterior/nueva y metadata `{ campaignId, fromVersionId, toVersionId, requestId, requestedBy, reason }`.
3. **Cancelar** — `POST /api/v1/active-version-changes/:id/cancel`: quien pidió
   o ADMIN. CSRF + `Idempotency-Key` obligatoria (§3.6). Audit
   `ACTIVE_VERSION_CHANGE_CANCELLED`.
4. **Vencimiento** — **Q5 acordada:** un PENDING vence a las 24 h
   (`ACTIVE_VERSION_CHANGE_TTL_MINUTES`), medido con `now()` de PostgreSQL
   (`requested_at` también lo escribe la base), nunca con el reloj del host.
   Vencimiento **perezoso**: se evalúa al confirmar, cancelar o pedir otro (sin
   job); el que vence pasa a `EXPIRED` con audit, persistido aunque la
   respuesta sea 409 (§3.7).
5. **Lectura** — `GET /campaigns/:id` agrega `activeVersion {id, versionNumber, versionHash}` y `pendingActiveVersionChange` (o `null`).
   `GET /campaigns/:id/active-version-changes` (historial paginado, keyset
   como BL-31).

6. **Idempotencia de las tres mutaciones** (hallazgo 3a de la ronda 1). Pedir,
   confirmar y cancelar usan `withIdempotency` (`platform-db`, el mismo de
   approve/reject):
   - operación distinta por ruta (`active-version-change.request`,
     `.confirm`, `.cancel`) y fingerprint = `SHA256(JCS({ operation, payload }))` con el id de la ruta y el cuerpo `.strict()` (para confirmar:
     `{ changeId, versionHash }`; para cancelar: `{ changeId }`);
   - misma key + mismo pedido → **replay**: el **mismo status y el mismo
     body** de la respuesta original, con `idempotent-replayed: true`
     (`withIdempotency` guarda `response_status`/`response_body` y los repite
     tal cual). Por operación: pedir **201 → 201**; confirmar y cancelar
     **200 → 200**; terminalización con efecto (§3.7) **409 → 409**. Vale
     aunque el estado ya haya cambiado: una confirmación aplicada cuya
     respuesta se perdió devuelve el mismo 200 y el mismo cuerpo, no un 409 de
     transición inválida;
   - misma key + otro pedido → 409 `IDEMPOTENCY_KEY_REUSED`;
   - reserva y operación en la misma transacción (dos retries simultáneos
     ejecutan una vez).
7. **Terminalización que acompaña un 409** (hallazgo 3b de la ronda 1). Los
   casos en que la operación **cambia algo y responde 409** (vigente cambiada
   → pedido `CANCELLED`; pedido vencido → `EXPIRED`) no se implementan con
   `throw` dentro de la transacción, porque el rollback se llevaría el cambio
   y su audit. El servicio **devuelve** `{ status: 409, body }` desde la
   función de `withIdempotency`: la transacción hace COMMIT (estado terminal +
   evento de audit + respuesta guardada con su key) y recién después la ruta
   responde 409. Un retry con la misma key repite ese 409 sin volver a
   escribir. Los 409 que **no** cambian nada (hash, estado, PENDING
   existente) siguen con `throw` y rollback, como hoy.

Scope por contrato igual que C1/C2/BL-31: fuera de scope = 404 (no revela que
existe); visible sin rol = 403. Todo en `OpenAPI` y `DELIVERY.md` regenerados.

## 4. Auditoría

Acciones nuevas en `AuditAction` (§27 dice "al menos"):
`ACTIVE_VERSION_CHANGE_REQUESTED`, `ACTIVE_VERSION_CHANGED`,
`ACTIVE_VERSION_CHANGE_CANCELLED` y `ACTIVE_VERSION_CHANGE_EXPIRED`. Con
A2.2, aprobar una versión **no** genera ningún evento de versión vigente (no
existe `ACTIVE_VERSION_FOLLOWED_APPROVAL`). Todas en la misma transacción
que el cambio que registran; `verifyChain` sigue ok. Sin datos de cliente en
metadata (ids, hashes, motivo).

## 5. Fuera de alcance

- Empujar a EDGE, Deploy, Scheduler, Proof of Play (master §1; M3B/M3C).
- F3(b) "último estado bueno conocido" en EDGE (Fer decide el milestone).
- UI: **Q6 acordada:** API + OpenAPI primero; la vista en `platform-web` va en
  una unidad separada, con issue trazable abierto **antes** de declarar la
  operación usable por personas.
- `apps/control`, M2C.2, ShowEngine, compilador, storage B1 y formato del
  ShowPackage: **no se tocan**.
- #43 (403 de assets a INTERNAL_APPROVER) sigue en `decisión-producto`.

## 6. Criterios verificables (pruebas)

PostgreSQL real, sin mocks en el camino feliz:

1. Rollback completo: v1 y v2 aprobadas, vigente v2 → pide A, confirma B →
   vigente v1; audit REQUESTED + CHANGED con hashes; `verifyChain` ok.
2. Cuatro ojos: A pide y A confirma → 403, nada cambia, **también** en un
   contrato con `four_eyes_required = false`; con el chequeo de la app
   removido (mutación) la base igual lo rechaza.
3. Destino inválido: SUBMITTED, REJECTED, de otra campaña (404, sin revelar),
   hash equivocado (409), ya vigente (409).
4. Concurrencia: dos pedidos simultáneos → uno 201, otro 409 PENDING; dos
   confirmaciones simultáneas → una gana; vigente cambiada entre pedir y
   confirmar → 409 y el pedido queda CANCELLED.
5. Vencimiento: pedido vencido no se confirma (409) y queda EXPIRED con audit.
6. Segunda barrera en la base: UPDATE directo a una versión no aprobada o de
   otra campaña → error de PostgreSQL.
7. A2.2: aprobar v3 con la vigente en `NULL`, en v2 (= última aprobada) o en
   v1 → la vigente **no cambia** en ningún caso y no hay evento de versión
   vigente; quedar vigente requiere pedido + confirmación de otra persona.
   La primera selección (`expectedActiveVersionId: null`) funciona y queda
   auditada. Mutación: avanzar el puntero al aprobar hace fallar el test.
8. Idempotencia, **una prueba por operación**: misma key + mismo pedido →
   el **mismo status y body** que la respuesta original y sin segundo efecto
   (pedir 201 → 201 y un solo pedido; confirmar 200 → 200; cancelar
   200 → 200; terminalización §3.7 409 → 409, cubierta en §6.13); otro pedido
   con la misma key → 409 `IDEMPOTENCY_KEY_REUSED`.
   **Confirmación aplicada con respuesta perdida:** el retry con la misma key
   devuelve el mismo 200 y cuerpo (no 409), la vigente no cambia de nuevo y
   hay un solo `ACTIVE_VERSION_CHANGED`. Mutación: forzar 200 en el replay del
   pedido hace fallar el test.
9. Inmutabilidad: ShowVersions, manifiestos, Approvals y blobs idénticos antes
   y después de un rollback (foto completa, como BL-08).
10. Mutaciones nuevas `f3a:` para cada regla (cuatro ojos app y base,
    hash, campaña, estado APPROVED, concurrencia, vencimiento, audit).
11. Migración 0004 up/down/up limpia; bootstrap, M2C 14/14 y el resto de los
    gates sin regresión.
12. **Migración con datos poblados:** campañas con v2 aprobada, con v1 y v2
    aprobadas y v3 SUBMITTED, y sin aprobaciones → todas con vigente `null`
    después de 0004 (ninguna copia de `latest_approved_version_id`); down con
    datos (sin error, sin perder versiones ni aprobaciones) y up de nuevo con
    el mismo resultado. Mutación: el backfill `= latest_approved_version_id`
    hace fallar el test.
13. **409 con efecto persistido:** vigente cambiada entre pedir y confirmar →
    409 `ACTIVE_VERSION_CONFLICT`; después, en otra conexión: pedido
    `CANCELLED`, un evento `ACTIVE_VERSION_CHANGE_CANCELLED`, `verifyChain` ok;
    retry con la misma key → el mismo 409 sin segundo evento. Igual para un
    pedido vencido (`EXPIRED`). Mutación: cambiar el `return` por `throw` hace
    fallar el test.
14. **Función `SECURITY DEFINER`:** `PUBLIC` no tiene EXECUTE; `trust_app` sí;
    `search_path` de la función termina en `pg_temp` (consulta a
    `pg_proc.proconfig`); `trust_app` no puede hacer UPDATE directo de
    `active_version_id`.
15. **`NULL` en la concurrencia optimista:** pedido de primera selección
    (`from_version_id NULL`) y vigente puesta en v1 por fuera (superusuario, solo
    en el test) antes de confirmar → 409 `ACTIVE_VERSION_CONFLICT` y pedido
    `CANCELLED`; al revés (pedido con `from = v1`, vigente llevada a `NULL`) →
    también 409. Mutación: reemplazar `IS NOT DISTINCT FROM` por `=`/`<>` en la
    función hace fallar el test.

## 7. Preguntas a acordar (resumen)

| # | Pregunta | Estado |
|---|---|---|
| Q0 | ¿Puntero "vigente" ahora (A) o esperar a Deploy (C)? | **decidida por Fer: A** ([#52](https://github.com/fermalenoski86/dev/issues/52#issuecomment-6109129274)); puntero administrativo, sin Deploy |
| Q1 | ¿Función `SECURITY DEFINER` o UPDATE + trigger? | **acordada:** función endurecida (§1.4) |
| Q2 | ¿La vigente sigue a la última aprobada (A2.1) o nunca sola (A2.2)? | **decidida por Fer: A2.2** (#52); nunca automática, siempre dos personas |
| Q3 | ¿INTERNAL_APPROVER también pide? | **acordada:** no; pide OPERATOR/ADMIN |
| Q4 | ¿EXTERNAL_APPROVER confirma? | **acordada:** no en esta etapa |
| Q5 | Vencimiento del pedido | **acordada:** 24 h, perezoso, reloj de la base (§3.4, §3.7) |
| Q6 | ¿UI en el mismo cambio? | **acordada:** separada, con issue trazable |

Con Q0–Q6 resueltas, falta la **auditoría final** de este brief. Recién con
`AUDIT: APROBADO` se implementa en `fase/f3a` desde `main`, con los gates de
`AGENTS.md`, reporte `docs/reviews/F3A.md` y salida real. La decisión de
producto queda registrada como ADR-064 en `docs/architecture/DECISIONS.md`.
