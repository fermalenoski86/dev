# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — auditar **P-05** en PR #69 (issue AUDIT #70).
**En auditoría:** #69 @ 5fdc97b7017e7537dd70a334707747234d3cf1fe
**Fase:** P-05 (trabajo paralelo controlado) entregada; después P-04 → P-03.
**Estado:** PR [#69](https://github.com/fermalenoski86/dev/pull/69) rama `proc/p05-paralelo`, HEAD `5fdc97b7017e7537dd70a334707747234d3cf1fe`. CI [38264828177](https://github.com/fermalenoski86/dev/actions/runs/38264828177) **8/8** (7 de siempre + job `paralelo`), intento 1, HEAD exacto.

## Entrega P-05 (reporte `docs/reviews/P05.md`, salida `P05_SALIDA.txt`)
- `AGENTS.md` sección "Paralelo (P-05)" con los ajustes de #53: ningún PR toca `HANDOFF.md`; rama en auditoría congelada; lateral solo de backlog `aceptada`, riesgo bajo/medio; se pospone si comparte archivos/dependencias o toca gates; nunca merge sin AUDIT propio.
- `handoff.sh validar`: línea `**En auditoría:** #PR @ sha40` obligatoria con la pelota en ChatGPT; opcional (o `ninguno`) con la pelota en Claude. Esta es la primera que la lleva.
- `scripts/collab/paralelo.sh <PR> <HEAD> [base]` (solo lee, lee el HANDOFF de `origin/main`): exit 5 PR toca HANDOFF · 6 HEAD del auditado cambió · 7 lateral comparte archivos · 8 lateral toca gates/scripts de proceso · 1 uso/HANDOFF inconsistente.
- CI: job `paralelo` en cada `pull_request` (historia completa, veredicto como anotación vía `run.sh`); `verify-build` corre `paralelo.test.sh` (26) y `handoff.test.sh` (39).
- Local: handoff.test 39/39, paralelo.test 26/26 (UTF-8 y `LC_ALL=C`), `pnpm verify` 828 tests. No ejecutado localmente: build/PG/media/mutaciones/E2E/compose (no toca producto) → CI.
- Límites: chequeo, no candado (protección de rama pendiente de Fer); el job no se re-corre solo si la pelota cambia sin push; "lateral sin AUDIT" lo cubre `verificar-github` (P-02).

## Próximo paso
- ChatGPT: `AUDIT: APROBADO` o `AUDIT: CAMBIOS` en #69 (lista `[P0|P1|P2] archivo:línea — hallazgo — cómo reproducir`). No tocar `proc/p05-paralelo` (regla P-05, ya aplicada por el job).
- Claude (al volver la pelota): si APROBADO → squash, cerrar #70, agregar P-05 al manifiesto (`proceso`) y regenerar `PROGRESO.md`; luego P-04. Si CAMBIOS → corregir en la misma rama, responder por punto, CI verde, reauditoría.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-05 trabajo paralelo controlado | PR #69 / #70 | en auditoría sobre `5fdc97b` |
| P-04 → P-03 | #53 | siguientes, en ese orden |
| Agent Bridge (P-06) | #54 | chequeo horario activo; bridge sin implementar |
| CS-0 Creative Studio | #59 | autorizado; brief aparte |
| E2E intermitente :17 | #26 | observabilidad #40/#41; sin reproducción estable |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER.
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- Protección de rama `main` con CI requerido y rama al día (límite declarado de P-01 y P-05).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md` (generado, P-02)
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
