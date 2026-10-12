# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — corregir **P-05** en PR #69 (issue AUDIT #70).
**En auditoría:** #69 @ 7cb661a9f7ab4df2b0b0d395a5a121a1c2cc3a8f
**Fase:** P-05 activa; después P-04 → P-03 → PoC P-06 (orden confirmado por Fer).
**Estado:** `AUDIT: CAMBIOS` sobre `7cb661a`: [comentario](https://github.com/fermalenoski86/dev/pull/69#issuecomment-6134269372). CI exacta [38316748544](https://github.com/fermalenoski86/dev/actions/runs/38316748544) 7/7 verde, pero queda un P1 de origen no confiable del script.

## Hallazgo bloqueante (ronda 30)
- **[P1] Política directa ejecutada desde base no auditada:** `paralelo.yml` carga desde `main`, pero hace checkout de la base actual y ejecuta su `scripts/collab/paralelo.sh`. Si la base es una rama de fase, puede alterar solo el script, conservar el YAML idéntico y obtener `paralelo=success` en un PR `audit/*`.
- Reproducción: en una rama de fase, dejar `paralelo.yml` igual a `main`, cambiar `paralelo.sh` a `exit 0` y abrir/sincronizar un PR hacia esa fase; el guard de YAML pasa y el paso directo ejecuta la copia debilitada.
- Corrección: ejecutar el chequeo directo siempre desde un worktree de `origin/main`; número/HEAD/base son solo datos. Comparar `workflow_sha` con el workflow vigente de `main`, usar `persist-credentials: false` donde corresponda y agregar prueba adversarial.
- Fundamento primario: GitHub documenta que `pull_request_target` es privilegiado y seguro por defecto porque solo ejecuta código de la rama predeterminada; ejecutar otra revisión rompe esa propiedad.

## Verificación independiente de `7cb661a`
- CI: 7/7 success (`verify-build`, `postgres`, `media`, `compose-smoke`, `e2e-m2c`, `e2e-platform`, `mutations`).
- Local: lint 0 errores (12 warnings), typecheck OK, 828/828 tests ejecutados OK (1 contrato S3 omitido local), build de las 3 apps OK.
- Focales: `paralelo.test.sh` 133/133 y `handoff.test.sh` 48/48, también con `LC_ALL=C`; `bash -n`, `node --check` y `git diff --check` OK.
- Los gates verdes no cubren la prueba adversarial anterior; no aprobar ni mergear todavía.

## Próximo paso
- Claude: corregir el P1 en la misma rama/PR, actualizar `P05.md`/salida/pruebas y pasar la pelota a ChatGPT con el nuevo SHA exacto y CI exacta.
- ChatGPT: reauditar el nuevo HEAD, en especial que ningún código de una base distinta de `main` se ejecute con `checks: write`.
- Al aprobar: squash-merge #69, cerrar #70, `En auditoría: ninguno`, registrar entregable P-05 y regenerar progreso; después P-04 → P-03 → PoC P-06.

## Reglas mientras corrige Claude
- P-05 sigue activa; `En auditoría` conserva #69 hasta que el PR esté mergeado en `main`.
- Claude puede avanzar el HEAD de #69; R3/R4 siguen protegiendo laterales; ningún PR toca `HANDOFF.md`.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-05 trabajo paralelo controlado | PR #69 / #70 | cambios P1 solicitados sobre `7cb661a` |
| P-04 → P-03 | #53 | siguientes, en serie |
| Agent Bridge (P-06) | #54 | PoC después de P-03 |
| CS-0 Creative Studio | #59 | autorizado; sigue en roadmap |
| E2E intermitente :17 | #26 | sin reproducción estable |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER.
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- `main`: required checks + rama al día después de adaptar escritores directos.
- PoC P-06: entorno Codex y `CLAUDE_CODE_OAUTH_TOKEN` (ver brief).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
