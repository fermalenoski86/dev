# M3A.1 — Fase C3: submit server-side sobre el Draft persistido

**Estado:** entregado para auditoría. Cierra Fase C (C1 aprobada y mergeada,
C2 aprobada). Builder sync, Campaign CRUD y Fase D **no iniciados**. B1–B4,
C1 y C2 sin cambios de arquitectura; M2C.2 sin tocar.

**Rama:** `fase/m3a1-c3`, **apilada sobre `fase/m3a1-c2`** (`cf7f23e`, C2
aprobada): el merge del PR #8 lo denegó el clasificador de permisos de este
entorno ("merge without review"), igual que en B3. En cuanto #8 entre a
`main`, este PR se reapunta a `main` sin cambios de contenido.
Brief: `docs/briefs/M3A1_FASE_C.md` §C3 + decisión 1. ADR-059. Detalle:
`docs/platform/APPROVAL.md` §Submit.

## Resultados (ejecución real, 2026-10-07, este entorno)

Node 22.22.0 · pnpm 12.5.1 · PostgreSQL 16 · ffmpeg 6.1.1. Salida completa en
`M3A1_FASE_C3_SALIDA.txt`.

| Gate | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK |
| `pnpm verify` | **637 passed + 1 skipped**, lint 0 errores |
| `pnpm build` | OK |
| PostgreSQL 16 | **188 passed + 6 skipped** (nuevos: 14 de submit por HTTP) |
| `bootstrap-smoke.sh` | 6 passed |
| media | 63 passed |
| mutaciones (186 reglas) | corrida completa: **186/186 atrapadas** (9 nuevas de C3) |
| E2E M2C (14) | **no corrido localmente** (sin Chrome con H.264); evidencia: job `e2e-m2c` del CI |

## Qué se entrega

1. **`submitCampaign`** (`packages/platform-approval/src/submit.ts`): campaña
   bloqueada, revisión citada, una revisión = un envío, `TakeoverDraftSchema`,
   ranuras → Assets READY de la superficie correcta, `validateDraft`
   (compilador + preflight del motor) contra `EL_TRUST`/`DEMO_SCENES`, hash del
   sobre, `createShowVersion` + `VERSION_SUBMITTED`, todo detrás de
   `withIdempotency`.
2. **Ruta** `POST /api/v1/campaigns/:id/submit { draftRevision }` (OPERATOR o
   ADMIN, CSRF, Idempotency-Key). Respuesta: la ShowVersion con el contrato de C2.
3. **Docs:** `APPROVAL.md` §Submit, `API.md`, ADR-059.

## Criterio de cierre C3, punto por punto

| Brief / master | Test (`apps/platform-api/src/submit.db.test.ts`) |
|---|---|
| §17 enviar exige preflight válido | "escena de cierre inexistente → 422 PREFLIGHT_FAILED…", "asset con aspecto equivocado… aunque el compilador sí arme el paquete" |
| §17 compila server-side | "compila y corre preflight server-side…": el hash es el que da recompilar el mismo draft con el mismo compilador |
| §17 crea ShowVersion y congela hash | mismo test: SUBMITTED, versión 1, manifiesto `[logicalRef, assetId, sha256]`, paquete en la base con `source` por sha256 |
| hash determinista, sin UUIDs (punto 8) | "mismo draft y mismos bytes en dos campañas → mismo hash, dos versiones" |
| §27 `VERSION_SUBMITTED` en la misma transacción | camino feliz (audit con `afterHash`) y "verifyChain OK al final" |
| §28 Idempotency-Key: un retry no crea dos versiones | "retry con la misma key → 200…; en paralelo tampoco duplica" |
| §48.3 la revisión protege concurrencia | "revisión vieja → 409 DRAFT_REVISION_MISMATCH…", "otro operador a la vez → una sola versión" |
| §48.15–16 edito la campaña, la aprobada NO cambia | "…editar el draft → nueva versión; la aprobada NO cambia" (aprobación real por HTTP de C2) |
| assets READY por SHA-256 | "asset REJECTED, inexistente o id que no es de la plataforma…", "asset VALIDATING… no entra", "asset de otra superficie…" |
| autorización | "INTERNAL_APPROVER no envía (403); sin CSRF 403; sin Idempotency-Key 400; revisión inválida 400" |

**Mutaciones C3 (9, todas atrapadas):** submit sin preflight, sin revisión
esperada, misma revisión dos veces, asset no READY entra, ranura sin chequeo de
superficie, retry duplicado (sin idempotencia), `source` por UUID (el hash
dependería de la base), submit sin audit, submit sin lock de campaña.

Defensa en profundidad: sacar el chequeo de rol del servicio no cambia nada
(la ruta ya exige OPERATOR/ADMIN con `requireActor`; la mutación global "rol
ignorado" de C1 cubre esa barrera), por eso esa mutación no está listada.

## Decisiones (para validar)

1. **Quién envía:** OPERATOR o ADMIN (los mismos roles que suben Assets).
   INTERNAL_APPROVER solo, no.
2. **`draftRevision` obligatoria en el cuerpo:** el cliente envía lo que vio;
   sin eso, dos operadores podrían enviar una revisión que no revisaron.
3. **Una revisión se envía una sola vez:** reenviar la misma revisión con otra
   key es 409; para un SUBMITTED nuevo hay que editar el draft (§17).
4. **Assets:** cualquier Asset READY de la superficie correcta, sin importar
   quién lo subió (en B4 la *lectura* es por creador; usarlo en un draft no lo
   expone). Si se quiere restringir a assets del contrato/campaña, es modelo
   nuevo → `decisión-producto`.
5. **`source` = `/assets/sha256/<sha256>.mp4`:** entra en el namespace
   controlado `/assets/` del Builder; Deploy (fuera de M3A.1) resuelve el blob
   por `show_version_assets`.
6. **Catálogo de escenas = `DEMO_SCENES`** del motor (el mismo que usa el
   Builder hoy). Cuando exista catálogo persistido, cambia el origen, no la regla.
7. **Advertencias del preflight no bloquean** (igual que en el Builder); su
   cantidad queda en el audit (`preflightWarnings`).

## No hecho a propósito

Campaign/Advertiser/Contract CRUD, `PUT /campaigns/:id/draft`, Builder sync,
UI de submit (todo Fase D). BL-14/15/16 (backlog).

## Propuestas de mejora (≤ 3)

- **BL-17 · Validar `contracts.allowed_surfaces` al enviar.** El contrato ya
  guarda las superficies contratadas (Fase A) pero nada lo aplica: hoy se puede
  enviar una campaña que usa la horizontal en un contrato que solo compró las
  torres. Propuesta: en el submit, las pantallas con `media.play` en el
  ShowPackage tienen que estar en `allowed_surfaces` → 422
  `SURFACE_NOT_CONTRACTED`. ~0,5 día. Criterio: test con contrato
  `['screen_a','screen_b']` y draft que reproduce la horizontal → 422, y una
  mutación. Es regla comercial: requiere OK de Fer o del auditor antes de
  implementarla (el brief C no la pide).
- **BL-18 · Vigencia del contrato al enviar.** `contracts.status` y
  `starts_at/ends_at` existen y no se miran. Propuesta: enviar solo con
  contrato `ACTIVE` o `DRAFT` y `ends_at` futuro → 409 `CONTRACT_NOT_ACTIVE`.
  Mismo esfuerzo y la misma condición: decisión de producto.
