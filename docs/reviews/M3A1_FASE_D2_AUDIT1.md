# M3A.1 Fase D2 — respuesta a AUDIT 1 (CAMBIOS)

Commit auditado: `38c98e01796e4e449239ec475b79379382d06d96`.
Commit con la corrección: `8dc228f` (código); este reporte y su salida van en el commit siguiente (solo docs).
Salida real de gates: `M3A1_FASE_D2_AUDIT1_SALIDA.txt`. CI del commit con la
corrección: https://github.com/fermalenoski86/dev/actions/runs/37761119482

## P1 — `SyncingCampaignRepository.escribir` ignora `saveDraft() === false`

**Corregido.** Reproducido primero: con `syncing.ts` del commit auditado, las
tres regresiones unitarias nuevas fallan (3 failed | 17 passed); con la
corrección, 20/20.

Cambio (mínimo, solo `packages/builder-repository/src/syncing.ts`):

- `escribir` comprueba el booleano de `saveDraft` y lanza
  `RepositoryError(0, 'LOCAL_STORAGE_UNAVAILABLE', …)` **antes** de escribir
  la metadata de sync y antes de cualquier PUT (la corrección sugerida).
- `save` y `keepLocal` actualizan su estado en memoria (`draft`,
  `revision`, `pending`, `conflict`) **después** de guardar local. Sin esto,
  el `save` fallido dejaba `pending = true` en memoria y un `sync()`
  posterior habría subido igual el draft no guardado: el mismo defecto por
  otro camino.

### Regresiones

| Test | Verifica |
|---|---|
| unit "AUDIT D2 P1: si el draft no se guarda local → LOCAL_STORAGE_UNAVAILABLE, CERO PUT…" | la reproducción del auditor: storage que rechaza solo `trust.builder.draft.v1` y acepta la clave de sync; `save` online rechaza; **ningún PUT intentado** (ni uno que diera 409), servidor intacto, metadata intacta, `pending: false`, y `sync()` posterior → `null` sin PUT |
| unit "…sin red tampoco queda pendiente…" | mismo fallo offline: al volver la red, `sync()` no sube nada; con el storage sano, el siguiente `save` funciona |
| unit "…mantener local con el storage roto…" | `keepLocal` rechaza sin PUT y el conflicto sigue abierto |
| PG "AUDIT D2 P1: storage local rechaza el draft…" (API real) | la base queda en revisión 1 con el draft original y **cero `DRAFT_UPDATED`** |

### Mutaciones nuevas (2)

- `d2: draft local fallido se sube igual (AUDIT D2 P1)` — ignora el `false` de `saveDraft`.
- `d2: estado pendiente antes de guardar local (AUDIT D2 P1)` — vuelve al orden anterior en `save`.

La mutación existente "mantener local sin rebasar" se ajustó al nuevo texto
(`const base = this.conflict.serverRevision` → `this.revision`); sigue
siendo la misma regla.

## Gate PostgreSQL

El job `postgres` de la CI del commit auditado se canceló en la instalación.
Localmente, sobre el commit con la corrección: PostgreSQL **216 passed + 6
skipped** (incluye los 8 de `builder-repository.db.test.ts`) y bootstrap
6/6. La CI del commit nuevo (run 37761119482) corre el job completo.

## Resultados (ejecución real)

| Gate | Resultado |
|---|---|
| `pnpm verify` | 662 passed + 1 skipped, lint 0 errores (12 warnings preexistentes) |
| `pnpm build` | OK |
| PostgreSQL 16 | 216 passed + 6 skipped |
| `bootstrap-smoke.sh` | 6 passed |
| media | 63 passed |
| mutaciones | `--autoprueba` OK; corrida completa **211/211 atrapadas** (2 nuevas) |
| E2E M2C (14) | no ejecutado localmente (Chromium sin H.264); CI 37761119482 `e2e-m2c` verde |
| CI de `8dc228f` | run 37761119482: verify-build, postgres, media, e2e-m2c y mutations **en verde** |
