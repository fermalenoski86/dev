# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — reauditar **P-05** en PR #69 (issue AUDIT #70).
**En auditoría:** #69 @ 2fd28b9acc433df9a644b2655c0db0767eae535c
**Fase:** P-05 activa; después P-04 → P-03 → PoC P-06 (orden confirmado por Fer).
**Estado:** corrección entregada sobre tu `AUDIT: CAMBIOS` (7cb661a). CI exacta [38322931421](https://github.com/fermalenoski86/dev/actions/runs/38322931421) **7/7 verdes** sobre `2fd28b9`. Pedido: [#69](https://github.com/fermalenoski86/dev/pull/69#issuecomment-6135104129). No mergear sin `AUDIT: APROBADO`.

## Qué se corrigió (rondas 30–33; detalle en `docs/reviews/P05.md`, salidas en `P05_SALIDA.txt`)
- Tu P1 (script desde la base no auditada): todo el código del workflow sale de un checkout de `main` para TODA base; base/HEAD/número solo como datos; guard de `workflow_sha` contra el `paralelo.yml` de `main`; `persist-credentials: false` ×2 y `GH_TOKEN` solo donde se publica/consulta; prueba adversarial 6b (fase con `paralelo.sh` debilitado + YAML idéntico → exit 5 con el script de main).
- Codex (`cfc5752`, `545512c`, `168d4eb`, respondidos con su commit): conciliación de PR que entran a main durante la re-evaluación (segundo listado → SIN VEREDICTO); base del PR no disponible no corta el job; la revalidación de main/fase es lo último del script, también si el segundo listado falla.
- Pruebas: `paralelo.test.sh` 143/143 y `handoff.test.sh` 48/48, en UTF-8 y `LC_ALL=C`.
- Codex agotó cuota de revisiones a las 23:35 UTC (2ª vez hoy): `2fd28b9` sin revisión automática. Dato de costo para la PoC P-06.

## Próximo paso
- ChatGPT: reauditar `2fd28b9` (origen del script = main, 6b, conciliación, handoff exit 5), verificar CI exacta y emitir veredicto.
- Claude (tras `AUDIT: APROBADO`): squash-merge #69, cerrar #70, `En auditoría: ninguno`, entregable P-05 en `entregables.mjs` + `progress:generate`, PoC controlada de `paralelo.yml` en `main`; después P-04 → P-03 → PoC P-06.

## Reglas durante auditoría
- P-05 activa hasta merge: R2 congela el HEAD `2fd28b9` (Claude no pushea a la rama); R3/R4 protegen laterales; ningún PR toca `HANDOFF.md`.
- Hallazgos de Codex entre medio son input: se responden en el PR, sin push hasta tu veredicto.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-05 trabajo paralelo controlado | PR #69 / #70 | en reauditoría sobre `2fd28b9` |
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
