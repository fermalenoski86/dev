# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — reauditar **P-04** (PR #75, issue #76).
**En auditoría:** #75 @ 4aa2205e9070445bca3f2e17918ca5aaaa749d9d
**Fase:** P-04 en reauditoría (ronda 7); después P-03 → PoC P-06 (orden confirmado por Fer). #73 (kit McDonald's) sigue bajo lock de la sesión Claude+Fer: los turnos horarios no lo tocan.
**Estado:** Claude corrigió los 2 P2 del [AUDIT: CAMBIOS sobre `15f7c8a`](https://github.com/fermalenoski86/dev/pull/75#issuecomment-6159376633) en `e79fb97` y el P2 de Codex sobre `e79fb97` (copia del log no escribible dejaba el gate verde) en `4aa2205`. [Pedido de reauditoría](https://github.com/fermalenoski86/dev/issues/76#issuecomment-6160717387).

## Entregado en `4aa2205`
- `run.sh`: `tee` fallido (`e79fb97`, 3.23–3.23d) y copia `$P04_LOGS/<título>.log` no escribible (`4aa2205`, 3.23e–3.23h) → exit ≠ 0 con comando verde, título `log no escrito`.
- Claves de timeout entre comillas en la foto y en `timeout no literal` (`e79fb97`, 4.33–4.33g).
- CI [38506688709](https://github.com/fermalenoski86/dev/actions/runs/38506688709) sobre `4aa2205`: 7/7 verdes; `e2e-m2c` en el 2.º intento (falla de #77).

## Aviso
- `e2e-m2c` (`experience.spec.ts:14`, READY TO PRESENT queda en LOADING): 3 apariciones (`main` @ `bb42e26`, `886d2e4`, `4aa2205`), siempre verde al re-correr. Causa no determinada (en investigación) → #77. No es de P-04.

## Próximo paso
- ChatGPT: reauditar el delta `15f7c8a..4aa2205` (2 P2 del dictamen + P2 de Codex); si pasa, `AUDIT: APROBADO` → Claude mergea, cierra #76 y arranca P-03 → PoC P-06.
- Claude: no empujar sobre `4aa2205` mientras esté en auditoría.

## Reglas
- Con la pelota en Claude puede avanzar el HEAD; al pedir reauditoría, actualizar `En auditoría` al SHA final y congelarlo.
- Codex: agrupar correcciones y no pedir revisiones por commit; registrar cantidad de revisiones/rondas (P-04: 8 revisiones, 1 pedida, 7 rondas).

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-04 diagnóstico de fallas | PR #75 / #76 | reauditoría sobre `4aa2205` |
| P-03 → PoC P-06 | #53 / #54 | siguientes, en serie |
| Kit McDonald's | #73 | lock sesión Claude+Fer; entrega vie 16/10 |
| CS-0 Creative Studio | #59 / PR #74 | brief en PR; paralelo condicionado al HANDOFF vigente |
| E2E intermitente :17 | #26 / #77 | #77: READY TO PRESENT en e2e-m2c (3 veces), causa no determinada |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER (PR #72 abierto).
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- `main`: required checks + rama al día después de adaptar escritores directos.
- PoC P-06: entorno Codex y `CLAUDE_CODE_OAUTH_TOKEN` (ver brief).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
