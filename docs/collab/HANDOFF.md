# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — **P-05** (PRs laterales sin tocar HANDOFF con pelota ajena) por empezar, en rama propia desde `main@9ef94ea`, según los ajustes de #53.
**Trabajo en curso:** Claude (chequeo horario P-06) desde 2026-10-12 14:30 UTC — P-05 en rama propia; el turno de las :56 no debe duplicar.
**Fase:** P-02 cerrada (aprobada, mergeada y autorregistrada); siguiente unidad autorizada P-05 (después P-04 → P-03).
**Estado:** [AUDIT: APROBADO](https://github.com/fermalenoski86/dev/pull/67#issuecomment-6125999057) sobre `65b3775595f620f3117e4c4bc8b6160abe020772`; squash `main@68b7e22`, #68 cerrado. CI [38247701037](https://github.com/fermalenoski86/dev/actions/runs/38247701037) 7/7, intento 1, HEAD exacto.

## Evidencia P-02
- Ronda 1 cerrada: simulación en `condiciones`, responsable con espacio inicial y fecha imposible ahora producen error y quedan en 0/1.
- Auditor local: tests P-02 17/17; `progress:check` OK (31 entradas y `PROGRESO.md` al día); `diff --check` limpio.
- Trazabilidad GitHub independiente: 29/29 PR/AUDIT válidos (merge en `main`, SHA, comentario y SHA auditado coinciden).
- CI exacto: `verify-build`, PostgreSQL, media, mutaciones, M2C, e2e-platform y compose-smoke verdes.
- No ejecutado localmente: suite completa/build/PG/media/mutaciones/E2E/compose-S3 (entorno local Node 24); sí ejecutado en CI exacto.
- `verificar-github` literal no ejecutado localmente por falta de `gh`; las mismas seis condiciones se comprobaron vía API para 29/29 referencias.

## Próximo paso
- Hecho: P-02 agregado al manifiesto como `proceso` (merge `68b7e22`, AUDIT 6125999057) en `main@9ef94ea`; `PROGRESO.md` regenerado (32 entradas), `progress:check` OK, `verificar-github` 30/30.
- Claude: crear rama y PR propios para P-05, sin pedir confirmación rutinaria; respetar sus ajustes aceptados en BACKLOG (#53): no tocar `HANDOFF.md` con la pelota ajena (ni la tabla Abierto), lateral solo de backlog aprobado y riesgo bajo/medio, nunca mergear sin AUDIT propio, restricciones de push requieren branch protection. Autorrevisión A/B/C, CI 7/7, issue `AUDIT: P-05`.
- P-05 no habilita trabajo paralelo hasta estar implementada, auditada y mergeada.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-02 progreso verificable | PR #67 / #68 | aprobado, mergeado en `68b7e22`, registrado en `9ef94ea` |
| P-05 → P-04 → P-03 | #53 | P-05 siguiente unidad autorizada |
| Agent Bridge (P-06) | #54 | chequeo horario activo; bridge sin implementar |
| CS-0 Creative Studio | #59 | autorizado; brief aparte |
| E2E intermitente :17 | #26 | observabilidad #40/#41; sin reproducción estable |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER.
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- Protección de rama `main` con CI requerido (límite declarado de P-01).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md` · `docs/collab/PROGRESO.md` (generado, P-02)
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
