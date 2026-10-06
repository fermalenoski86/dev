# HANDOFF — estado de la colaboración

**Pelota en:** ChatGPT (auditor) — re-auditar el PR de correcciones B2
**Fase:** M3A.1 Fase B2 — Media inspection + validation
**Estado:** `AUDIT: CAMBIOS` (issue #1) → los 2 hallazgos corregidos en el PR #2 (`fix/m3a1-b2-audit1`). Pendiente re-auditoría. **B3 no se inicia hasta `AUDIT: APROBADO` de B2.**

## Correcciones (hechas, a verificar)
1. [P1] `scripts/mutation-check.py:222–225`: devolver salida no cero si sobrevive un mutante; distinguir errores de infraestructura de mutaciones atrapadas.
2. [P2] `packages/platform-media/src/ffmpeg.ts:19,26–29,45–46`: evitar falso ASSET_CORRUPT en MP4 válido de un frame, sin requiredDurationMs; agregar regresión real 25/30 fps.

Respuesta punto por punto: `docs/reviews/M3A1_FASE_B2_AUDIT1.md` · salida real: `docs/reviews/M3A1_FASE_B2_AUDIT1_SALIDA.txt`.

## Gates verificados por ChatGPT (auditoría #1)
- pnpm 12.5.1 install, verify (596 passed + 1 skipped; 0 errores lint), build: OK.
- Media real: 48/48. Mutaciones completas: 107/107 atrapadas. Storage B1: 24 passed; S3 sin MinIO skipped.
- Entorno Node 24.19.0 / ffmpeg 6.1.1: no certifica Node 22.
- PostgreSQL/bootstrap pendientes: faltan servidor y usuario postgres en el entorno del auditor.
- M2C Playwright pendiente: descarga Chromium falló por ZIP truncado.

## Qué auditar
- Brief: `docs/briefs/M3A1_FASE_B2.md`
- Reporte: `docs/reviews/M3A1_FASE_B2.md` (criterio de cierre §30 punto por punto)
- Salida real: `docs/reviews/M3A1_FASE_B2_SALIDA.txt`
- Diseño: `docs/platform/MEDIA.md`, ADR-054
- Código: `packages/platform-media/`, `packages/platform-contracts/src/asset-rejection.ts`

## Decisiones de Claude a validar
1. Archivo vacío → `ASSET_EMPTY` (no NO_VIDEO/CORRUPT).
2. MP4 = demuxer mp4 + `major_brand` ISO BMFF (MOV comparte demuxer).
3. Carátulas `attached_pic` no cuentan como pista de video.
4. fps decide `r_frame_rate`; `avg_frame_rate` solo se guarda.
5. Decode sin `-err_detect explode`.

## Pregunta abierta (decisión de producto)
H.264 10 bits / 4:4:4 pasa la política actual. ¿Exigir `yuv420p`?

## Siguiente (después de aprobar B2)
B3 — DB integration: migración 0002 (`rejection_detail jsonb`, `container`,
consistencia READY ↔ StoredObject), AssetUploadService, idempotencia, audit.

## Historial
- 2026-10-06 — ChatGPT: auditoría de f3b55461600246f324c427edef091967e74e4944 publicada: CAMBIOS, 2 hallazgos reproducidos. B3 pendiente.
- 2026-10-06 — Claude: B2 entregada (48/48 reales, 9/9 mutaciones, M2C 14/14).
- 2026-10-06 — Claude: los dos corregidos (PR #2); gates completos: media 53/53, mutaciones 109/109, verify, build, PG 48+6, bootstrap 6/6, E2E 14/14. Pide re-auditoría.
