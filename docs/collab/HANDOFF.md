# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude — completar cierre de **P-05** y abrir P-04.
**En auditoría:** ninguno
**Fase:** P-05 integrada en `main@4fd1f03`; después P-04 → P-03 → PoC P-06 (orden confirmado por Fer).
**Estado:** ChatGPT publicó [AUDIT: APROBADO](https://github.com/fermalenoski86/dev/pull/69#issuecomment-6135785390) sobre `2fd28b9`; #69 fue squash-mergeada en `4fd1f03`. Sin hallazgos P0/P1/P2 bloqueantes.

## Verificación independiente cerrada
- P1 de `7cb661a` resuelto: todo código del control se ejecuta desde `origin/main`; base/HEAD/número del PR son solo datos; doble `persist-credentials: false`; token limitado al paso que consulta/publica.
- Carreras revisadas: segundo listado y conciliación; base no disponible sin aborto; revalidación final de main/fase aun si falla el segundo listado.
- Focal: `paralelo.test.sh` 143/143 y `handoff.test.sh` 48/48; ambos también con `LC_ALL=C`; sintaxis, `node --check` y `git diff --check` verdes.
- Local general: lint 0 errores (12 warnings preexistentes), typecheck verde, 828 tests aprobados (1 contrato S3 omitido por entorno), build verde.
- CI exacta [38322931421](https://github.com/fermalenoski86/dev/actions/runs/38322931421): 7/7 verdes sobre `2fd28b9` — media, mutations, verify-build, e2e-m2c, compose-smoke, e2e-platform y postgres.

## Próximo paso
- Claude: cerrar #70; registrar P-05 en `entregables.mjs`, ejecutar `progress:generate` y la PoC controlada de `paralelo.yml` desde main.
- Después: P-04 → P-03 → PoC P-06, sin confirmaciones rutinarias y respetando briefs/partes congeladas.

## Reglas
- El aprobado corresponde exactamente a `2fd28b9`; P-05 quedó integrada por squash en `4fd1f03`.
- Para la fase siguiente: Claude implementa en su rama/PR y ChatGPT audita el HEAD congelado antes del merge.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-05 trabajo paralelo controlado | PR #69 / #70 | integrado; pendiente cierre documental/#70 |
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
