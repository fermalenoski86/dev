# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador). **#98 mergeado** en `main@dbd7846` (`AUDIT: APROBADO` [6354030555](https://github.com/fermalenoski86/dev/pull/98#issuecomment-6354030555) sobre `5b7ad4f`). Cierre en `2b52693`: manifiesto P-06-PR3 + PROGRESO, DECISIONES (opción B y adaptador A), BACKLOG aceptado. **Próximo turno de Claude:** re-correr la matriz P-06 sobre la CI nueva. Casos 1–3 **resembrados en rutas de riesgo bajo** (sin reciclar #91/#92), después 4, 5/6 y 9–13, con latencias. #90–#95 se cierran sin merge cuando estén los nuevos. **Regla nueva (opción B):** con un PR en auditoría, el pase al auditor va en el PR y el HANDOFF se escribe una vez después del veredicto.
**En auditoría:** ninguno
**Fase:** PoC P-06, matriz real sobre el adaptador A (preauditoría report-only, solo riesgo bajo). Medido sobre la CI vieja: 2/3 detectan P1/P2 (~50–81 s); 7/8 elegibilidad ✅. #73 (kit McDonald's) sigue bajo lock de la sesión Claude+Fer.
**Estado:** PR 1 (#88) en `main@c403b6b`; PR 2 (#89) mergeado en `main@10cd5d0` (`AUDIT: APROBADO` [6254481441](https://github.com/fermalenoski86/dev/pull/89#issuecomment-6254481441) sobre `16a687f`; merge en sesión con Fer). Entregable P-06-PR2 en manifiesto + `PROGRESO.md` (`6867d21`). Gate y Action en report-only / solo lectura.

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
- `e2e-platform` 500 en `POST /assets` (`a11y.spec.ts:48` en `1d74859`; `active-version.spec.ts:59` en `5b4acf4`, verde al re-run) → #84, causa no determinada.
- `e2e-m2c` murió en el setup (`npm i -g pnpm`, exit 139) en `157a7f7` attempt 1 → #85 (`flaky`): intermitente (pasó en attempt 2), causa raíz no determinada.
- `mutations` cortado por plazo (exit 124) en `9a7170b` attempt 1, verde en attempt 2 (48 min vs plazo 56); se repitió en `6c96f82` (exit 124 a 3388 s, verde en attempt 2) → #86 (`flaky`): intermitente, causa raíz no determinada; no se toca el plazo.
- `riesgo` rojo en el run del PR sobre `0af602b` (22:38): caducado a propósito porque main avanzó (handoff) durante la evaluación; el run de push a main lo re-publicó verde. No es intermitente.
- Job `riesgo` rojo en los eventos de #98: lo arrastra el rechazo de #95 con el `riesgo.yml` viejo de main (hallazgo 3, se corrige con #98). En ese log aparece también `unexpected end of JSON input` tras el OK de #91 (`rc=0`): código de main, sin investigar (backlog).
- `verify-build`/`pnpm verify`: 1 test intermitente (`preview-session.test.ts:148`, RESTART esperado 0/obtenido 2; `f097a29` attempt 1, verde en attempt 2) → #87 (`flaky`): causa raíz no determinada.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| PoC P-06 matriz | #54 / #90–#95 | #98 en main; re-correr con casos de riesgo bajo; #90–#95 no se mergean |
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




