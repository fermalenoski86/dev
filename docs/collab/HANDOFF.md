# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — P-03: corregido el P1 de `AUDIT: CAMBIOS` ([6197808364](https://github.com/fermalenoski86/dev/pull/82#issuecomment-6197808364)) en `c3a9d00`; esperar CI 7/7 de `gates.yml` y pedir re-auditoría.
**En auditoría:** #82 @ c3a9d00e5497d5ce5630eb65e9947420c6712c9e
**Fase:** P-03 (PR #82) con `AUDIT: CAMBIOS` atendido, CI en curso; después PoC P-06. #73 (kit McDonald's) sigue bajo lock de la sesión Claude+Fer: los turnos horarios no lo tocan.
**Estado:** P-04 mergeado en `main@3a8e4fc` (#75, `AUDIT: APROBADO` [6186511591](https://github.com/fermalenoski86/dev/pull/75#issuecomment-6186511591) sobre `8bd04c5`; merge autorizado por Fer). #76 cerrado. Entregable P-04 en `entregables.mjs` + `PROGRESO.md` (`8b9ed35`).

## P-03 — qué entra (BACKLOG §P-03 + #54 dictamen 2)
- `scripts/collab/risk.mjs`: riesgo `bajo|medio|alto` calculado por paths del diff real contra merge-base (renames y borrados incluidos); **alto por defecto si hay duda**; nunca se rebaja.
- Alto: migraciones DB, `platform-auth`, `platform-approval`, storage, procesos externos, CORS/CSRF, `apps/control` congelado, hardware, workflows/`scripts/ci`/`scripts/collab`/gates, `AGENTS.md`, el propio clasificador.
- CI compara el declarado en el PR con el calculado: si declara menos, falla. PR alto sin sección "Pruebas adversarias" → falla.
- `AGENTS.md`: mínimos de auditoría por nivel (todos los gates corren siempre). Criterio: clasifica bien los últimos 10 PRs mergeados (tabla en el PR).
- Política de eficiencia vigente: pre-revisión propia, Codex 1 inicial + 1 final, correcciones agrupadas.

## Después de P-03
- PoC P-06 según `docs/briefs/P06_BRIDGE_POC.md` (firma delegada en report-only, PoC-1 de la Action en solo lectura).
- CS-0 (#74): mergeado en `main@3b59b10`.

## Aviso
- `e2e-m2c` intermitente (`experience.spec.ts:14`) → #77, causa no determinada; sin reintentos extra.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-03 auditoría basada en riesgo | #53 / PR #82 / #83 | AUDIT: CAMBIOS (1 P1) corregido en `c3a9d00`; CI pendiente, luego re-auditoría |
| PoC P-06 | #54 | después de P-03 |
| Kit McDonald's | #73 | lock sesión Claude+Fer; entrega vie 16/10 |
| CS-0 Creative Studio | #59 | brief mergeado (#74 → 3b59b10) |
| E2E intermitente :17 | #26 / #77 | causa no determinada |

## Pendiente de Fer
- Merge desde turnos programados: el control de permisos de la sesión automática rechaza "merge sin revisión"; hoy lo hace la sesión con Fer.
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- `main`: required checks + rama al día después de adaptar escritores directos.

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
