# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — reauditar **P-05** en PR #69 (issue AUDIT #70) sobre un único SHA.
**En auditoría:** #69 @ 7700da3ef8e415fbdb79bc3687eb441bac9744bf
**Fase:** P-05 activa; después P-04 → P-03 → PoC P-06 (orden confirmado por Fer, DECISIONES 2026-10-12).
**Estado:** HEAD `7700da3ef8e415fbdb79bc3687eb441bac9744bf` = `1b91080` (CI [38293408824](https://github.com/fermalenoski86/dev/actions/runs/38293408824) 7/7) + ronda 14 (P1 de Codex pedido a mano: cada evento re-evalúa todos los PR; solo `paralelo.yml`, docs y un caso estático). CI de `7700da3` en curso; se cita en #69 al terminar. No mergear.

## Qué cambió desde `49acd37` (rondas 6–13, todas respondidas en #69)
- `AUDIT: CAMBIOS` 1 (P2 auth): `GATES_RE` cubre todas las familias "alto" de P-03 + lo que CI ejecuta y las configs raíz; mapa de rutas en un solo lugar.
- `AUDIT: CAMBIOS` 2 sobre `0f73e0c` (P1 TOCTOU, P2 alias): `paralelo-reevaluar.sh` re-evalúa todos los PR abiertos cuando avanza la fase o cambia `main` y publica checks por API; `paralelo-deps.mjs` conserva alias por revisión.
- Codex (rondas 12–13): revisión actual de la base en re-runs; `vitest.workspace/projects`; veredicto publicado como check sobre el HEAD del PR; carril único serial + no publicar si `main` avanzó; `ls-tree -z`.
- Codex sin cuota automática desde 18:48 UTC; un `@codex review` manual sobre `1b91080` dejó un P1 (runs pendientes descartados) corregido en `7700da3`. El veredicto es del auditor.
- Local: `paralelo.test.sh` 111/111 (UTF-8 y C), `handoff.test.sh` 39/39, `bash -n`, `node --check`, `diff --check` OK. Detalle: `docs/reviews/P05.md` (rondas 1–13 + autorrevisión previa) y `P05_SALIDA.txt`.
- Límite declarado: `paralelo.yml` (`pull_request_target` + re-evaluación) se prueba de verdad solo en `main`; PoC controlada post-merge obligatoria (matriz de P-06).

## Próximo paso
- ChatGPT: `AUDIT: APROBADO` o `AUDIT: CAMBIOS` sobre `1b91080` (repetir el negativo adversarial de auth y el S1→S2; verificar CI completa). No tocar la rama.
- Claude (al volver la pelota): si APROBADO → squash, cerrar #70, P-05 al manifiesto (`proceso`) + `PROGRESO.md`, PoC controlada del workflow en `main`; luego P-04. Si CAMBIOS → corregir, único SHA, CI verde, reauditoría.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-05 trabajo paralelo controlado | PR #69 / #70 | reauditoría pedida sobre `1b91080` |
| P-04 → P-03 | #53 | siguientes, en serie (tocan CI/scripts: riesgo alto, no laterales) |
| Agent Bridge (P-06) | #54 | dictamen 2 AJUSTAR registrado; brief `docs/briefs/P06_BRIDGE_POC.md`; PoC después de P-03 |
| CS-0 Creative Studio | #59 | autorizado; brief aparte; sigue en roadmap |
| E2E intermitente :17 | #26 | observabilidad #40/#41; sin reproducción estable |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER.
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- `main`: ruleset `main-protegida` activo (sin borrado ni force-push). Required checks + rama al día: después de adaptar los escritores directos (HANDOFF/BACKLOG).
- P-06: environment de Codex (en curso), cuota de reviews de Codex (agotada hoy; decidir plan/créditos), `CLAUDE_CODE_OAUTH_TOKEN` para PoC-1.

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
