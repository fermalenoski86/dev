# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — auditar **P-04** (PR #75, issue #76).
**En auditoría:** #75 @ 48489cca0b4124705ae187009aab4a8231b6af47
**Fase:** P-04 en auditoría; después P-03 → PoC P-06 (orden confirmado por Fer). #73 (kit McDonald's) lo lleva la sesión de Claude con Fer bajo lock: los turnos horarios no lo tocan.
**Estado:** P-04 entregada: PR #75 HEAD `48489cc`, CI [38332749947](https://github.com/fermalenoski86/dev/actions/runs/38332749947) verde (7/7 + paralelo). Falla provocada en los 7 jobs: runs 38331632397 y 38332414187 (7/7 rojos con entorno + cola sanitizada, 7/7 artifacts). Codex: 5 hallazgos de la revisión inicial corregidos en `f9f4ee7`; revisión final pedida sobre `48489cc`. Pedido de auditoría en #76.

## P-04 · qué auditar
- Alcance y criterio en `docs/reviews/P04.md` (autorrevisión A/B/C, hallazgos de Codex, contabilidad); salida real en `P04_SALIDA.txt`.
- Rama congelada hasta `AUDIT: APROBADO`/`CAMBIOS`. Si la revisión final de Codex trae hallazgos, Claude los corrige juntos con los del auditor.

## Reglas
- Para P-04: Claude implementa en su rama/PR y ChatGPT audita el HEAD congelado antes del merge; `En auditoría` se anota al entregar.
- Codex: no por commit; agrupar correcciones y pedir con el PR consolidado; cada pedido de auditoría informa revisiones de Codex y rondas. Hoy Codex agotó cuota dos veces (dato para PoC P-06).

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-04 diagnóstico de fallas | PR #75 / #76 | en auditoría @ 48489cc |
| P-03 → PoC P-06 | #53 / #54 | siguientes, en serie |
| Kit McDonald's | #73 | lock sesión Claude+Fer (00:51 UTC); entrega vie 16/10 |
| CS-0 Creative Studio | #59 / PR #74 | brief en PR; paralelo OK |
| E2E intermitente :17 | #26 | observabilidad #40/#41; sin reproducción estable |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER (PR #72 abierto).
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- `main`: ruleset activo sin borrado/force-push; required checks (`paralelo` ya publica sobre el HEAD) + rama al día después de adaptar escritores directos.
- PoC P-06: entorno Codex y `CLAUDE_CODE_OAUTH_TOKEN` (ver brief).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
