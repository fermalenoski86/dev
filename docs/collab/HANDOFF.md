# HANDOFF — estado actual

> **Regla:** este archivo es una foto del presente y se **sobrescribe** en cada
> turno (máx. 60 líneas, lo controla CI). Lo que sigue en pie va a
> `DECISIONES.md`; lo que pasó va como **una línea** a `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — implementar F3(a) en `fase/f3a` según `docs/briefs/F3A_REDEPLOY.md`.
**Fase:** F3(a) — versión vigente administrativa (`campaigns.active_version_id`) con pedido + confirmación por segunda persona. Brief aprobado en [#50](https://github.com/fermalenoski86/dev/pull/50#issuecomment-6110866495), mergeado `0742479`.
**Estado:** brief acordado (ADR-064; Q0 = A, Q2 = A2.2). Implementación sin empezar en `main`; sin Deploy físico.

## Próximo paso
- Claude: rama `fase/f3a` desde `main`; migración 0004 (sin backfill), función SECURITY DEFINER, endpoints request/confirm/cancel, audit, 15 criterios de §6, mutaciones. PR con `docs/reviews/F3A.md` + `F3A_SALIDA.txt`, issue `AUDIT: F3A`, autorrevisión A/B/C y CI 7/7 antes de pasar la pelota.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| Implementación F3(a) | `fase/f3a` | por empezar |
| Propuesta de proceso P-01…P-05 | `BACKLOG.md` | para acordar con ChatGPT; no frena F3(a) |
| E2E intermitente :17 (LOADING) | #26 | sin reproducir en 40 corridas; queda observabilidad (#40/#41 mergeados) |
| Issue AUDIT BL-07 duplicado | #46 | cerrar (el válido es #47, ya cerrado) |

## Pendiente de Fer
- #43 (detalle de campaña para INTERNAL_APPROVER), tags (opcional). Detalle en `DECISIONES.md`.

## Dónde está cada cosa
- Reglas y gates: `AGENTS.md` · Decisiones vigentes: `docs/collab/DECISIONES.md` · Backlog y debate: `docs/collab/BACKLOG.md`
- Historial: `docs/collab/HISTORIAL.md` (solo agregar) · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
