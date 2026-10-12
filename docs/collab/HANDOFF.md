# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — auditar **P-02** en [PR #67](https://github.com/fermalenoski86/dev/pull/67), HEAD `ca7b6df`, CI [38238927771](https://github.com/fermalenoski86/dev/actions/runs/38238927771) 7/7. Issue [#68](https://github.com/fermalenoski86/dev/issues/68).
**Fase:** P-02, `PROGRESO.md` generado desde un manifiesto determinista (segundo de #53; después P-05 → P-04 → P-03).
**Estado:** entregado con autorrevisión A/B/C (`docs/reviews/P02.md`) y salida real (`P02_SALIDA.txt`). [Pedido de auditoría](https://github.com/fermalenoski86/dev/pull/67#issuecomment-6123538080).

## P-02 en una línea
`scripts/collab/entregables.mjs` (manifiesto: PR + SHA merge + SHA auditado + URL del AUDIT) → `pnpm progress:generate` → `docs/collab/PROGRESO.md`; CI corre `pnpm progress:check` (sin red). `verificar-github` (fuera de CI) 29/29. Hoy: gestión 24 definidos, código 21/24 (3 pre-GitHub sin AUDIT enlazable), simulado 24/24, equipo real 0/24; NovaStar/DMX/reloj/hardware `0/0 — todavía no definidos`.

## Evidencia P-02
- HEAD `ca7b6df01e51c33db3df8b912b7d1100ad526e03`; CI 7/7 al primer intento. Primer HEAD `fbe63e4` rojo en verify-build/postgres (DELIVERY.md sin el test nuevo), corregido en `fb48535`.
- Local: 16/16 tests nuevos; `pnpm verify` 827 passed + 1 skipped; `acceptance:check` OK; `diff --check` OK. No ejecutado localmente: build, PG, media, mutaciones, E2E, compose (sí en CI).
- Límites: `check` no consulta GitHub (ajuste #53); "equipo real" lo carga una persona; el validador bloquea tests/CI rotulados como real y responsables agentes.

## Próximo paso
- ChatGPT: `AUDIT: APROBADO` o `AUDIT: CAMBIOS` en #67.
- Claude: con APROBADO, squash a `main`, cerrar #68, agregar P-02 al manifiesto (`tipo: proceso`) y regenerar; luego P-05.
- CS-0 (#59) sigue autorizado y separado.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-02 progreso verificable | PR #67 / #68 | en auditoría |
| P-05 → P-04 → P-03 | #53 | después de P-02 |
| Agent Bridge (P-06) | #54 | chequeo horario activo; bridge sin implementar |
| CS-0 Creative Studio | #59 | autorizado; brief aparte |
| E2E intermitente :17 | #26 | observabilidad #40/#41; sin reproducción estable |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER.
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- Protección de rama `main` con CI requerido (límite declarado de P-01).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md` (generado, P-02)
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
