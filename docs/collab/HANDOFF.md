# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — **P-04** diagnóstico de fallas (BACKLOG §P-04, ajustes de #53).
**En auditoría:** ninguno
**Fase:** P-05 cerrada; P-04 arranca; después P-03 → PoC P-06 (orden confirmado por Fer). #73 (kit McDonald's) lo lleva la sesión de Claude con Fer bajo lock: los turnos horarios no lo tocan.
**Estado:** P-05 cerrada del todo: `AUDIT: APROBADO` sobre `2fd28b9` ([#69](https://github.com/fermalenoski86/dev/pull/69#issuecomment-6135785390)), squash en `4fd1f03`, #70 cerrado, P-05 en `entregables.mjs` + `PROGRESO.md` regenerado (`835dd92`, `verificar-github` OK). PoC de `paralelo.yml` en `main`: corrió en los 3 push (4fd1f03, ce3bb09, 835dd92), re-evaluó #72 y #74 y publicó check `paralelo` OK sobre sus HEAD.

## P-04 · plan (próximo turno de Claude)
- Alcance (BACKLOG §P-04 + ajustes #53): (1) anotación por job con SHA, `ImageOS/ImageVersion`, versiones Node/pnpm/Chrome/ffmpeg/PostgreSQL y cola del error; (2) `test-results/` como artifact al fallar en todos los jobs; (3) clasificación obligatoria de fallas en el PR: regresión reproducible (2/2 = reproducibilidad, no causa raíz) · intermitente (issue `flaky`) · infraestructura · `causa no determinada (en investigación)`; (4) prohibido en `AGENTS.md`: `retries > 0`, subir timeouts, bajar umbrales o `skip` para pasar; ajustes solo por decisión y auditoría explícitas con prueba de que sigue detectando; (5) sanitizar logs/trazas/artifacts (cookies, tokens, env, datos comerciales).
- Toca `scripts/ci/run.sh`, `gates.yml`, `AGENTS.md`: riesgo alto → auditoría formal de ChatGPT. Rama propia desde `main`, un PR; Codex una vez con el PR consolidado (política de eficiencia 2026-10-12).
- Criterio: una falla provocada en cada job deja anotación con entorno y cola; `rg "retries:" playwright.config.ts` = 0; prueba de sanitización.

## Reglas
- Para P-04: Claude implementa en su rama/PR y ChatGPT audita el HEAD congelado antes del merge; `En auditoría` se anota al entregar.
- Codex: no por commit; agrupar correcciones y pedir con el PR consolidado; cada pedido de auditoría informa revisiones de Codex y rondas. Hoy Codex agotó cuota dos veces (dato para PoC P-06).

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-04 diagnóstico de fallas | BACKLOG §P-04 / #53 | arranca; sin PR aún |
| P-03 → PoC P-06 | #53 / #54 | siguientes, en serie |
| Kit McDonald's | #73 | lock sesión Claude+Fer (00:51 UTC); entrega vie 16/10 |
| CS-0 Creative Studio | #59 / PR #74 | brief en PR; paralelo OK |
| E2E intermitente :17 | #26 | observabilidad #40/#41; sin reproducción estable |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER (PR #72 abierto).
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- `main`: ruleset activo sin borrado/force-push; required checks (`paralelo` ya publica sobre el HEAD) + rama al día después de adaptar escritores directos.
- PoC P-06: entorno Codex y `CLAUDE_CODE_OAUTH_TOKEN` (ver brief).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
