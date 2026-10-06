# M3A.1 — Fase B2: inspección y validación de medios — checkpoint

**Estado:** entregado para auditoría. **B3 no iniciado.** Storage (B1/B1.1) sin cambios.

## Resultados (ejecución real, 2026-10-06)

| Gate | Resultado |
|---|---|
| B2 real — ffprobe 6 / ffmpeg reales, sin mocks | **48/48** (33 matriz + 15 procesos/seguridad) |
| B2 puro (racional, validador, limitador) | 24/24 |
| B1/B1.1 storage | 24 passed + 1 skipped (contrato S3: sin MinIO) |
| `pnpm verify` (suite default + lint + typecheck) | 596 passed + 1 skipped; lint 0 errores (11 warnings preexistentes) |
| `pnpm build` | exit 0 (control y previs) |
| PostgreSQL 16 real | 48 passed + 6 skipped (los 6 = bootstrap, corren por script) |
| Bootstrap real (psql + bootstrap.sql) | 6/6 |
| Mutaciones B2 (98–106) | **9/9 atrapadas** |
| M2C E2E congelado (Chromium real) | **14/14** (1.3 min) |

Salida completa: `M3A1_FASE_B2_SALIDA.txt`.

## Criterio de cierre (§30)

| # | Criterio | Evidencia |
|---|---|---|
| 1 | ffprobe REAL inspecciona MP4 real | matriz real, 21 filas |
| 2 | metadata normalizada | test "metadata normalizada" (container, codec, fps racional, ms, pistas, pix_fmt) |
| 3 | H.264 aceptado | valid_* → OK |
| 4 | codec incorrecto rechazado | HEVC → BAD_CODEC; mutación "HEVC aceptado" atrapada |
| 5 | 25/30 exactos aceptados | towers 25, horizontal 30 |
| 6 | 29.97 rechazado | 30000/1001, 24000/1001, 50 → BAD_FPS; mutación float atrapada |
| 7 | resolución desde EL_TRUST | test de autoridad (modelo mutado) + test estático sin literales; mutación "hardcodeado" atrapada |
| 8 | duración validada | too_short con y sin `requiredDurationMs` |
| 9 | ffmpeg REAL decodifica un frame | bytes JPEG > 0; mutación "decode omitido" atrapada |
| 10 | corrupto rechazado | empty, random, truncated (probe) y corrupt_frames (decode) |
| 11 | timeout mata el proceso | FIFO real cuelga ffprobe/ffmpeg → SIGKILL, pid ausente de `/proc` |
| 12 | filenames hostiles no llegan al shell | `; rm -rf /`, `$(…)`, backticks, comillas, unicode, espacios → CANARY no creado |
| 13 | concurrencia limitada | 8 inspecciones, límite 2 → pico 2, 6 en cola; 4 colgadas → 2 procesos vivos |
| 14 | B1 intacta | storage 24/24, sin diff en `packages/platform-storage/src` |

## Decisiones tomadas (para validar en la auditoría)

1. **Vacío → `ASSET_EMPTY`**, no NO_VIDEO/CORRUPT: el código ya existía en la lista de Fase B y es la causa exacta. Se detecta sin lanzar procesos.
2. **MP4 = demuxer mp4 + `major_brand` ISO BMFF.** Sin esto un `.mov` pasaba (mismo `format_name`). Un MP4 sin brand se rechaza.
3. **Carátulas (`attached_pic`) no cuentan como pista de video**; si no, un MP4 con portada daba MULTIPLE falso.
4. **fps decide `r_frame_rate`**; `avg_frame_rate` solo se guarda.
5. **Duración:** pista de video primero, contenedor como respaldo, truncada a ms desde texto.
6. **Materialización verificada** (`ObjectStorageTempSource`): copia privada con sha256 confirmado; sirve a S3 vía `readTemporary` (no ejecutado).
7. **Decode sin `-err_detect explode`**: atrapa corrupt_frames sin rechazar MP4 sanos con errores menores de bitstream.
8. **stdout de ffprobe > 1 MB → `ASSET_CORRUPT`** (no un error de infraestructura).

## Pregunta abierta

H.264 **10 bits / 4:4:4** pasa la política actual. Si los players LED solo
aceptan 8 bits 4:2:0, conviene exigir `yuv420p` (dato ya extraído). Decisión de producto.

## No hecho a propósito (B3)

StoredObject, `commitContentAddressed`, Asset READY/REJECTED, audit,
migración 0002 (`rejection_detail`, `container`), API. S3 no certificado.

## Docs

`docs/platform/MEDIA.md` (matriz, fixtures, seguridad, config) · ADR-054 ·
`.env.example` con variables de medios.
