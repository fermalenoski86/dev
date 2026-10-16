# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude — #82 `AUDIT: APROBADO` [6223642598](https://github.com/fermalenoski86/dev/pull/82#issuecomment-6223642598) sobre `8a5a39d` (riesgo alto; P0/P1/P2: 0). PR listo: CI gates [38933549032](https://github.com/fermalenoski86/dev/actions/runs/38933549032) 7/7 verde, `paralelo` success, sin conflictos. **Acción exacta para Fer:** en la sesión con Fer, mergear #82 con HEAD `8a5a39d` (verificar que no cambió); ese turno pone `En auditoría: ninguno`, registra entregable/progreso P-03 y arranca PoC P-06 (#54). Los turnos programados no mergean.
**En auditoría:** #82 @ 8a5a39d09dd12c360a5d3f66f5f1bf894c433d15
**Fase:** P-03 (PR #82) aprobado sobre `8a5a39d`, esperando merge de la sesión con Fer; después PoC P-06 (report-only, Action en solo lectura; sin delegación ni merge automático). #73 (kit McDonald's) sigue bajo lock de la sesión Claude+Fer.
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
- `e2e-platform` `a11y.spec.ts:48` (500 en `POST /assets`, 1 vez en `1d74859`) → #84, causa no determinada.
- `e2e-m2c` murió en el setup (`npm i -g pnpm`, exit 139) en `157a7f7` attempt 1 → #85 (`flaky`): intermitente (pasó en attempt 2), causa raíz no determinada.
- `mutations` cortado por plazo (exit 124) en `9a7170b` attempt 1, verde en attempt 2 (48 min vs plazo 56); se repitió en `6c96f82` (exit 124 a 3388 s, verde en attempt 2) → #86 (`flaky`): intermitente, causa raíz no determinada; no se toca el plazo.
- `pnpm verify` local: 1 test falló en 1 de 5 corridas sobre `de214f9` (no capturado cuál) → #87 (`flaky`): intermitente, causa raíz no determinada.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-03 auditoría basada en riesgo | #53 / PR #82 / #83 | `AUDIT: APROBADO` sobre `8a5a39d`; falta merge (sesión con Fer) |
| PoC P-06 | #54 | después de P-03 |
| Kit McDonald's | #73 | lock sesión Claude+Fer; entrega vie 16/10 |
| CS-0 Creative Studio | #59 | brief mergeado (#74 → 3b59b10) |
| E2E intermitente :17 | #26 / #77 | causa no determinada |

## Pendiente de Fer
- **Merge de #82 @ `8a5a39d`** (aprobado). Merge desde turnos programados: el control de permisos de la sesión automática rechaza "merge sin revisión"; hoy lo hace la sesión con Fer.
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- Unificar publicadores de `paralelo`/riesgo: diseño aceptado, NO implementado (brief/ADR antes, sin desplazar P-06).
- `main`: required checks + rama al día después de adaptar escritores directos.

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
