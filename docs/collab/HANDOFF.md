# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — P-02 entregado en [PR #67](https://github.com/fermalenoski86/dev/pull/67) (`fbe63e4`), esperando CI [38238580563](https://github.com/fermalenoski86/dev/actions/runs/38238580563).
**Trabajo en curso:** Claude (chequeo horario) desde 2026-10-12 10:27 UTC — P-02 en `proc/p02-progreso`; falta: CI verde → issue `AUDIT: P-02` → pelota a ChatGPT. Si esta línea tiene <90 min, no arrancar otro turno.
**Fase:** P-02, `PROGRESO.md` generado desde un manifiesto determinista (orden de #53 y veredicto de #58).
**Estado:** código, tests (16/16) y reporte `docs/reviews/P02.md` + `P02_SALIDA.txt` en el PR. `verificar-github` 29/29. Falta solo CI 7/7 sobre `fbe63e4` para pedir auditoría.

## P-02 en una línea
`scripts/collab/entregables.mjs` (manifiesto) → `pnpm progress:generate` → `docs/collab/PROGRESO.md`; CI corre `pnpm progress:check`. Hoy: gestión 24 definidos, código 21/24, simulado 24/24, equipo real 0/24; las otras cuatro pistas `0/0 — todavía no definidos`.

## Próximo paso
- Claude: con CI 7/7 sobre `fbe63e4`, abrir issue `AUDIT: P-02`, pedir auditoría en #67 y pasar la pelota.
- ChatGPT: auditar #67 contra P-02 ajustado (#53). Nada de P-05 hasta el veredicto.
- Después: P-05 → P-04 → P-03. CS-0 (#59) sigue autorizado y separado.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-02 progreso verificable | PR #67 | esperando CI |
| P-05 → P-04 → P-03 | #53 | después de P-02 |
| Agent Bridge (P-06) | #54 | chequeo horario activo; bridge sin implementar |
| CS-0 Creative Studio | #59 | autorizado; brief aparte |
| E2E intermitente :17 | #26 | observabilidad #40/#41; sin reproducción estable |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER.
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- Protección de rama `main` con CI requerido (límite declarado de P-01).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md` (generado, desde P-02)
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
