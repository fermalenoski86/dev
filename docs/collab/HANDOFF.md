# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — reauditar **P-04** (PR #75, issue #76).
**En auditoría:** #75 @ 15f7c8a9ef7792e335113fc25eceac6412c3df6c
**Fase:** P-04 en reauditoría (ronda 5); después P-03 → PoC P-06 (orden confirmado por Fer). #73 (kit McDonald's) sigue bajo lock de la sesión Claude+Fer: los turnos horarios no lo tocan.
**Estado:** Claude corrigió los 2 P2 del [AUDIT: CAMBIOS sobre `cb6901f`](https://github.com/fermalenoski86/dev/pull/75#issuecomment-6139334186) en `886d2e4` y el P2 de Codex sobre `886d2e4` (modificadores partidos en varias líneas) en `15f7c8a`. [Pedido de reauditoría](https://github.com/fermalenoski86/dev/issues/76#issuecomment-6141048912).

## Entregado en `15f7c8a`
- `.only (` con espacio/corchetes y `retries` por ocurrencia (`886d2e4`, regresiones 4.28–4.29c); `timeout :` en la foto (4.30–4.30c).
- `.only` y `skip/fixme/slow/fail` buscados sobre el archivo entero (`perl -0777`): `test[\n"only"\n](`, `test.\nonly(`, `test.only.each(` dan rojo (4.32–4.32c; 6 rojas con el script anterior).
- CI [38363242493](https://github.com/fermalenoski86/dev/actions/runs/38363242493) sobre `15f7c8a`: 7/7 verdes, primer intento.

## Aviso
- `e2e-m2c` (`experience.spec.ts:14`, READY TO PRESENT queda en LOADING) falló en `main` @ `bb42e26` y en `886d2e4`; en `main` pasó al re-correr. Causa no determinada (en investigación) → #77. No es de P-04.

## Próximo paso
- ChatGPT: reauditar el delta `cb6901f..15f7c8a` (2 P2 del dictamen + P2 de Codex); si pasa, `AUDIT: APROBADO` → Claude mergea, cierra #76 y arranca P-03 → PoC P-06.
- Claude: no empujar sobre `15f7c8a` mientras esté en auditoría.

## Reglas
- Con la pelota en Claude puede avanzar el HEAD; al pedir reauditoría, actualizar `En auditoría` al SHA final y congelarlo.
- Codex: agrupar correcciones y no pedir revisiones por commit; registrar cantidad de revisiones/rondas (P-04: 6 revisiones, 1 pedida, 5 rondas).

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-04 diagnóstico de fallas | PR #75 / #76 | reauditoría sobre `15f7c8a` |
| P-03 → PoC P-06 | #53 / #54 | siguientes, en serie |
| Kit McDonald's | #73 | lock sesión Claude+Fer; entrega vie 16/10 |
| CS-0 Creative Studio | #59 / PR #74 | brief en PR; paralelo condicionado al HANDOFF vigente |
| E2E intermitente :17 | #26 / #77 | #77: READY TO PRESENT en e2e-m2c, causa no determinada |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER (PR #72 abierto).
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- `main`: required checks + rama al día después de adaptar escritores directos.
- PoC P-06: entorno Codex y `CLAUDE_CODE_OAUTH_TOKEN` (ver brief).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
