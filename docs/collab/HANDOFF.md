# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — corregir **P-05** en PR #69 (issue AUDIT #70).
**En auditoría:** #69 @ 49acd37067acb365c9d42c5a343063bb719dcb6a
**Fase:** P-05 activa; después P-04 → P-03.
**Estado:** `AUDIT: CAMBIOS` sobre `49acd37067acb365c9d42c5a343063bb719dcb6a`: comentario [#69](https://github.com/fermalenoski86/dev/pull/69#issuecomment-6127868963). No mergear.

## Auditoría P-05
- **[P2] R4 no cubre el contrato de riesgo bajo/medio:** `AGENTS.md:55` limita los laterales a riesgo bajo/medio y `BACKLOG.md:294` clasifica `gates/auth/transferencia` como alto, pero `paralelo.sh:37` solo bloquea gates/scripts/configs de test.
- Reproducción independiente: lateral que modifica `packages/platform-auth/src/x.ts` → esperado exit 8, real exit 0. Suite entregada: 49/49; negativo adversarial: 1 fallo.
- Local en HEAD exacto: `handoff.test.sh` 39/39, `paralelo.test.sh` 49/49, `bash -n` OK, `git diff --check` OK.
- CI exacta [38273814752](https://github.com/fermalenoski86/dev/actions/runs/38273814752) seguía `in_progress` al emitir el dictamen; la CI 8/8 de `5fdc97b` no valida el HEAD actual.
- No ejecutados localmente: build, PostgreSQL, media, mutaciones, E2E y compose/S3; requieren CI verde del SHA final.
- Las observaciones automáticas anteriores (autoevaluación, fase sin mergear, renames/no-ASCII, `edited`, ref ausente) están incorporadas en el delta, pendientes de reauditoría final.

## Próximo paso
- Claude: centralizar/reutilizar la clasificación de riesgo de P-03 o cubrir las familias altas ya acordadas sin ampliar alcance; agregar regresión al menos para auth y las demás familias explícitas que correspondan.
- Claude: responder el P2 por punto, entregar un único SHA final y esperar todos los jobs obligatorios verdes; luego devolver la pelota a ChatGPT.
- ChatGPT: reauditar ese SHA, repetir el negativo adversarial y verificar CI completa. Solo entonces `AUDIT: APROBADO` o nuevos cambios.

## Reglas durante corrección
- P-05 sigue activa hasta merge: R2 se relaja para que Claude corrija la rama; R3/R4 siguen protegiendo laterales; ningún PR toca `HANDOFF.md`.
- No implementar P-04/P-03 en paralelo si comparte archivos/dependencias o riesgo alto. No mergear laterales sin AUDIT propio.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-05 trabajo paralelo controlado | PR #69 / #70 | cambios pedidos sobre `49acd37` |
| P-04 → P-03 | #53 | siguientes, en ese orden |
| Agent Bridge (P-06) | #54 | chequeo horario; bridge sin implementar |
| CS-0 Creative Studio | #59 | autorizado; brief aparte |
| E2E intermitente :17 | #26 | observabilidad #40/#41; sin reproducción estable |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER.
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- Protección de rama `main` con CI requerido y rama al día (límite de P-01/P-05).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
