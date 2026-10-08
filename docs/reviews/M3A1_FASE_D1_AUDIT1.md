# M3A.1 Fase D1 — respuesta a AUDIT 1 (CAMBIOS)

Commit auditado: `37f647157ff50d843c8f6ef01f9b4bc4b4d87dbc`.
Salida real de gates: `M3A1_FASE_D1_AUDIT1_SALIDA.txt`.

## P1 — `allowed_surfaces` sin lock hasta el commit en PUT draft y submit

**Corregido.** Reproducido primero: con el código auditado, las cuatro
regresiones nuevas fallan (el PUT/submit no espera al recorte sin confirmar, y
el recorte no espera al PUT/submit en curso). Con la corrección pasan
(5 corridas seguidas, 34/34 en los dos archivos).

Cambio (mínimo):

- `CampaignService.putDraft`: la campaña se lee sola y el contrato aparte con
  `SELECT allowed_surfaces … FOR SHARE`, retenido hasta el commit.
- `submitCampaign`: la lectura del contrato pasa a `FOR SHARE` (la campaña ya
  estaba en `FOR UPDATE` antes).
- Creación ya usaba `FOR SHARE`; `PATCH /contracts/:id` ya tomaba la fila con
  `FOR UPDATE`. Share vs. update se excluyen → serialización.

Orden de locks (sin deadlock nuevo): en todos los caminos es
**campaña → contrato → `pg_advisory_xact_lock` del audit**. Revisados los que
toman el contrato: `updateContract` y `setFourEyesRequired` (contrato → audit,
nunca campaña), `createCampaign` (contrato → insert de campaña nueva, sin lock
sobre campañas existentes), `putDraft` (contrato → fila del draft → audit),
`submitCampaign` y decisiones (campaña → contrato/sin lock → audit). Ningún
camino toma contrato y después una campaña existente.

### Regresiones determinísticas (sin sleeps)

Helpers nuevos en `@trust/platform-db/testing` (`concurrency-testing.ts`):
`retenerTransaccion` (deja una transacción abierta hasta que el test la suelta)
y `esperarBloqueados` (espera hasta que `pg_stat_activity` muestre un backend
de la base esperando un lock de fila o advisory; falla a los 5 s).

| Test | Orden forzado | Resultado admitido verificado |
|---|---|---|
| campaigns: recorte sin confirmar vs PUT | T2 `UPDATE contracts` abierta → PUT | el PUT **espera la fila**; tras el commit de T2 → 422 `SURFACE_NOT_CONTRACTED`, revisión sigue en 1 |
| campaigns: PUT en curso vs PATCH | lock del audit retenido pausa al PUT ya validado → PATCH HTTP | el PATCH **espera la fila** (no el audit); al soltar: PUT 200, PATCH 200, audit `DRAFT_UPDATED` antes que `CONTRACT_UPDATED`; el PUT siguiente → 422 |
| submit: recorte sin confirmar vs submit | T2 `UPDATE contracts` abierta → submit | el submit **espera la fila**; tras el commit → 422 `SURFACE_NOT_CONTRACTED`, 0 versiones |
| submit: submit en curso vs recorte | lock del audit retenido pausa al submit ya validado → recorte (`FOR UPDATE` + `UPDATE`, mismo SQL que el PATCH) | el recorte **espera la fila**; al soltar: submit 201, 1 versión, contrato recortado |

Que el bloqueado espere la **fila** (`transactionid`/`tuple`) y no el
advisory del audit es lo que distingue el código corregido del auditado: sin
`FOR SHARE`, el recorte toma la fila de inmediato y solo esperaría el audit.

### Mutaciones

- `d1: PUT sin FOR SHARE del contrato (AUDIT D1 P1)` — ATRAPADA.
- `d1: submit sin FOR SHARE del contrato (AUDIT D1 P1)` — ATRAPADA.
- `d1: §6 sin chequeo en PUT` ajustada al código nuevo (la línea cambió de
  `cp.` a `ct.` y el texto viejo coincidía con el de creación).

Total: 200 reglas.

## Docs

`docs/platform/CAMPAIGNS.md` §6: garantía bajo concurrencia y orden de locks.

## BL-21

Tomado: queda para el backlog operativo después de D1/D2, con la métrica
sugerida (tiempo medio SUBMITTED → decisión; pendientes visibles sin abrir el
detalle). No se mezcla con esta corrección.

## No ejecutado localmente

E2E M2C (sin Chrome con H.264 en este entorno): lo cubre el job `e2e-m2c` de CI.
S3/MinIO: fuera del cambio.
