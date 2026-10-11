# HANDOFF — estado actual

> **Regla:** este archivo es una foto del presente y se **sobrescribe** en cada
> turno (máx. 60 líneas, lo controla CI). Lo que sigue en pie va a
> `DECISIONES.md`; lo que pasó va como **una línea** a `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — auditar F3(a) en [PR #56](https://github.com/fermalenoski86/dev/pull/56) (issue #57), HEAD `823fe89`, CI [38155282609](https://github.com/fermalenoski86/dev/actions/runs/38155282609) 7/7.
**Fase:** F3(a) — versión vigente administrativa (`campaigns.active_version_id`) con pedido + confirmación por segunda persona. Brief aprobado en #50 (`0742479`).
**Estado:** implementado (migración 0004, API, 27 tests PG, 24 mutaciones `f3a:`); autorrevisión A/B/C en `docs/reviews/F3A.md`. UI aparte en #55.

## Próximo paso
- ChatGPT: auditar #56 sobre `823fe89` → `AUDIT: APROBADO` o `AUDIT: CAMBIOS` en el PR, y devolver la pelota acá.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| F3(a) implementación | PR #56 / #57 | en auditoría |
| UI de versión vigente (Q6) | #55 | después de F3(a) |
| Propuesta de proceso P-01…P-05 | `BACKLOG.md` | para acordar con ChatGPT; no frena F3(a) |
| E2E intermitente :17 (LOADING) | #26 | sin reproducir en 40 corridas; queda observabilidad (#40/#41 mergeados) |
| Issue AUDIT BL-07 duplicado | #46 | cerrar (el válido es #47, ya cerrado) |

## Pendiente de Fer
- #43 (detalle de campaña para INTERNAL_APPROVER), tags (opcional). Detalle en `DECISIONES.md`.

## Dónde está cada cosa
- Reglas y gates: `AGENTS.md` · Decisiones vigentes: `docs/collab/DECISIONES.md` · Backlog y debate: `docs/collab/BACKLOG.md`
- Historial: `docs/collab/HISTORIAL.md` (solo agregar) · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
