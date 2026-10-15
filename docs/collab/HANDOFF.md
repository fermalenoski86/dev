# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — reauditar **P-04** en PR #75 (issue #76) sobre el HEAD congelado.
**En auditoría:** #75 @ 8bd04c5381ec970564b986178ef898aa4bb2677e
**Fase:** P-04 en reauditoría (ronda 9); después P-03 → PoC P-06 (orden confirmado por Fer). #73 (kit McDonald's) sigue bajo lock de la sesión Claude+Fer: los turnos horarios no lo tocan.
**Estado:** los 3 hallazgos del `AUDIT: CAMBIOS` sobre `e40c115` corregidos juntos en `aba796f` (+ ensayo provocado `facec22`/`d52bbee`, revertido en `f1b45c9`) y fix de la prueba 3.24 en CI en `8bd04c5`. Gates 7/7 verdes (run 38678673033), `paralelo` OK. [Pedido](https://github.com/fermalenoski86/dev/pull/75#issuecomment-6184449801).

## Qué se corrigió (ronda 9)
1. **[P1]** `scripts/ci/vigia.sh`: lo lanza `plazo.sh`; corta el paso colgado (setup o `uses:`) en `P04_PLAZO_FIN` + gracia y deja `plazo-vencido.txt` + anotación. Ensayo en CI: run 38677813259 (media, setup `sleep 900`, timeout 4 min) → failure en 3 min 28 s con anotación y artifact.
2. **[P2]** paso final autocontenido (`P04_FINAL` en el `env` de `gates.yml`): sin checkout igual anota y deja `entorno.txt`.
3. **[P2]** `politica-fallas.sh` 1c: clave `retries`/`timeout` partida por salto de línea o comentario → rojo.
- `run.test.sh`: 22 regresiones rojas con los scripts de `e40c115`; 194/194 verdes.

## Aviso
- `e2e-m2c` intermitente (`experience.spec.ts:14`) → #77, causa no determinada; sin reintentos extra (resultado en el pedido).

## Próximo paso
- ChatGPT: reauditar `8bd04c5` (HEAD congelado: Claude no lo toca).
- Claude, con la pelota de vuelta: si `AUDIT: APROBADO`, mergear (squash), `En auditoría: ninguno`, entregable P-04 en `entregables.mjs`, y arrancar P-03. CS-0 (#74) puede mergearse después de #75 (comparten `BACKLOG.md`).

## Reglas
- Codex: agrupar correcciones y no pedir revisiones por commit (P-04: 9 revisiones, 1 pedida, 9 rondas; ninguna nueva en la ronda 9).

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-04 diagnóstico de fallas | PR #75 / #76 | reauditoría pedida sobre `8bd04c5` |
| P-03 → PoC P-06 | #53 / #54 | siguientes, en serie |
| Kit McDonald's | #73 | lock sesión Claude+Fer; entrega vie 16/10 |
| CS-0 Creative Studio | #59 / PR #74 | `AUDIT: APROBADO`; merge pospuesto (P-05: comparte BACKLOG.md con #75) |
| E2E intermitente :17 | #26 / #77 | #77: READY TO PRESENT en e2e-m2c, causa no determinada |

## Pendiente de Fer
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- `main`: required checks + rama al día después de adaptar escritores directos.
- PoC P-06: entorno Codex y `CLAUDE_CODE_OAUTH_TOKEN` (ver brief).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
