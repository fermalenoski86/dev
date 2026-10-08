# M3A.1 — Fase D1: API de Campaign y Draft con concurrencia optimista

**Estado:** entregado para auditoría. D2 (repositorio) **no iniciado**. D3
bloqueado por el issue #15 (decisión de Fer). B, C y M2C.2 sin cambios de
arquitectura. **No se toca `apps/control`.**

**Rama:** `fase/m3a1-d1` desde `main@c845f35` (brief D aprobado y mergeado en #13).
Brief: `docs/briefs/M3A1_FASE_D.md` §D1 + las 7 decisiones del auditor. ADR-060.
Detalle técnico: `docs/platform/CAMPAIGNS.md`.

## Resultados (ejecución real, 2026-10-08, este entorno)

Node 22.22.0 · pnpm 12.5.1 · PostgreSQL 16 · ffmpeg 6.1.1. Salida completa en
`M3A1_FASE_D1_SALIDA.txt`.

| Gate | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK (paquete nuevo `@trust/platform-campaigns`, sin dependencias externas nuevas) |
| `pnpm verify` | **642 passed + 1 skipped**, lint 0 errores |
| `pnpm build` | OK |
| PostgreSQL 16 | **204 passed + 6 skipped** (nuevos: 15 de campaigns/draft por HTTP + 1 de §6 en submit) |
| `bootstrap-smoke.sh` | 6 passed |
| media | 63 passed |
| mutaciones (198 reglas) | corrida completa: **198/198 atrapadas** (12 nuevas de D1) |
| E2E M2C (14) | **no corrido localmente** (sin Chrome con H.264); evidencia: job `e2e-m2c` del CI |

## Qué se entrega

1. **`@trust/platform-campaigns`**: `CampaignService` (advertisers, contracts,
   campaigns, draft) y `screensUsedByDraft`/`screensOutsideContract` (§6).
2. **Rutas** (`campaign-routes.ts`): `POST/GET /advertisers`,
   `POST/GET /contracts`, `GET/PATCH /contracts/:id`, `POST/GET /campaigns`,
   `GET /campaigns/:id`, `GET/PUT /campaigns/:id/draft`.
3. **§6 en el submit** (`platform-approval/submit.ts`): el contrato vigente
   se lee dentro de la transacción del submit.
4. **Docs:** `CAMPAIGNS.md`, `API.md`, ADR-060.

## Criterio D1 y decisiones del auditor, punto por punto

| Requisito | Test |
|---|---|
| §8 `expectedRevision` en toda actualización, nunca last-write-wins | `campaigns.db.test.ts` "PUT con la revisión vigente…", "dos escrituras simultáneas…: exactamente una gana" |
| §9 conflicto → 409 `DRAFT_CONFLICT` {serverRevision, clientRevision, serverUpdatedAt}, sin pisar el servidor | "revisión vieja → 409 DRAFT_CONFLICT…" (también revisión del futuro) |
| §27 audit `DRAFT_UPDATED`, `CAMPAIGN_CREATED`, `CONTRACT_*`, `ADVERTISER_CREATED` | tests de cada recurso + "verifyChain OK" |
| §7/§32 draft de trabajo y última aprobada coexisten | "§32: GET muestra la última versión APROBADA y, aparte, el draft de trabajo" |
| Decisión 1 / §6: superficies server-side en PUT **y** submit, con regresión en ambos | "§6 en PUT; reducir las superficies del contrato no reescribe…", "§6: crear con un draft…", `submit.db.test.ts` "§6 (D1): el contrato vigente…" |
| Decisión 1: reducir superficies no reescribe drafts ni versiones | mismo test: el draft sigue en rev 2 después del PATCH; la escritura siguiente aplica la regla |
| Decisión 3: CRUD mínimo de Advertiser/Contract/Campaign | sección "advertisers y contracts" (4 tests) y "campaigns" (4 tests) |
| Decisión 4: sin Idempotency-Key en `PUT draft` | la ruta no la lee; `CAMPAIGNS.md` documenta el retry |
| Decisión 5: BL-18 fuera | no se mira vigencia ni estado del contrato al escribir |

**Mutaciones D1 (12, todas atrapadas):** last-write-wins (sin
`expectedRevision`), la revisión no avanza, draft sin validar, draft sin
audit, conflicto con `clientRevision` falso, draft de campaña archivada, §6
sin chequeo en PUT / al crear / en submit, contrato con pantallas
inexistentes, `black` no cuenta como uso, master no arrastra la horizontal.

Defensa en profundidad que hace sobrevivir a una mutación de un solo lado (no
listada): "solo ADMIN escribe contratos" está en la ruta (`requireActor`) y en
el servicio. Sacar uno lo frena el otro con el mismo 403. La barrera de la
ruta la cubre la mutación global "rol ignorado" de C1.

## Decisiones (para validar)

1. **"Usar" una pantalla = cualquier directiva que no sea `hold`**, también
   `black`: mandar a negro una pantalla no contratada es operar sobre ella.
   Asignar un asset a una ranura sin usarla en ningún moment no cuenta.
2. **Campaña nueva sin draft explícito:** `PRESET_EMPTY` con el nombre de la
   campaña (usa solo `hold` → no usa pantallas → siempre pasa §6).
3. **Lecturas para OPERATOR, INTERNAL_APPROVER y ADMIN** (como el scope
   interno de C1); EXTERNAL_APPROVER no entra.
4. **Contactos del anunciante** validados (`name`, `email?`, `phone?`, `role?`,
   máx. 20). El audit de `ADVERTISER_CREATED` no los guarda, ni el CUIT.
5. **`PATCH /contracts/:id` no toca `four_eyes_required`**: sigue en su ruta
   de C2 con `FOUR_EYES_DISABLED`.
6. **`bodyLimit` de 1 MiB** solo en `POST /campaigns` y `PUT draft` (el
   resto de la API sigue en 64 KiB).

## No hecho a propósito

D2 (repositorio), D3 (Builder; issue #15), UI, BL-18/19/20. Borrado de
advertisers/contracts/campaigns (no está en el master).

## Propuestas de mejora (≤ 3)

- **BL-21 · Listar campañas con el estado de su última versión.** Hoy
  `GET /campaigns` devuelve la última *aprobada*, pero no si hay una versión
  SUBMITTED esperando decisión. Para el operador es la pregunta más común
  ("¿qué está esperando aprobación?"). Propuesta: sumar
  `pendingVersion {id, versionNumber}` (la SUBMITTED más nueva sin Approval) a
  la vista, con una consulta y sin modelo nuevo. ~0,5 día. Criterio: test que
  envía, ve `pendingVersion`, aprueba y la ve pasar a `latestApprovedVersion`.
