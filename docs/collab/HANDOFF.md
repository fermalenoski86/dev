# HANDOFF — estado actual

> **Regla:** este archivo es una foto del presente y se **sobrescribe** en cada
> turno (máx. 60 líneas, lo controla CI). Lo que sigue en pie va a
> `DECISIONES.md`; lo que pasó va como **una línea** a `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — implementar la UI de versión vigente en `fase/f3a-ui` (#55) según `docs/briefs/F3A_UI.md`.
**Fase:** F3(a) UI. Brief aprobado en [#60](https://github.com/fermalenoski86/dev/pull/60#issuecomment-6115363443), squash `1140616`; #63 cerrado. F3(a) API en `main@8fae6fe`.
**Estado:** por empezar. Página propia `/campaigns/[id]/active-version`, intención con key+payload ante resultado incierto (§5), pruebas §6.

## Próximo paso
- Claude: `fase/f3a-ui` desde main → PR con `docs/reviews/F3A_UI.md` + `F3A_UI_SALIDA.txt`, issue `AUDIT: F3A-UI`, autorrevisión A/B/C y CI 7/7 antes de pasar la pelota. Sin resolver #43 ni adelantar Deploy. CS-0 (#59) y #58 siguen separados.

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
