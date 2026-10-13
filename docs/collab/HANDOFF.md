# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — corregir **P-04** (PR #75, issue #76).
**En auditoría:** #75 @ cb6901f3d1dfcacac5334d88fe33c63398953d63
**Fase:** P-04 con `AUDIT: CAMBIOS`; después P-03 → PoC P-06 (orden confirmado por Fer). #73 (kit McDonald's) sigue bajo lock de la sesión Claude+Fer: los turnos horarios no lo tocan.
**Estado:** ChatGPT reauditoró `cb6901f` y publicó [AUDIT: CAMBIOS](https://github.com/fermalenoski86/dev/pull/75#issuecomment-6139334186). Los tres hallazgos previos y los cuatro P2 de Codex quedaron corregidos, pero dos evasiones textuales todavía permiten maquillar el E2E.

## Hallazgos a corregir juntos
- **P2 foco con whitespace:** `test.describe.only (` pasa `politica-fallas.sh check`; el patrón sólo reconoce `.only(`. Aceptar espacios y agregar regresión.
- **P2 retries duplicados:** una línea con `--retries=0 --retries=2` pasa porque el `grep -v` descarta la línea completa al encontrar el permitido. Evaluar cada ocurrencia y cubrir múltiples propiedades en una línea.

## Verificación independiente
- CI exacta [38346858289](https://github.com/fermalenoski86/dev/actions/runs/38346858289) sobre `cb6901f`: 7/7 verdes, primer intento; `paralelo` verde.
- Local: lint 0 errores (12 warnings preexistentes), typecheck verde, 828 tests aprobados (1 S3 omitido), build de las tres apps verde.
- Focal: 117/118; sólo 5.9 no ejecutó por falta de `bc` local (CI: 118/118). Política, progress, acceptance, HANDOFF, sintaxis y diff verdes en el árbol original.
- Las dos reproducciones adversarias dan exit 0; clasificación: regresión reproducible, causa raíz determinada en validación textual por patrón/línea.

## Próximo paso
- Claude: una sola corrección acotada en `politica-fallas.sh` + regresiones; no ampliar alcance; responder el dictamen y entregar HEAD congelado con CI 7/7.
- ChatGPT: reauditar únicamente el delta final y los dos ataques; si pasa, `AUDIT: APROBADO` → Claude mergea, cierra #76 y arranca P-03 → PoC P-06.

## Reglas
- Con la pelota en Claude puede avanzar el HEAD; al pedir reauditoría, actualizar `En auditoría` al SHA final y congelarlo.
- Codex: agrupar correcciones y no pedir revisiones por commit; registrar cantidad de revisiones/rondas.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-04 diagnóstico de fallas | PR #75 / #76 | cambios pedidos sobre `cb6901f` |
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
