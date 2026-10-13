# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — corregir **P-04** (PR #75, issue #76).
**En auditoría:** #75 @ fc22fd454dace51cc0011129266508fe64823755
**Fase:** P-04 con `AUDIT: CAMBIOS`; después P-03 → PoC P-06 (orden confirmado por Fer). #73 (kit McDonald's) sigue bajo lock de la sesión Claude+Fer: los turnos horarios no lo tocan.
**Estado:** ChatGPT auditó el HEAD actual `fc22fd4` y publicó [AUDIT: CAMBIOS](https://github.com/fermalenoski86/dev/pull/75#issuecomment-6137222056). El push durante la congelación fue un error de proceso; `paralelo` lo rechazó correctamente. `fc22fd4` queda adoptado como base de esta ronda para evitar un rewind.

## Hallazgos a corregir juntos
- **P1 sanitización:** una comilla escapada deja visible el resto del secreto (`{"password":"abc\\"DEF-SECRET"}` → expone `DEF-SECRET`). Redacción escape-aware/conservadora + regresiones.
- **P1 timeout:** al cancelar el job, GitHub interrumpe `run.sh` antes de crear cola/log sanitizado; el fallback deja sólo entorno. Reservar cleanup o mecanismo equivalente y demostrar timeout real con cola + artifact.
- **P2 umbrales:** `{ timeout: 40_000 * 10 }` no cambia la foto y `politica-fallas.sh check` pasa. Fotografiar la expresión completa o aceptar sólo literal + regresión.

## Verificación independiente
- Local general: lint 0 errores (12 warnings preexistentes), typecheck verde, 828 tests aprobados (1 contrato S3 omitido por entorno), build verde.
- Focal: 82/83 locales; el único caso no ejecutó por falta de `bc` en este entorno. `politica-fallas`, sintaxis y diff verdes; las tres reproducciones adversarias confirman los hallazgos.
- CI exacta [38337390602](https://github.com/fermalenoski86/dev/actions/runs/38337390602) sobre `fc22fd4`: 6/7 verdes; mutations seguía en curso al dictamen. No aprobar con gates o hallazgos pendientes.

## Próximo paso
- Claude: una sola ronda consolidada, sin ampliar alcance; responder cada hallazgo con SHA, agregar regresiones y prueba temporizada real; entregar HEAD congelado con CI 7/7 y `paralelo` verde.
- ChatGPT: reauditar el SHA final; si pasa, habilitar merge y luego P-03 → PoC P-06.

## Reglas
- La rama vuelve a Claude por este dictamen. Al pedir reauditoría, actualizar `En auditoría` al SHA final y congelarla otra vez.
- Codex: agrupar correcciones y no pedir revisiones por commit; registrar cantidad de revisiones/rondas.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-04 diagnóstico de fallas | PR #75 / #76 | cambios pedidos sobre `fc22fd4` |
| P-03 → PoC P-06 | #53 / #54 | siguientes, en serie |
| Kit McDonald's | #73 | lock sesión Claude+Fer; entrega vie 16/10 |
| CS-0 Creative Studio | #59 / PR #74 | brief en PR; paralelo condicionado al HANDOFF vigente |
| E2E intermitente :17 | #26 | observabilidad #40/#41; sin reproducción estable |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER (PR #72 abierto).
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- `main`: required checks + rama al día después de adaptar escritores directos.
- PoC P-06: entorno Codex y `CLAUDE_CODE_OAUTH_TOKEN` (ver brief).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
