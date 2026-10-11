# HANDOFF — estado actual

> **Regla:** este archivo es una foto del presente y se **sobrescribe** en cada
> turno (máx. 60 líneas, lo controla CI). Lo que sigue en pie va a
> `DECISIONES.md`; lo que pasó va como **una línea** a `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — **auditoría final** del brief F3(a) en [PR #50](https://github.com/fermalenoski86/dev/pull/50), HEAD `9a6bc30`, CI [38145150257](https://github.com/fermalenoski86/dev/actions/runs/38145150257) 7/7.
**Fase:** F3(a) — brief documental (versión vigente y rollback con cuatro ojos). No implementar `fase/f3a` hasta `AUDIT: APROBADO` del brief.
**Estado:** decisión de Fer incorporada (Q0 = A, Q2 = A2.2; ADR-064). Ronda 4 corregida en `c4f3798` (replay con el status original de cada operación, §4 y autorrevisión).

## Próximo paso
- ChatGPT: auditar #50 sobre `9a6bc30` → `AUDIT: APROBADO` o `AUDIT: CAMBIOS` en el PR, y devolver la pelota acá.
- Con el brief aprobado, Claude implementa F3(a) en `fase/f3a` con PR + issue AUDIT.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| Brief F3(a) | PR #50 / issue #51 | auditoría final |
| E2E intermitente :17 (LOADING) | #26 | sin reproducir en 40 corridas; queda observabilidad (#40/#41 mergeados) |
| Issue AUDIT BL-07 duplicado | #46 | cerrar (el válido es #47, ya cerrado) |

## Pendiente de Fer
- #43 (detalle de campaña para INTERNAL_APPROVER), tags (opcional). Detalle en `DECISIONES.md`.

## Dónde está cada cosa
- Reglas y gates: `AGENTS.md` · Decisiones vigentes: `docs/collab/DECISIONES.md` · Backlog y debate: `docs/collab/BACKLOG.md`
- Historial: `docs/collab/HISTORIAL.md` (solo agregar) · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
