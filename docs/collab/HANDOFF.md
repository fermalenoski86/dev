# HANDOFF — estado actual

> **Regla:** foto del presente, se sobrescribe en cada turno (máx. 60 líneas).
> Decisiones vigentes en `DECISIONES.md`; eventos en `HISTORIAL.md`.

**Pelota en:** ChatGPT (auditor) — **reauditar P-02** en [PR #67](https://github.com/fermalenoski86/dev/pull/67), HEAD `65b3775`, CI [38247701037](https://github.com/fermalenoski86/dev/actions/runs/38247701037) 7/7. Issue [#68](https://github.com/fermalenoski86/dev/issues/68).
**Fase:** P-02, `PROGRESO.md` generado desde un manifiesto determinista (segundo de #53; después P-05 → P-04 → P-03).
**Estado:** ronda 1 ([AUDIT: CAMBIOS](https://github.com/fermalenoski86/dev/pull/67#issuecomment-6123953902) sobre `ca7b6df`, un P2) corregida en `65b3775`; [respuesta por punto y pedido de reauditoría](https://github.com/fermalenoski86/dev/pull/67#issuecomment-6124622965).

## Ronda 1 (corregida)
- `scripts/collab/progreso.lib.mjs:92-96`: tres evidencias inválidas pasan `validar()` y suben “equipo real” a 1/1: simulador declarado en `condiciones`, responsable ` Claude` con espacio inicial y fecha imposible `2026-99-99`.
- Normalizar campos, buscar simulación en referencia y condiciones, validar fecha gregoriana real y agregar los tres negativos como regresión.
- Reproducción, salida exacta y fundamento RFC 3339 están en el comentario de auditoría.

## Evidencia auditada
- HEAD `ca7b6df01e51c33db3df8b912b7d1100ad526e03`; CI [38238927771](https://github.com/fermalenoski86/dev/actions/runs/38238927771), intento 1, HEAD exacto y 7/7 jobs verdes.
- Auditor: `progress:check` OK; tests P-02 16/16; `diff --check` OK; prueba adversaria reproduce los 3 falsos positivos.
- No ejecutado localmente: suite completa/build/PG/media/mutaciones/E2E/compose (sí en CI exacto); `verificar-github` (sin binario `gh` local; entrega reporta 29/29).

## Próximo paso
- Claude: corregido en `65b3775` (`erroresReal`: campos recortados, simulación en referencia y condiciones, fecha de calendario; `evaluar`/`contar` solo cuentan evidencias válidas). Tests 17/17 (los 3 nuevos fallan con el lib viejo); `pnpm verify` 828+1; `verificar-github` sin cambios (29/29 en `P02_SALIDA.txt`).
- ChatGPT: reauditar el nuevo HEAD, incluidos los tres negativos y `verificar-github`; no aprobar antes.
- Con aprobación: squash a `main`, cerrar #68, agregar P-02 al manifiesto como proceso y continuar P-05.

## Abierto
| Qué | Dónde | Estado |
|---|---|---|
| P-02 progreso verificable | PR #67 / #68 | ronda 1 corregida; en reauditoría |
| P-05 → P-04 → P-03 | #53 | después de P-02 |
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
