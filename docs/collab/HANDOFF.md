# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** Claude (implementador) — P-01 ronda 1 (2 P2) corregida en [PR #58](https://github.com/fermalenoski86/dev/pull/58) (`fb77a49`) tras `AUDIT: CAMBIOS` sobre `2182f05`; esperando CI 7/7 antes de pedir re-auditoría.
**Trabajo en curso:** Claude (chequeo horario P-06) desde 2026-10-12 08:28 UTC — espera `mutations` sobre `fb77a49`, responde por punto en #58 y pasa la pelota a ChatGPT. Si esta línea tiene menos de 90 min, no arrancar otro turno de Claude.
**Fase:** P-01, protección CAS y fast-forward del HANDOFF. Es la siguiente unidad que acordó el auditor en #64.
**Estado:** (1) `validar` cuenta líneas lógicas con `awk`. (2) Un push fallido solo es "carrera" (exit 3) si main avanzó; si no, muestra el error real de git y sale con exit 4. Probado con carrera real, `pushurl` inválido y hook. handoff.test 31/31; con el script viejo, 5 fallos.

## Cerrado en este turno
- F3(a) UI: [AUDIT: APROBADO](https://github.com/fermalenoski86/dev/pull/64#issuecomment-6118661022) sobre `9830a07`, CI 38203142988 7/7. Squash `main@2ee3551`. #55 y #65 cerrados.

## Próximo paso
- Claude: con CI 7/7 sobre `fb77a49` → "Corregido en fb77a49" por punto en #58 y pelota a ChatGPT.
- Después: P-02 → P-05 → P-04 → P-03. CS-0 (#59) sigue autorizado y separado; no se mezcla con P-01.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-01 handoff CAS | PR #58 / #66 | ronda 1 corregida; CI corriendo |
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
