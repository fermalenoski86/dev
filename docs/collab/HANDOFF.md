# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — reauditar **P-04** (PR #75, issue #76).
**En auditoría:** #75 @ cb6901f3d1dfcacac5334d88fe33c63398953d63
**Fase:** P-04 en reauditoría; después P-03 → PoC P-06 (orden confirmado por Fer). #73 (kit McDonald's) sigue bajo lock de la sesión Claude+Fer: los turnos horarios no lo tocan.
**Estado:** Claude respondió el [AUDIT: CAMBIOS sobre `fc22fd4`](https://github.com/fermalenoski86/dev/pull/75#issuecomment-6137222056) y los 4 P2 de Codex sobre `ecb774f`. [Pedido de reauditoría](https://github.com/fermalenoski86/dev/issues/76#issuecomment-6138727932) con HEAD `cb6901f` congelado.

## Qué cambió en la ronda
- **P1 sanitización** (`be6105a`): redacción escape-aware de valores citados; regresión 2.11.
- **P1 timeout** (`be6105a`, `ecb774f`): `plazo.sh` + corte del gate en `run.sh` antes del `timeout-minutes`; falla temporizada real en run 38342453191 (job `media`) con cola + artifact, revertida.
- **P2 umbrales** (`be6105a`): timeouts de Playwright sólo literales; 4.22–4.27.
- **Codex sobre `ecb774f`** (`cb6901f`): skip/fixme/slow/fail por cualquier receptor; `retries` literal 0; SIGKILL externo ≠ plazo. 3.21–3.22, 4.21b–e.

## Verificación
- Local: run.test 118/118 (14 regresiones nuevas rojas con `ecb774f`), politica-fallas, progress y acceptance OK (`docs/reviews/P04_SALIDA.txt`).
- CI gates [38346858289](https://github.com/fermalenoski86/dev/actions/runs/38346858289) sobre `cb6901f`: 7/7 verdes; `paralelo` verde.
- Codex: 5 revisiones (1 pedida + 4 automáticas), 4 rondas; sin revisión extra.

## Próximo paso
- ChatGPT: reauditar `cb6901f`; si pasa, `AUDIT: APROBADO` → Claude mergea, cierra #76 y arranca P-03 → PoC P-06.
- Claude: no tocar la rama ni el HANDOFF hasta el veredicto.

## Reglas
- Rama congelada mientras la pelota es del auditor (`paralelo` lo hace cumplir).
- Codex: agrupar correcciones y no pedir revisiones por commit; registrar cantidad de revisiones/rondas.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-04 diagnóstico de fallas | PR #75 / #76 | en reauditoría sobre `cb6901f` |
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
