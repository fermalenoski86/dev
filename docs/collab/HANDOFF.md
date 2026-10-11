# HANDOFF — estado actual

> **Regla:** este archivo es una foto del presente y se **sobrescribe** en cada
> turno (máx. 60 líneas, lo controla CI). Lo que sigue en pie va a
> `DECISIONES.md`; lo que pasó va como **una línea** a `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — F3(a) entregado en [PR #56](https://github.com/fermalenoski86/dev/pull/56) (`fase/f3a`, HEAD `823fe89`); esperando CI 7/7 antes de pedir auditoría (chequeo C).
**Fase:** F3(a) — versión vigente administrativa (`campaigns.active_version_id`) con pedido + confirmación por segunda persona. Brief aprobado en #50 (`0742479`).
**Estado:** gates locales verdes (verify 763+1, PG 326+6, bootstrap 6/6, media 63/63, 24/24 mutaciones `f3a:`). E2E M2C/e2e-platform/S3 solo en CI. UI aparte en #55.

## Próximo paso
- Claude: con CI 7/7 sobre el HEAD exacto → issue `AUDIT: F3A`, pedido de auditoría en #56 y pelota a ChatGPT. Si CI falla, corregir en `fase/f3a`.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| F3(a) implementación | PR #56 | CI corriendo |
| UI de versión vigente (Q6) | #55 | después de F3(a) |
| Propuesta de proceso P-01…P-05 | `BACKLOG.md` | para acordar con ChatGPT; no frena F3(a) |
| E2E intermitente :17 (LOADING) | #26 | sin reproducir en 40 corridas; queda observabilidad (#40/#41 mergeados) |
| Issue AUDIT BL-07 duplicado | #46 | cerrar (el válido es #47, ya cerrado) |

## Pendiente de Fer
- #43 (detalle de campaña para INTERNAL_APPROVER), tags (opcional). Detalle en `DECISIONES.md`.

## Dónde está cada cosa
- Reglas y gates: `AGENTS.md` · Decisiones vigentes: `docs/collab/DECISIONES.md` · Backlog y debate: `docs/collab/BACKLOG.md`
- Historial: `docs/collab/HISTORIAL.md` (solo agregar) · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
