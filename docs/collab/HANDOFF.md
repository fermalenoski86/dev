# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — reauditar **P-05** en PR #69 (issue AUDIT #70).
**En auditoría:** #69 @ 7cb661a9f7ab4df2b0b0d395a5a121a1c2cc3a8f
**Fase:** P-05 activa; después P-04 → P-03 → PoC P-06 (orden confirmado por Fer).
**Estado:** corrección entregada sobre tu `AUDIT: CAMBIOS` (7700da3). CI exacta [38316748544](https://github.com/fermalenoski86/dev/actions/runs/38316748544) **7/7 verdes** sobre `7cb661a`. Pedido: [#69](https://github.com/fermalenoski86/dev/pull/69#issuecomment-6134180046). No mergear sin `AUDIT: APROBADO`.

## Qué se corrigió (rondas 15–29; detalle en `docs/reviews/P05.md`, salidas en `P05_SALIDA.txt`)
- Tu P1 (cola global): la re-evaluación corre en TODO evento `pull_request_target` (cualquier base) con scripts de `main` en worktree aparte, y en cada push a `main`.
- Codex (todos respondidos, cada uno con su commit): scripts en ejecución == `main` comparado; "pendiente" sobre todos los HEAD antes de evaluar; publicación con reintentos; revalidación de `main`/fase antes y después de publicar (CADUCADO); el check del HEAD de un PR hacia `main` es el de la re-evaluación global (el directo solo agrega rojos); base/HEAD actuales del PR consultados antes y después de publicar; guard de workflow cargado ≠ base actual sin cortar la re-evaluación.
- `GATES_RE`: scripts/ de cada paquete (raíces de `pnpm-workspace.yaml`), bloque `scripts` de `package.json` (R4b), `e2e/`, `e2e-platform/`.
- `handoff.sh`: no deja quitar ni cambiar la fase activa sin merge verificado EN `main` (merged + base main + merge commit ancestro; exit 5).
- Pruebas: `paralelo.test.sh` 133/133 y `handoff.test.sh` 48/48, en UTF-8 y `LC_ALL=C`. e2e-m2c rojo en e511687 fue de arranque (ajeno al diff; verde en todas las corridas siguientes).

## Próximo paso
- ChatGPT: reauditar `7cb661a` (cola, auth/S1→S2, familias nuevas, handoff exit 5), verificar CI exacta y emitir veredicto.
- Claude (tras `AUDIT: APROBADO`): squash-merge #69, cerrar #70, `En auditoría: ninguno`, entregable P-05 en `entregables.mjs` + `progress:generate`, PoC controlada de `paralelo.yml` en `main`; después P-04 → P-03 → PoC P-06.

## Reglas durante auditoría
- P-05 activa hasta merge: R2 congela el HEAD `7cb661a` (Claude no pushea a la rama); R3/R4 protegen laterales; ningún PR toca `HANDOFF.md`.
- Hallazgos de Codex entre medio son input: se responden en el PR, sin push hasta tu veredicto.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-05 trabajo paralelo controlado | PR #69 / #70 | en reauditoría sobre `7cb661a` |
| P-04 → P-03 | #53 | siguientes, en serie |
| Agent Bridge (P-06) | #54 | brief `docs/briefs/P06_BRIDGE_POC.md`; PoC después de P-03 |
| CS-0 Creative Studio | #59 | autorizado; sigue en roadmap |
| E2E intermitente :17 | #26 | observabilidad #40/#41; sin reproducción estable |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER.
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- `main`: ruleset activo sin borrado/force-push; required checks + rama al día después de adaptar escritores directos.
- PoC P-06: entorno Codex y `CLAUDE_CODE_OAUTH_TOKEN` (ver brief).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
