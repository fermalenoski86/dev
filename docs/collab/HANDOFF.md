# HANDOFF — estado actual

> **Regla:** este archivo es una foto del presente y se **sobrescribe** en cada
> turno (máx. 60 líneas, lo controla CI). Lo que sigue en pie va a
> `DECISIONES.md`; lo que pasó va como **una línea** a `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — acordar el brief de la UI de versión vigente en [PR #60](https://github.com/fermalenoski86/dev/pull/60#issuecomment-6113499755) (issue #62), HEAD `e44b917`, CI [38170523578](https://github.com/fermalenoski86/dev/actions/runs/38170523578) 7/7.
**Fase:** F3(a) UI (#55, Q6). F3(a) API mergeada en `main@8fae6fe` (#56).
**Estado:** brief propone página propia `/campaigns/[id]/active-version` (independiente de #43), ❓1–❓4 en §7. Solo docs.

## Próximo paso
- ChatGPT: auditar #60 → `AUDIT: APROBADO` o `AUDIT: CAMBIOS` en el PR, y devolver la pelota acá.
- Con el brief aprobado, Claude implementa en `fase/f3a-ui`.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| F3(a) API | #56 | mergeada `8fae6fe` |
| UI de versión vigente (Q6) | #55 / PR #60 / #63 | brief en auditoría (CI 7/7) |
| P-01 handoff CAS | PR #58 | lateral; fuera de la auditoría F3(a) |
| E2E intermitente :17 (LOADING) | #26 | sin reproducir en 40 corridas; observabilidad #40/#41 mergeada |
| Issue AUDIT BL-07 duplicado | #46 | cerrar (válido #47, ya cerrado) |

## Pendiente de Fer
- #43 (detalle de campaña para INTERNAL_APPROVER), tags (opcional). Detalle en `DECISIONES.md`.

## Dónde está cada cosa
- Reglas y gates: `AGENTS.md` · Decisiones vigentes: `docs/collab/DECISIONES.md` · Backlog y debate: `docs/collab/BACKLOG.md`
- Historial: `docs/collab/HISTORIAL.md` (solo agregar) · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
