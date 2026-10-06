# Inspección y validación de medios — M3A.1 Fase B2

Paquete: `packages/platform-media`. **No** crea StoredObject, no promueve el
temporal y no toca el Asset: eso es B3.

```
temporal (ObjectStorage) → materializar (copia verificada) → ¿vacío?
  → ffprobe → normalizar → validar contra EL_TRUST → decodificar 1 frame → resultado
```

## Piezas

| Pieza | Rol |
|---|---|
| `MediaSource` | Única frontera con paths locales. `ObjectStorageTempSource` copia el temporal (disco **o S3**, vía `readTemporary`) a un archivo UUID 0600 en un dir 0700 de un solo uso, **verifica sha256 y tamaño** contra el temporal y lo borra al terminar. `LocalPathSource`: solo archivos regulares (tests/herramientas). |
| `FfprobeMediaInspector` | ffprobe → JSON → `NormalizedMediaInfo`. |
| `MediaValidator` (`validateMedia`) | **Puro**. Compara contra `deriveSurfaceFormats(EL_TRUST)`. |
| `FfmpegFrameDecoder` | Decodifica un frame real. |
| `runProcess` | `spawn` con `shell:false`, timeout con SIGKILL, cancelación, stdout acotado, cola de stderr; resuelve en `close` (proceso reapeado, sin zombie). |
| `ConcurrencyLimiter` | Máx. `MEDIA_INSPECTION_CONCURRENCY` procesos vivos; cola FIFO; cancelable mientras espera. |
| `checkMedia` | Orquesta todo. |

**Por qué se materializa y no se usa un pipe:** un MP4 con el índice (`moov`) al
final no se puede inspeccionar desde un stream: ffprobe necesita acceso
aleatorio. La copia se verifica byte a byte por sha256: se inspecciona
exactamente lo subido. Funciona igual con S3 (no ejecutado sin MinIO).

## Matriz de validación

Orden determinista; se reporta el **primer** fallo.

| # | Chequeo | Regla | Código | Detalle |
|---|---|---|---|---|
| 0 | Tamaño | > 0 bytes | `ASSET_EMPTY` | `sizeBytes` |
| 1 | Lectura (ffprobe) | exit 0 y JSON válido | `ASSET_CORRUPT` | `stage: probe`, `reason` |
| 2 | Contenedor | demuxer mov/mp4 **y** `major_brand` ISO BMFF (`isom, iso2–6, mp41, mp42, avc1, M4V, M4VP, dash, msnv`) | `ASSET_BAD_CONTAINER` | `formatName`, `majorBrand` |
| 3 | Pistas de video | exactamente 1 utilizable (carátulas `attached_pic` no cuentan) | `ASSET_NO_VIDEO` / `ASSET_MULTIPLE_VIDEO_STREAMS` | `videoStreamCount` |
| 4 | Codec | H.264 (`h264`→`H264`) | `ASSET_BAD_CODEC` | `expected`, `actual` |
| 5 | Resolución | exacta según `deriveSurfaceFormats(EL_TRUST)` | `ASSET_BAD_RESOLUTION` | `expected`, `actual`, `surfaceType` |
| 6 | Framerate | `r_frame_rate` reducido **igual** a 25/1 o 30/1 | `ASSET_BAD_FPS` | `accepted`, `actual`, `reason` |
| 7 | Duración | > 0; ≥ `requiredDurationMs` si se pasa | `ASSET_CORRUPT` / `ASSET_TOO_SHORT` | `requiredDurationMs`, `actualDurationMs` |
| 8 | Decode | exit 0 y > 0 bytes de un frame | `ASSET_CORRUPT` | `stage: decode` |
| — | Tiempo | probe y decode con timeout | `ASSET_INSPECTION_TIMEOUT` | `stage`, `timeoutMs` |

Resoluciones actuales (derivadas, no escritas en el validador):
`towers_ab` 2592×576 · `screen_a` 1152×576 · `screen_b` 1440×576 · `horizontal` 1920×412.

### Decisiones de política

- **fps:** solo 25/1 y 30/1 exactos, comparados como racionales reducidos. Se
  rechazan 30000/1001 (29.97), 24000/1001, 24, 50, 60 y framerates inválidos
  (`0/0`). Sin tolerancia en float. `avg_frame_rate` se guarda para diagnóstico,
  no decide.
- **Duración:** manda la de la pista de video; si falta, la del contenedor. Se
  convierte a ms **truncando** desde el texto decimal (sin float): lo
  conservador para "¿cubre lo requerido?".
- **Archivo vacío:** `ASSET_EMPTY` (código de la lista general de Fase B; es la
  causa exacta). Se detecta antes de lanzar procesos.
- **MOV renombrado:** ffprobe reporta el mismo `format_name` para MOV y MP4. Solo
  el `major_brand` (`qt  `) lo distingue. Sin brand o con brand fuera de la
  lista: no es MP4.
- **Audio:** puede existir; no afecta B2.
- **MIME canónico:** `video/mp4`, decidido por la inspección. Nunca el del cliente.
- **Punto de decode:** `min(100 ms, duración/2)`, en la pista de video
  utilizable (no la carátula).

### Observación para decidir (no cambia la política actual)

H.264 de **10 bits** (High 10) o con `yuv444p` pasa la política actual: es H.264.
Muchos players/controladoras LED solo reproducen 8 bits 4:2:0. `pixelFormat` y
`profile` ya se guardan; si se quiere exigir `yuv420p`, es un chequeo más.

## Seguridad de procesos

- `spawn(bin, [args])`, `shell:false`. El path va como `file:<path>` y
  `-protocol_whitelist file`: un path no puede interpretarse como `concat:`,
  `http:` u otro protocolo de ffmpeg.
- El inspector recibe un path interno (UUID); nunca el nombre original.
- Timeout → SIGKILL y espera de `close`: el pid desaparece de `/proc`.
- stdout de ffprobe ≤ 1 MB; frame ≤ 16 MB; stderr: cola de 16 KB, y al log
  solo 2 KB **sin el path de entrada**. Nada de stderr llega al cliente.

## Fixtures

`packages/platform-media/scripts/make-fixtures.sh <dir>` — 20 archivos, ~4 s,
**deterministas** (dos generaciones dan los mismos sha256). Nada binario en el
repo: los tests los generan y cachean por hash del script.

| Fixture | Comando clave (ver script) | Espera |
|---|---|---|
| valid_towers_ab_25 | `testsrc2=size=2592x576:rate=25` libx264 yuv420p | OK |
| valid_horizontal_30 | `size=1920x412:rate=30` | OK |
| valid_screen_a_25 | `size=1152x576:rate=25` | OK |
| valid_horizontal_25_audio | + `sine` → aac | OK |
| valid_with_cover_art | + PNG `-disposition:v:1 attached_pic` | OK |
| bad_resolution | `size=1920x1080` | BAD_RESOLUTION |
| bad_codec_hevc | libx265 `-tag:v hvc1` | BAD_CODEC |
| bad_fps_2997 / 23976 / 50 | `rate=30000/1001` / `24000/1001` / `50` | BAD_FPS |
| too_short | `duration=0.4` (+ requerido 1000 ms) | TOO_SHORT |
| bad_container_mkv / avi / mov | `-f matroska` / `-f avi` / `-f mov`, todos `.mp4` | BAD_CONTAINER |
| multiple_video_streams | `-map 0:v -map 1:v` | MULTIPLE_VIDEO_STREAMS |
| no_video_audio_only | solo aac | NO_VIDEO |
| empty | 0 bytes | EMPTY |
| random_bytes | 64 KB pseudoaleatorios (semilla fija) | CORRUPT (probe) |
| truncated_header | primeros 512 bytes | CORRUPT (probe) |
| corrupt_frames | `moov` intacto, `mdat` reemplazado | **pasa probe**, CORRUPT (decode) |

`corrupt_frames` es la prueba de por qué hay **dos** compuertas: ffprobe le
devuelve metadata perfecta (H.264, 1920×412, 30 fps, 2 s) y exit 0; solo el
decode lo detecta.

## Configuración

| Variable | Default | |
|---|---|---|
| `MEDIA_PROBE_TIMEOUT_MS` | 15000 | |
| `MEDIA_DECODE_TIMEOUT_MS` | 20000 | |
| `MEDIA_INSPECTION_CONCURRENCY` | 2 | procesos externos vivos a la vez |
| `MEDIA_SCRATCH_DIR` | `$TMPDIR/trust-media-scratch` | 0700, fuera de cualquier dir web |
| `FFPROBE_PATH` / `FFMPEG_PATH` | `ffprobe` / `ffmpeg` | |

Valores inválidos fallan al arrancar.
