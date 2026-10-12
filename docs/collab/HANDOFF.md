# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — P-02 (progreso verificable) en `proc/p02-progreso`, desde `main@e7bac5a`.
**Fase:** P-02, `PROGRESO.md` generado desde un manifiesto determinista. Es lo que sigue según el orden de #53 y el veredicto de #58.
**Estado:** P-01 [AUDIT: APROBADO](https://github.com/fermalenoski86/dev/pull/58#issuecomment-6121930565) sobre `fb77a49`, con CI 38222115237 7/7. Squash `main@e7bac5a`, #66 cerrado. P-02 por empezar.

## Evidencia P-01
- HEAD auditado: `fb77a49d664604fd4e39ac8ebc2163ff93bc9b90`.
- Auditor local: handoff.test 31/31; 61 líneas sin newline rechazadas; borde 60 OK; HANDOFF válido, `bash -n` y `diff --check` OK.
- CI [38222115237](https://github.com/fermalenoski86/dev/actions/runs/38222115237): 7/7 al primer intento, HEAD exacto.
- Verify 811+1; PG 342+6; media 63; mutaciones 339/339; M2C 14/14; navegador 10/10; compose/S3 16/16.
- PostgreSQL/media/mutaciones/E2E/compose-S3 no se ejecutaron localmente por el auditor; sí en CI.
- Límite: el script no reemplaza branch protection; sigue pendiente de Fer.

## Próximo paso
- Claude: P-02 según los ajustes de #53 (BACKLOG): fuente determinista en el repo, `0/0` distinto de `0/N`, sin AUDIT no cuenta, brief ≠ funcionalidad, equipo real con evidencia. PR con `docs/reviews/P02.md` y la salida real, issue `AUDIT: P-02` y CI 7/7 antes de pasar la pelota.
- Después: P-05 → P-04 → P-03. CS-0 (#59) sigue autorizado y separado.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-01 handoff CAS | PR #58 / #66 | aprobado; merge pendiente |
| P-02 progreso verificable | #53 | siguiente unidad |
| P-05 → P-04 → P-03 | #53 | después de P-02 |
| Agent Bridge (P-06) | #54 | chequeo horario activo; bridge sin implementar |
| CS-0 Creative Studio | #59 | autorizado; brief aparte |
| E2E intermitente :17 | #26 | observabilidad #40/#41; sin reproducción estable |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER.
- Tags opcionales bloqueados por proxy: bl31, bl07, bl08, f3a, f3a-ui.
- Protección de rama `main` con CI requerido (límite declarado de P-01).

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md`
- Historial: `docs/collab/HISTORIAL.md` · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
