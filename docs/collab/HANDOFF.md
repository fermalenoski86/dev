# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — corregir **P-04** en PR #75 (issue #76): 3 hallazgos del `AUDIT: CAMBIOS`, en una sola ronda.
**En auditoría:** #75 @ e40c1156797cc84f66d60840da732e5269edb71c
**Fase:** P-04 en reauditoría (ronda 7); después P-03 → PoC P-06 (orden confirmado por Fer). #73 (kit McDonald's) sigue bajo lock de la sesión Claude+Fer: los turnos horarios no lo tocan.
**Estado:** `AUDIT: CAMBIOS` de ChatGPT sobre `e40c115` ([#75](https://github.com/fermalenoski86/dev/pull/75#issuecomment-6183575289)). El HEAD `e40c115` quedó por un push de Claude con la rama congelada (desvío reconocido en #76; `paralelo` exit 6). ChatGPT no pudo escribir `main` y autorizó este traspaso administrativo ([#76](https://github.com/fermalenoski86/dev/issues/76)). No mergear.

## Hallazgos a corregir (una sola ronda)
1. **[P1] `gates.yml`:** el setup (`pnpm install`, `apt-get`, `pg-up.sh`, Playwright) corre fuera del plazo de `plazo.sh`; si se cuelga, GitHub cancela y se pierde la evidencia. Watchdog/plazo que la preserve.
2. **[P2] `gates.yml`:** el fallback depende del checkout (`scripts/ci/entorno.sh` no existe si falla); fallback autocontenido sin secretos.
3. **[P2] `politica-fallas.sh`:** `retries\n: 2` evade la regla `retries=0`; test adversarial rojo antes y verde después.

## Aviso
- `e2e-m2c` intermitente (`experience.spec.ts:14`) → #77, causa no determinada; documentar el intento real, sin reintentos extra.

## Próximo paso
- Claude: corregir los 3 juntos, regresiones + 7 gates + `paralelo` verde sobre el SHA final, actualizar `En auditoría` a ese SHA y devolver la pelota. Sin Codex por commit.
- ChatGPT: reauditar ese SHA.

## Reglas
- Con la pelota en Claude puede avanzar el HEAD; al pedir reauditoría, actualizar `En auditoría` al SHA final y congelarlo.
- Codex: agrupar correcciones y no pedir revisiones por commit; registrar cantidad de revisiones/rondas (P-04: 8 revisiones, 1 pedida, 7 rondas).

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-04 diagnóstico de fallas | PR #75 / #76 | `AUDIT: CAMBIOS` sobre `e40c115`; corrige Claude |
| P-03 → PoC P-06 | #53 / #54 | siguientes, en serie |
| Kit McDonald's | #73 | lock sesión Claude+Fer; entrega vie 16/10 |
| CS-0 Creative Studio | #59 / PR #74 | brief en PR; paralelo condicionado al HANDOFF vigente |
| E2E intermitente :17 | #26 / #77 | #77: READY TO PRESENT en e2e-m2c (3 veces), causa no determinada |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER (PR #72 abierto).
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- `main`: required checks + rama al día después de adaptar escritores directos.
- PoC P-06: entorno Codex y `CLAUDE_CODE_OAUTH_TOKEN` (ver brief).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
