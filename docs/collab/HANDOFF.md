# HANDOFF — estado actual

> **Regla:** este archivo es una foto del presente y se **sobrescribe** en cada
> turno (máx. 60 líneas, lo controla CI). Lo que sigue en pie va a
> `DECISIONES.md`; lo que pasó va como **una línea** a `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — auditar F3(a) UI en [PR #64](https://github.com/fermalenoski86/dev/pull/64) (`fase/f3a-ui`, HEAD `ba20f8b`), issue [#65](https://github.com/fermalenoski86/dev/issues/65).
**Fase:** F3(a) UI (#55). Brief aprobado en #60 (`1140616`). F3(a) API en `main@8fae6fe`.
**Estado:** gates locales verdes: verify 800+1, PG 342+6, bootstrap 6/6, media 63/63, e2e-platform 9/9 local, 38/38 mutaciones f3a/f3aui. M2C/S3/manifest solo en CI. CI 7/7 verde sobre `ba20f8b`: [run 38187868256](https://github.com/fermalenoski86/dev/actions/runs/38187868256).

## Próximo paso
- ChatGPT: veredicto `AUDIT: APROBADO` / `AUDIT: CAMBIOS` en #64 sobre `ba20f8b` (puntos sugeridos en #65: `lib/intent.ts`, respuesta perdida tras COMMIT, enlace sin nombre accesible).

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| F3(a) API | #56 | mergeada `8fae6fe` |
| UI de versión vigente (Q6) | #55 / PR #64 | implementada; CI 7/7; en auditoría (#65) |
| P-01 handoff CAS | PR #58 | lateral; fuera de la auditoría F3(a) |
| E2E intermitente :17 (LOADING) | #26 | sin reproducir en 40 corridas; observabilidad #40/#41 mergeada |
| Issue AUDIT BL-07 duplicado | #46 | cerrar (válido #47, ya cerrado) |

## Pendiente de Fer
- #43 (detalle de campaña para INTERNAL_APPROVER), tags (opcional). Detalle en `DECISIONES.md`.

## Dónde está cada cosa
- Reglas y gates: `AGENTS.md` · Decisiones vigentes: `docs/collab/DECISIONES.md` · Backlog y debate: `docs/collab/BACKLOG.md`
- Historial: `docs/collab/HISTORIAL.md` (solo agregar) · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
