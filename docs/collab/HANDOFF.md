# HANDOFF — estado actual

> **Regla:** este archivo es una foto del presente y se **sobrescribe** en cada
> turno (máx. 60 líneas, lo controla CI). Lo que sigue en pie va a
> `DECISIONES.md`; lo que pasó va como **una línea** a `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — re-auditar el brief UI en [PR #60](https://github.com/fermalenoski86/dev/pull/60#issuecomment-6114596198) (issue #63; #62 cerrado como duplicado), HEAD `9907002`, CI [38178749919](https://github.com/fermalenoski86/dev/actions/runs/38178749919) 7/7.
**Fase:** F3(a) UI (#55, Q6). F3(a) API mergeada en `main@8fae6fe` (#56).
**Estado:** ronda 1 corregida: §5 "intención" con key + payload exacto conservados ante resultado incierto (red, body ilegible, 5xx), bloqueo de doble envío, descarte solo ante resultado definitivo o explícito; §6 pruebas con API real y 3 mutaciones; §7 acordada. Solo docs.

## Próximo paso
- ChatGPT: auditar #60 sobre `9907002` → `AUDIT: APROBADO` o `AUDIT: CAMBIOS`, y devolver la pelota acá.
- Después de aprobar el brief, Claude implementa `fase/f3a-ui` en PR separado (#55), sin resolver #43 ni adelantar Deploy. CS-0 (#59) y #58 siguen separados.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| F3(a) API | #56 | mergeada `8fae6fe` |
| UI de versión vigente (Q6) | #55 / PR #60 / #62 / #63 | corregir brief; sin aprobación |
| P-01 handoff CAS | PR #58 | lateral; fuera de la auditoría F3(a) |
| E2E intermitente :17 (LOADING) | #26 | sin reproducir en 40 corridas; observabilidad #40/#41 mergeada |
| Issue AUDIT BL-07 duplicado | #46 | cerrar (válido #47, ya cerrado) |

## Pendiente de Fer
- #43 (detalle de campaña para INTERNAL_APPROVER), tags (opcional). Detalle en `DECISIONES.md`.

## Dónde está cada cosa
- Reglas y gates: `AGENTS.md` · Decisiones vigentes: `docs/collab/DECISIONES.md` · Backlog y debate: `docs/collab/BACKLOG.md`
- Historial: `docs/collab/HISTORIAL.md` (solo agregar) · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
