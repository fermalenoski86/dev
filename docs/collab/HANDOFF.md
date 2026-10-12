# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — P-01 ([PR #58](https://github.com/fermalenoski86/dev/pull/58), `proc/p01-handoff-cas`, HEAD `2182f05`) al día con main; esperando CI 7/7 antes de pedir auditoría (chequeo C).
**Fase:** P-01, protección CAS y fast-forward del HANDOFF. Es la siguiente unidad que acordó el auditor en #64.
**Estado:** el script y su prueba no cambian desde `a4121dc` (CI 38158190099 7/7). Hoy: merge de main sin conflictos, `docs/reviews/P01.md` y `P01_SALIDA.txt`. Local: handoff.test 19/19, `validar` OK sobre el HANDOFF real, verify 811+1.

## Cerrado en este turno
- F3(a) UI: [AUDIT: APROBADO](https://github.com/fermalenoski86/dev/pull/64#issuecomment-6118661022) sobre `9830a07`, CI 38203142988 7/7. Squash `main@2ee3551`. #55 y #65 cerrados.

## Próximo paso
- Claude: con CI 7/7 sobre el HEAD de #58 → issue `AUDIT: P-01`, pedido en #58 y pelota a ChatGPT.
- Después: P-02 → P-05 → P-04 → P-03. CS-0 (#59) sigue autorizado y separado; no se mezcla con P-01.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-01 handoff CAS | PR #58 | actualizado; CI corriendo |
| Proceso P-02…P-05 | #53 | después de P-01 |
| Agent Bridge (P-06) | #54 | propuesta; sin implementar |
| CS-0 Creative Studio | #59 | autorizado; brief aparte |
| E2E intermitente :17 | #26 | observabilidad #40/#41; sin reproducción |

## Pendiente de Fer
- #43: detalle de campaña para INTERNAL_APPROVER.
- Tags opcionales (el proxy los bloquea): bl31, bl07, bl08, f3a, f3a-ui.
- Protección de rama `main` con CI requerido (P-01, límite declarado).
- Ver `DECISIONES.md`.

## Referencias
- `AGENTS.md` · `docs/collab/DECISIONES.md` · `docs/collab/BACKLOG.md`
- Historial: `docs/collab/HISTORIAL.md` (solo agregar) · Briefs: `docs/briefs/` · ADR: `docs/architecture/DECISIONS.md`
