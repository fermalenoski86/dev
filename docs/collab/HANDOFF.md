# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — corregir **P-05** en PR #69 (issue AUDIT #70).
**En auditoría:** #69 @ 7700da3ef8e415fbdb79bc3687eb441bac9744bf
**Fase:** P-05 activa; después P-04 → P-03 → PoC P-06 (orden confirmado por Fer).
**Estado:** `AUDIT: CAMBIOS` sobre `7700da3ef8e415fbdb79bc3687eb441bac9744bf`: comentario [#69](https://github.com/fermalenoski86/dev/pull/69#issuecomment-6131655216). No mergear.

## Auditoría P-05 · ronda actual
- **[P1] Cola global incompleta:** `paralelo.yml` usa el grupo literal `paralelo` para todos los eventos, pero solo re-evalúa todos los PR cuando `base.ref == main`.
- GitHub conserva por defecto un solo run pendiente por grupo: un evento posterior de PR hacia la rama de fase puede reemplazar el `synchronize` pendiente S1→S2; ese run no re-evalúa los laterales y puede dejar un verde calculado contra S1.
- Corrección pedida: aislar eventos no-`main` del carril global o garantizar que todo run capaz de reemplazar al pendiente re-evalúe desde `main` confiable; agregar regresión contractual del caso.
- Fuente primaria: documentación GitHub Actions sobre concurrency, enlazada en el comentario de auditoría (consulta 2026-10-12).
- CI exacta [38299380479](https://github.com/fermalenoski86/dev/actions/runs/38299380479): 6/7 verdes al dictamen; `mutations` seguía en curso. No se aprueba con gate pendiente.

## Verificación independiente en `7700da3`
- `handoff.test.sh` 39/39; `paralelo.test.sh` 112/112 en UTF-8 y 112/112 con `LC_ALL=C`.
- Auth ahora rechaza exit 8; S1→S2 del script pasa. El P1 está en la cola real del workflow.
- Lint 0 errores (12 warnings preexistentes), typecheck OK, suite default 828/828 + 1 S3 omitido, build de 3 apps OK.
- `bash -n`, `node --check`, `git diff --check` y chequeo manual del PR congelado: OK.
- No ejecutados localmente: PostgreSQL, bootstrap, media, mutaciones, E2E y compose/S3; CI acredita todos salvo mutaciones pendiente al dictamen.

## Próximo paso
- Claude: corregir el P1 sin ampliar alcance; responder por punto, actualizar pruebas/reporte, entregar un único SHA final y esperar CI completa.
- Claude: devolver la pelota a ChatGPT con `En auditoría` actualizado al SHA final.
- ChatGPT: reauditar la cola, repetir auth/S1→S2, verificar CI exacta y emitir veredicto.

## Reglas durante corrección
- P-05 sigue activa hasta merge: R2 se relaja para la corrección; R3/R4 siguen protegiendo laterales; ningún PR toca `HANDOFF.md`.
- P-04/P-03 siguen en serie porque tocan CI/scripts y son riesgo alto. No mergear laterales sin AUDIT propio.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-05 trabajo paralelo controlado | PR #69 / #70 | cambios pedidos sobre `7700da3` |
| P-04 → P-03 | #53 | siguientes, en serie |
| Agent Bridge (P-06) | #54 | brief `docs/briefs/P06_BRIDGE_POC.md`; PoC después de P-03 |
| CS-0 Creative Studio | #59 | autorizado; sigue en roadmap |
| E2E intermitente :17 | #26 | observabilidad #40/#41; sin reproducción estable |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER.
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- `main`: ruleset activo sin borrado/force-push; required checks + rama al día después de adaptar escritores directos.

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
