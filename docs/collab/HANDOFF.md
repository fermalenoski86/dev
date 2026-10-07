# HANDOFF — estado de la colaboración

**Pelota en:** ChatGPT (auditor)
**Fase:** M3A.1 Fase B2 — Media inspection + validation
**Estado:** Claude entregó las correcciones y pidió re-auditoría en el [PR #2](https://github.com/fermalenoski86/dev/pull/2). Pendiente de verificación independiente por ChatGPT. **B3 no se inicia hasta `AUDIT: APROBADO` de B2.**

## Objetivo autorizado por Fer — 2026-10-06
Continuar Claude + ChatGPT hasta completar todo el alcance pensado y documentado del proyecto TRUST, fase por fase. Claude implementa y ChatGPT audita. Después de aprobar una fase, continuar con la siguiente ya definida en los briefs/roadmap, sin pedir confirmación rutinaria. No inventar requisitos ausentes; las decisiones de producto pendientes siguen el proceso de AGENTS.md. Mantener los gates y las partes congeladas. Esta autorización no aprueba B2 ni cambia quién tiene la pelota.

Turnos acordados (Buenos Aires): Claude a las :56 de horas impares; ChatGPT a las :56 de horas pares. Cada agente lee el HANDOFF y trabaja solo cuando tiene la pelota.

## Entrega activa para auditar
- PR: [#2](https://github.com/fermalenoski86/dev/pull/2)
- Rama: `fix/m3a1-b2-audit1`
- Commit entregado: `91956d538322fa40ae94663593e7725924e89345` (comprobar el HEAD actual antes de auditar).
- Reporte de correcciones: `docs/reviews/M3A1_FASE_B2_AUDIT1.md`, en la rama del PR.
- Salida reportada por Claude: `docs/reviews/M3A1_FASE_B2_AUDIT1_SALIDA.txt`, en la rama del PR. No equivale a aprobación del auditor.

## Regla de entrega para evitar turnos perdidos
`docs/collab/HANDOFF.md` en `main` es la autoridad para asignar el turno. Al terminar una entrega, Claude debe actualizarlo en `main` con **Pelota en: ChatGPT**, el PR, su rama y el commit a revisar; actualizar solo la copia en la rama del PR no transfiere el turno. ChatGPT audita el código de esa rama, publica el resultado y devuelve la pelota en `main` a Claude. Releer el archivo y usar su SHA vigente para no sobrescribir actualizaciones concurrentes. No hay aprobación automática por cambio de turno.

## Hallazgos anteriores a verificar en el PR #2
1. [P1] `scripts/mutation-check.py:222–225`: devolver salida no cero si sobrevive un mutante; distinguir errores de infraestructura de mutaciones atrapadas.
2. [P2] `packages/platform-media/src/ffmpeg.ts:19,26–29,45–46`: evitar falso ASSET_CORRUPT en MP4 válido de un frame, sin requiredDurationMs; agregar regresión real 25/30 fps.

Claude afirma haber corregido ambos hallazgos en el PR #2 y pidió nueva auditoría. Verificar código, regresiones y evidencia antes de cerrar los hallazgos.

## Gates verificados por ChatGPT
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
- 2026-10-07 — ChatGPT: alinea el HANDOFF de main con el pedido de re-auditoría de Claude en el PR #2; pelota en ChatGPT, sin aprobación de B2.
- 2026-10-06 — ChatGPT: auditoría de f3b55461600246f324c427edef091967e74e4944 publicada: CAMBIOS, 2 hallazgos reproducidos. B3 pendiente.
- 2026-10-06 — Claude: B2 entregada (48/48 reales, 9/9 mutaciones, M2C 14/14).
