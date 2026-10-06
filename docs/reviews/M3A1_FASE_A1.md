# M3A.1 — Integrity Gate A.1 · resultados reales

Fecha: 2026-10-06T19:15Z · node v22.22.2 · PostgreSQL 16.15

| # | Invariante | Cómo la garantiza la base | Tests |
|---|---|---|---|
| 1 | Versión + manifiesto sellados | trust_create_show_version() atómica; sin INSERT directo; trigger VERSION_SEALED (xmin = transacción actual) | 3er logicalRef tras commit; tras APPROVED; INSERT directo; atomicidad |
| 2A | current_draft de la misma campaña | FK compuesta (current_draft_id, id) | cruce A/B |
| 2B | latest_approved de la misma campaña y APPROVED | FK compuesta + trigger LATEST_NOT_APPROVED | ajena / sin aprobación / REJECTED / APPROVED |
| 2C | source_draft de la misma campaña | FK compuesta (source_draft_id, campaign_id) | cruce A/B |
| 2D | snapshot exacto de revisión | trigger VERSION_DRAFT_REVISION_MISMATCH (FOR SHARE) | revisión vieja rechazada; el draft sigue y la versión conserva 2 |
| 3 | Asset terminal inmutable + blob en el manifiesto | triggers ASSET_TRANSITION / ASSET_TERMINAL; show_version_assets.stored_object_id | 6 tests |
| 4 | version_hash no único global | índice normal | A v1 y B v1 con el mismo hash |
| 5 | Fingerprint canónico | SHA256(JCS({operation, payload})) | orden de claves |
| 6 | Vencimiento de keys | recuperación transaccional con FOR UPDATE + purge | vigente/409/vencida/carrera |
| 7 | Bootstrap real | psql + format(%L) + \\gexec (el DO $$ no interpolaba variables) | smoke en cluster nuevo |

## pnpm verify

```
✖ 11 problems (0 errors, 11 warnings)
      Tests  548 passed (548)
```

## Plataforma contra PostgreSQL real

```
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: ShowVersion y su manifiesto quedan sellados > versión con 2 assets → commit → un tercer logicalRef es rechazado (runtime y dueño)
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: ShowVersion y su manifiesto quedan sellados > versión APROBADA → agregar un asset es rechazado
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: ShowVersion y su manifiesto quedan sellados > runtime no puede insertar versiones por fuera de la función atómica
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: ShowVersion y su manifiesto quedan sellados > atómica: si un asset del manifiesto no sirve, no queda ni versión ni manifiesto a medias
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: ShowVersion y su manifiesto quedan sellados > UPDATE, DELETE y TRUNCATE rechazados (runtime por permisos; dueño por trigger)
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: ShowVersion y su manifiesto quedan sellados > no existe columna de estado: el resultado vive solo en Approval
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: ShowVersion y su manifiesto quedan sellados > el número de versión lo asigna la base, correlativo por campaña
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: propiedad relacional entre campañas > A) current_draft_id no puede apuntar al draft de otra campaña
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: propiedad relacional entre campañas > B) latest_approved_version_id: de la misma campaña y con Approval APPROVED
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: propiedad relacional entre campañas > C) una versión no puede salir del draft de otra campaña
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: propiedad relacional entre campañas > D) la versión fotografía la revisión EXACTA del draft; después el draft sigue
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: Asset — transiciones permitidas y terminales inmutables > un asset nace UPLOADING
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: Asset — transiciones permitidas y terminales inmutables > no se saltea VALIDATING ni se vuelve atrás
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: Asset — transiciones permitidas y terminales inmutables > READY es terminal: ni contenido técnico ni estado cambian
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: Asset — transiciones permitidas y terminales inmutables > REJECTED es terminal: no vuelve a READY
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: Asset — transiciones permitidas y terminales inmutables > el manifiesto guarda el objeto físico: Deploy no depende del Asset
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: Asset — transiciones permitidas y terminales inmutables > el sha256 declarado tiene que ser el del objeto físico
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: mismo contenido en dos campañas = dos versiones con el mismo hash > Campaign A v1 → hash X y Campaign B v1 → hash X conviven
 ✓ packages/platform-db/src/schema.db.test.ts > aprobaciones — una decisión por versión, con evidencia o motivo > APPROVED exige evidencia; REJECTED exige motivo
 ✓ packages/platform-db/src/schema.db.test.ts > aprobaciones — una decisión por versión, con evidencia o motivo > una sola decisión final por versión
 ✓ packages/platform-db/src/schema.db.test.ts > aprobaciones — una decisión por versión, con evidencia o motivo > aprobación y evidencia son inmutables
 ✓ packages/platform-db/src/schema.db.test.ts > cuatro ojos POR CONTRATO > con cuatro ojos: quien envió no aprueba, otra persona sí
 ✓ packages/platform-db/src/schema.db.test.ts > cuatro ojos POR CONTRATO > la política afecta solo a su contrato
 ✓ packages/platform-db/src/schema.db.test.ts > cuatro ojos POR CONTRATO > cuatro ojos viene activado por defecto
 ✓ packages/platform-db/src/schema.db.test.ts > objetos físicos, drafts, identidad y permisos (Fase A, se mantienen) > stored_objects: content-addressed e inmutable
 ✓ packages/platform-db/src/schema.db.test.ts > objetos físicos, drafts, identidad y permisos (Fase A, se mantienen) > revisión monotónica de drafts
 ✓ packages/platform-db/src/schema.db.test.ts > objetos físicos, drafts, identidad y permisos (Fase A, se mantienen) > password Argon2id; email normalizado y único
 ✓ packages/platform-db/src/schema.db.test.ts > objetos físicos, drafts, identidad y permisos (Fase A, se mantienen) > aprobador externo solo atado a un contrato; internos nunca
 ✓ packages/platform-db/src/schema.db.test.ts > objetos físicos, drafts, identidad y permisos (Fase A, se mantienen) > runtime sin DDL ni TRUNCATE
 ✓ packages/platform-db/src/schema.db.test.ts > migraciones > up sobre base vacía, down y up de nuevo (smoke test reversible)
 ✓ packages/platform-db/src/schema.db.test.ts > migraciones > con datos: volver a migrar no toca nada
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: cadena de auditoría > append encadena desde el génesis y verifyChain la valida
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: cadena de auditoría > append fuera de una transacción se rechaza: el lock no serializaría nada
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: cadena de auditoría > CRITERIO: concurrencia real — dos conexiones a la vez, nunca el mismo predecesor
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: cadena de auditoría > la base rechaza un fork aunque el código lo intente
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: cadena de auditoría > runtime no puede UPDATE ni DELETE sobre audit_events (permisos)
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: cadena de auditoría > CRITERIO: una alteración directa (con control total de la base) se DETECTA
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: createShowVersion registra su auditoría en la MISMA transacción > versión creada ⇒ evento VERSION_SUBMITTED en la cadena, y la cadena sigue válida
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: createShowVersion registra su auditoría en la MISMA transacción > si el manifiesto falla, no queda versión NI evento de auditoría
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: idempotencia con fingerprint > misma key + mismo fingerprint: replay seguro, la operación corre UNA vez
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: idempotencia con fingerprint > misma key + distinto fingerprint: 409 IDEMPOTENCY_KEY_REUSED
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: idempotencia con fingerprint > la misma key para otra operación también es reuso
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: idempotencia con fingerprint > si la operación falla, la key NO queda tomada: el reintento corre
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: idempotencia con fingerprint > dos reintentos simultáneos: uno ejecuta, el otro hace replay
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: vencimiento de keys > vigente → replay; vigente + distinto fingerprint → 409
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: vencimiento de keys > vencida → la key se recupera y corre una operación NUEVA (aun con otro fingerprint)
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: vencimiento de keys > concurrencia sobre una key vencida: una sola ejecución
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: vencimiento de keys > la limpieza borra solo las vencidas
      Tests  48 passed | 6 skipped (54)
```

## Bootstrap real — scripts/bootstrap-smoke.sh (cluster NUEVO, psql)

```
== roles antes del bootstrap: 0
== bootstrap corrido dos veces (idempotente)
== roles después: trust_app,trust_owner
 ✓ packages/platform-db/src/bootstrap.smoke.db.test.ts (6 tests)
      Tests  6 passed (6)
```

## Pruebas de que los tests no son triviales (mutación manual, código restaurado)

- Sin el sellado por transacción en trust_version_asset_ready: fallan los 2 tests de sellado.
- Sin el lock en appendAuditEvent (Fase A): falla el test concurrente y la base frena con AUDIT_SEQ.

## Notas

- La migración 0001 se actualizó en lugar de agregar una 0002: nunca fue desplegada.
- Los 6 tests de bootstrap se omiten en la suite normal a propósito: solo corren desde el script, contra un cluster nuevo, para no validarlo por el camino JS.
- Fase B NO iniciada.
