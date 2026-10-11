# F3(a) — Volver a una versión aprobada anterior (`redeploy`) — brief para acordar

**Origen:** `docs/collab/BACKLOG.md` F3 ("Recuperación segura y trazable"),
parte (a) aceptada: "la operación `redeploy(versionId)` con audit y
four-eyes". Encargo del `AUDIT: APROBADO` de BL-08
([#48](https://github.com/fermalenoski86/dev/pull/48#issuecomment-6106938699)):
"Claude debe preparar primero un brief documental separado y devolverlo a
ChatGPT para acuerdo antes de implementar".

**Propuesto por Claude el 2026-10-11; ronda 1 de auditoría incorporada el
mismo día** ([AUDIT: CAMBIOS](https://github.com/fermalenoski86/dev/pull/50#issuecomment-6107845111):
Q1/Q3/Q4/Q5/Q6 acordadas, backfill e idempotencia completa agregados; Q0/Q2
siguen esperando a Fer en [#52](https://github.com/fermalenoski86/dev/issues/52)).
**Estado: bloqueado por Q0/Q2. No se implementa ni se aprueba la versión final
hasta que Fer responda #52.** No hay código en este PR. Mismo
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
- **C. Postergar F3(a) hasta que exista Deploy (M3B/M3C).** Válida si Fer
  prefiere no agregar un concepto de "vigente" antes del scheduler.
  ❓**Q0 (producto):** ¿A o C? Si es C, este brief queda archivado y se abre
  `decisión-producto`.

El resto del brief asume A.

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
5. **Backfill de datos existentes** (hallazgo 2 de la ronda 1), dentro de la
   misma migración y transacción que agrega la columna:
   `UPDATE campaigns SET active_version_id = latest_approved_version_id`.
   - Campaña con versión aprobada → su vigente es la última aprobada (lo mismo
     que hoy significaría "lo que se usa").
   - Campaña sin aprobaciones → `active_version_id` queda `NULL` = "sin versión
     vigente"; `GET /campaigns/:id` devuelve `activeVersion: null` y pedir un
     cambio es imposible (no hay destino APPROVED). La primera aprobación la
     fija según Q2.
   - El backfill no escribe audit (no es una decisión de nadie: es el estado
     equivalente al de antes de la columna); el reporte de la migración lo
     declara. ❓ si el auditor prefiere un evento `ACTIVE_VERSION_BACKFILLED`
     por campaña, se agrega.
   - **Down:** borra tabla, función, triggers y columna; **up de nuevo** vuelve
     a calcular el backfill. Probado con datos poblados (ver §6.12).
   - Esta regla vale para Q2 = A2.1 y también para A2.2 (en A2.2 el backfill
     igual conserva lo que hoy es la última aprobada). Si Q0 = C, no hay
     migración.

## 2. ¿Qué pasa al aprobar una versión nueva?

❓**Q2 (producto):** cuando se aprueba la v5 y la vigente es la v4:

- **A2.1 (propuesta):** la vigente **sigue** a la última aprobada mientras
  nadie la haya fijado con un rollback. Al aprobar, si
  `active_version_id IS NULL` o `= latest_approved_version_id` anterior, pasa
  a la nueva, en la misma transacción de la aprobación, con audit propio.
  Si un rollback la dejó en una versión vieja, **no** se mueve sola: volver a
  la nueva es otro cambio con cuatro ojos.
- **A2.2:** la vigente nunca se mueve sola; toda versión aprobada requiere un
  cambio explícito para quedar vigente. Más control, más fricción.

A2.1 toca `platform-approval` (aprobado y estable): el cambio es agregar el
avance del puntero dentro de la misma transacción, sin cambiar respuestas ni
códigos existentes. Lo declaro para que se juzgue.

## 3. Operación con cuatro ojos

Cuatro ojos hoy es "quien envió no aprueba" (§18, `FOUR_EYES_VIOLATION`, app +
trigger `trust_four_eyes`), por contrato (`four_eyes_required`). Para un
rollback no hay "envío": la regla equivalente es **quien pide no confirma**.

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
   - `expectedActiveVersionId` = vigente actual, si no 409
     `ACTIVE_VERSION_CONFLICT` con `details.activeVersionId` (concurrencia
     optimista, §48.3).
   - Ya es la vigente → 409 `ACTIVE_VERSION_UNCHANGED`. Ya hay un PENDING →
     409 `ACTIVE_VERSION_CHANGE_PENDING` con su id.
   - 201 con el pedido. Audit `ACTIVE_VERSION_CHANGE_REQUESTED`.
2. **Confirmar** — `POST /api/v1/active-version-changes/:id/confirm
   { versionHash }`. CSRF + `Idempotency-Key` obligatoria (§3.6).
   - Roles: INTERNAL_APPROVER · ADMIN (**Q4 acordada:** EXTERNAL_APPROVER no
     confirma cambios operativos internos en esta etapa).
   - Con `four_eyes_required`: `decided_by ≠ requested_by` → si no, 403
     `FOUR_EYES_VIOLATION`; segunda barrera en trigger. Sin cuatro ojos en el
     contrato: el mismo usuario puede confirmar, y el audit lo dice.
   - Relee todo con la campaña bloqueada: pedido `PENDING` y no vencido, la
     vigente sigue siendo `from_version_id` (si no, 409
     `ACTIVE_VERSION_CONFLICT` y el pedido queda `CANCELLED`, **persistido**:
     ver §3.7), destino sigue APPROVED, hash coincide.
   - Mueve `active_version_id`, marca `CONFIRMED`, audit
     `ACTIVE_VERSION_CHANGED` con `beforeHash`/`afterHash` = hash de la
     versión anterior/nueva y metadata `{ campaignId, fromVersionId,
     toVersionId, requestId, requestedBy, reason }`.
3. **Cancelar** — `POST /api/v1/active-version-changes/:id/cancel`: quien pidió
   o ADMIN. CSRF + `Idempotency-Key` obligatoria (§3.6). Audit
   `ACTIVE_VERSION_CHANGE_CANCELLED`.
4. **Vencimiento** — **Q5 acordada:** un PENDING vence a las 24 h
   (`ACTIVE_VERSION_CHANGE_TTL_MINUTES`), medido con `now()` de PostgreSQL
   (`requested_at` también lo escribe la base), nunca con el reloj del host.
   Vencimiento **perezoso**: se evalúa al confirmar, cancelar o pedir otro (sin
   job); el que vence pasa a `EXPIRED` con audit, persistido aunque la
   respuesta sea 409 (§3.7).
5. **Lectura** — `GET /campaigns/:id` agrega `activeVersion {id,
   versionNumber, versionHash}` y `pendingActiveVersionChange` (o `null`).
   `GET /campaigns/:id/active-version-changes` (historial paginado, keyset
   como BL-31).

6. **Idempotencia de las tres mutaciones** (hallazgo 3a de la ronda 1). Pedir,
   confirmar y cancelar usan `withIdempotency` (`platform-db`, el mismo de
   approve/reject):
   - operación distinta por ruta (`active-version-change.request`,
     `.confirm`, `.cancel`) y fingerprint = `SHA256(JCS({ operation,
     payload }))` con el id de la ruta y el cuerpo `.strict()` (para confirmar:
     `{ changeId, versionHash }`; para cancelar: `{ changeId }`);
   - misma key + mismo pedido → **replay** de la respuesta guardada (200 con
     `idempotent-replayed: true`), aunque el estado ya haya cambiado: una
     confirmación aplicada cuya respuesta se perdió devuelve el mismo
     resultado, no un 409 de transición inválida;
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
`ACTIVE_VERSION_CHANGE_CANCELLED`, `ACTIVE_VERSION_CHANGE_EXPIRED` y, si se
elige A2.1, `ACTIVE_VERSION_FOLLOWED_APPROVAL`. Todas en la misma transacción
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
2. Cuatro ojos: A pide y A confirma con `four_eyes_required` → 403, nada
   cambia; con el trigger apagado en la app (mutación) la base igual lo
   rechaza. Sin cuatro ojos en el contrato → permitido y auditado.
3. Destino inválido: SUBMITTED, REJECTED, de otra campaña (404, sin revelar),
   hash equivocado (409), ya vigente (409).
4. Concurrencia: dos pedidos simultáneos → uno 201, otro 409 PENDING; dos
   confirmaciones simultáneas → una gana; vigente cambiada entre pedir y
   confirmar → 409 y el pedido queda CANCELLED.
5. Vencimiento: pedido vencido no se confirma (409) y queda EXPIRED con audit.
6. Segunda barrera en la base: UPDATE directo a una versión no aprobada o de
   otra campaña → error de PostgreSQL.
7. Q2 según lo acordado (A2.1: aprobar v3 con vigente = última → sigue a v3;
   con vigente fijada en v1 → no se mueve).
8. Idempotencia de pedir, confirmar y cancelar: misma key + mismo pedido →
   200 replay sin segundo efecto; otro pedido → 409 `IDEMPOTENCY_KEY_REUSED`.
   **Confirmación aplicada con respuesta perdida:** el retry con la misma key
   devuelve el mismo cuerpo de éxito (no 409), la vigente no cambia de nuevo y
   hay un solo `ACTIVE_VERSION_CHANGED`.
9. Inmutabilidad: ShowVersions, manifiestos, Approvals y blobs idénticos antes
   y después de un rollback (foto completa, como BL-08).
10. Mutaciones nuevas `f3a:` para cada regla (cuatro ojos app y base,
    hash, campaña, estado APPROVED, concurrencia, vencimiento, audit).
11. Migración 0004 up/down/up limpia; bootstrap, M2C 14/14 y el resto de los
    gates sin regresión.
12. **Backfill con datos poblados:** campañas con v2 aprobada (vigente = v2),
    con v1 y v2 aprobadas y v3 SUBMITTED (vigente = v2), y sin aprobaciones
    (vigente `null`); down con datos (sin error, sin perder versiones ni
    aprobaciones) y up de nuevo con el mismo resultado.
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

## 7. Preguntas a acordar (resumen)

| # | Pregunta | Propuesta de Claude | Quién decide |
|---|---|---|---|
| # | Pregunta | Estado |
|---|---|---|
| Q0 | ¿Puntero "vigente" ahora (A) o esperar a Deploy (C)? | **pendiente de Fer** ([#52](https://github.com/fermalenoski86/dev/issues/52)); propuesta A |
| Q1 | ¿Función `SECURITY DEFINER` o UPDATE + trigger? | **acordada:** función endurecida (§1.4) |
| Q2 | ¿La vigente sigue a la última aprobada (A2.1) o nunca sola (A2.2)? | **pendiente de Fer** (#52); propuesta A2.1 |
| Q3 | ¿INTERNAL_APPROVER también pide? | **acordada:** no; pide OPERATOR/ADMIN |
| Q4 | ¿EXTERNAL_APPROVER confirma? | **acordada:** no en esta etapa |
| Q5 | Vencimiento del pedido | **acordada:** 24 h, perezoso, reloj de la base (§3.4, §3.7) |
| Q6 | ¿UI en el mismo cambio? | **acordada:** separada, con issue trazable |

Cuando Fer responda #52 se registra la decisión acá (con link) y se vuelve a
pedir auditoría. Recién con el brief aprobado se implementa en `fase/f3a` desde
`main`, con los gates de `AGENTS.md`, reporte `docs/reviews/F3A.md` y salida
real.
