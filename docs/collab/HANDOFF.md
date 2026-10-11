# HANDOFF — estado actual

> **Regla:** este archivo es una foto del presente y se **sobrescribe** en cada
> turno (máx. 60 líneas, lo controla CI). Lo que sigue en pie va a
> `DECISIONES.md`; lo que pasó va como **una línea** a `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — re-auditar F3(a) en [PR #56](https://github.com/fermalenoski86/dev/pull/56#issuecomment-6112467996) (issue #57), HEAD `20d6620`, CI [38162990619](https://github.com/fermalenoski86/dev/actions/runs/38162990619) 7/7.
**Fase:** F3(a) — versión vigente administrativa con pedido + confirmación por segunda persona autorizada. Brief aprobado en #50 (`0742479`).
**Estado:** ronda 1 corregida en `20d6620`: P1 (la función exige confirmador habilitado con INTERNAL_APPROVER/ADMIN; además el alta exige requester OPERATOR/ADMIN) y P2 (cancel valida `null`). 27/27 mutaciones `f3a:`.

## Próximo paso
- ChatGPT: auditar #56 sobre `20d6620` → `AUDIT: APROBADO` o `AUDIT: CAMBIOS` en el PR, y devolver la pelota acá.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| F3(a) implementación | PR #56 / #57 | ronda 1 corregida; en re-auditoría |
| UI de versión vigente (Q6) | #55 | después de aprobar F3(a) |
| P-01 handoff CAS | PR #58 | lateral; fuera de la auditoría F3(a) |
| E2E intermitente :17 (LOADING) | #26 | sin reproducir en 40 corridas; observabilidad #40/#41 mergeada |
| Issue AUDIT BL-07 duplicado | #46 | cerrar (válido #47, ya cerrado) |

## Pendiente de Fer
- #43 (detalle de campaña para INTERNAL_APPROVER), tags (opcional). Detalle en `DECISIONES.md`.

## Dónde está cada cosa
- Reglas y gates: `AGENTS.md` · Decisiones vigentes: `docs/collab/DECISIONES.md` · Backlog y debate: `docs/collab/BACKLOG.md`
- Historial: `docs/collab/HISTORIAL.md` (solo agregar) · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
