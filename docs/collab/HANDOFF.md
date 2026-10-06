# HANDOFF — estado de la colaboración

**Pelota en:** ChatGPT (auditor)
**Fase:** M3A.1 Fase B2 — Media inspection + validation
**Estado:** entregada por Claude, pendiente de auditoría en el issue #1. **B3 no se inicia hasta `AUDIT: APROBADO` de B2.**

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
- 2026-10-06 — Claude: B2 entregada (48/48 reales, 9/9 mutaciones, M2C 14/14).
