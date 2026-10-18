# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude — #88 (PoC P-06 PR 1, `Riesgo: alto`): [`AUDIT: CAMBIOS` 6245911091](https://github.com/fermalenoski86/dev/pull/88#issuecomment-6245911091) sobre `f097a29` (1 × P2: política ejecutada no ligada al main evaluado). Corregido en `98f917f` (una ronda, un push): revisión en ejecución en la tupla, FAIL si ≠ main evaluado; 88/88 focal (6 fallan con `f097a29`), `pnpm verify` 1034+1 omitido. CI `gates` run 39101007564 sobre `98f917f` en curso. Acción exacta (Claude, próximo turno): con 7/7 + `riesgo`/`paralelo` verdes, pedir re-auditoría focalizada `f097a29..98f917f` en #88 y pasar la pelota a ChatGPT con `En auditoría: #88 @ 98f917f…`.
**En auditoría:** #88 @ f097a2943dabcb2355b60c705fa387f68af11fb2
**Fase:** PoC P-06 PR 1 (#88; HEAD `98f917f`, corrección del P2 esperando CI). #73 (kit McDonald's) sigue bajo lock de la sesión Claude+Fer.
**Estado:** P-03 mergeado en `main@db31db9` (#82, `AUDIT: APROBADO` [6223642598](https://github.com/fermalenoski86/dev/pull/82#issuecomment-6223642598) sobre `8a5a39d`). #83 cerrado. Entregable P-03 en `entregables.mjs` + `PROGRESO.md` (`8d5dd70`). P-01…P-05 completos.

## PoC P-06 — qué entra (brief + #54, decisión 2026-10-12 18:15)
- `## Code Review Rules — TRUST` (texto de ChatGPT) + salida estructurada que el check parsea.
- `delegated-audit-gate`: identidad por `user.id` de la App allowlisted en código de `main`, review real con `commit_id == head.sha`, parser estricto, elegibilidad por `risk.mjs` (P-03, alto ante la duda), gates verdes del SHA. **Report-only**: nunca habilita merge.
- Después, PoC-1 de la Action de Claude en solo lectura (token ya cargado). Matriz de 13 casos del brief; latencias medidas.
- Política vigente: correcciones consolidadas, re-auditoría focalizada, Codex sin revisión por push si Fer cambió el disparador.
## Después de P-03
- PoC P-06 según `docs/briefs/P06_BRIDGE_POC.md` (firma delegada en report-only, PoC-1 de la Action en solo lectura).
- CS-0 (#74): mergeado en `main@3b59b10`.

## Aviso
- `e2e-m2c` intermitente (`experience.spec.ts:14`) → #77, causa no determinada; sin reintentos extra.
- `e2e-platform` `a11y.spec.ts:48` (500 en `POST /assets`, 1 vez en `1d74859`) → #84, causa no determinada.
- `e2e-m2c` murió en el setup (`npm i -g pnpm`, exit 139) en `157a7f7` attempt 1 → #85 (`flaky`): intermitente (pasó en attempt 2), causa raíz no determinada.
- `mutations` cortado por plazo (exit 124) en `9a7170b` attempt 1, verde en attempt 2 (48 min vs plazo 56); se repitió en `6c96f82` (exit 124 a 3388 s, verde en attempt 2) → #86 (`flaky`): intermitente, causa raíz no determinada; no se toca el plazo.
- `riesgo` rojo en el run del PR sobre `0af602b` (22:38): caducado a propósito porque main avanzó (handoff) durante la evaluación; el run de push a main lo re-publicó verde. No es intermitente.
- `pnpm verify` local: 1 test falló en 1 de 5 corridas sobre `de214f9` (no capturado cuál) → #87 (`flaky`): intermitente, causa raíz no determinada.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| PoC P-06 | #54 / PR #88 | `AUDIT: CAMBIOS` @ f097a29 corregido en `98f917f`; CI run 39101007564 en curso |
| Kit McDonald's | #73 | lock sesión Claude+Fer; entrega vie 16/10 |
| CS-0 Creative Studio | #59 | brief mergeado (#74 → 3b59b10) |
| E2E intermitente :17 | #26 / #77 | causa no determinada |

## Pendiente de Fer
- Merges aprobados: el control de permisos de la sesión automática rechaza "merge sin revisión"; los hace la sesión con Fer.
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- Unificar publicadores de `paralelo`/riesgo: diseño aceptado, NO implementado (brief/ADR antes, sin desplazar P-06).
- `main`: required checks + rama al día después de adaptar escritores directos.

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
