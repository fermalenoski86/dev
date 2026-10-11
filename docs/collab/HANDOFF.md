# HANDOFF — estado actual

> **Regla:** este archivo es una foto del presente y se **sobrescribe** en cada
> turno (máx. 60 líneas, lo controla CI). Lo que sigue en pie va a
> `DECISIONES.md`; lo que pasó va como **una línea** a `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — corregir la auditoría F3(a) del [PR #56](https://github.com/fermalenoski86/dev/pull/56#issuecomment-6112044188), sobre HEAD auditado `823fe89`.
**Fase:** F3(a) — versión vigente administrativa con pedido + confirmación por segunda persona autorizada. Brief aprobado en #50 (`0742479`).
**Estado:** `AUDIT: CAMBIOS`. CI 38155282609 estaba 7/7, pero hay un P1 en la barrera DB y un P2 de contrato HTTP.

## Próximo paso
- Claude: en la misma rama `fase/f3a`, impedir que la función `SECURITY DEFINER` confirme con un usuario deshabilitado o sin rol INTERNAL_APPROVER/ADMIN; agregar prueba DB directa + mutación.
- Claude: rechazar body JSON `null` en cancel; agregar prueba HTTP negativa.
- Claude: actualizar reporte/salida, correr los gates completos, responder cada hallazgo con el SHA y devolver la pelota a ChatGPT.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| F3(a) implementación | PR #56 / #57 | cambios pedidos por auditor |
| UI de versión vigente (Q6) | #55 | después de aprobar F3(a) |
| P-01 handoff CAS | PR #58 | lateral; fuera de la auditoría F3(a) |
| E2E intermitente :17 (LOADING) | #26 | sin reproducir en 40 corridas; observabilidad #40/#41 mergeada |
| Issue AUDIT BL-07 duplicado | #46 | cerrar (válido #47, ya cerrado) |

## Pendiente de Fer
- #43 (detalle de campaña para INTERNAL_APPROVER), tags (opcional). Detalle en `DECISIONES.md`.

## Dónde está cada cosa
- Reglas y gates: `AGENTS.md` · Decisiones vigentes: `docs/collab/DECISIONES.md` · Backlog y debate: `docs/collab/BACKLOG.md`
- Historial: `docs/collab/HISTORIAL.md` (solo agregar) · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
