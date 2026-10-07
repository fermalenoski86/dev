#!/bin/bash
# Fixtures de MEDIA para M3A.1 Fase B2 — generados con ffmpeg, deterministas,
# sin contenido comercial (solo patrones de test). NO se commitean binarios:
# los tests llaman a este script en el setup.
#
#   bash make-fixtures.sh <dir_destino>
#
# Duración corta (2 s) y resoluciones reales del edificio. -bitexact +
# -fflags +bitexact + metadata vacía hacen la salida reproducible.
set -euo pipefail
OUT=${1:?uso: make-fixtures.sh <dir>}
mkdir -p "$OUT"
FF=(ffmpeg -hide_banner -loglevel error -y)
BIT=(-fflags +bitexact -flags:v +bitexact -map_metadata -1)
H264=(-c:v libx264 -preset ultrafast -pix_fmt yuv420p -tune zerolatency -x264-params "threads=1")

# ── válidos ──────────────────────────────────────────────────────────────
"${FF[@]}" -f lavfi -i "testsrc2=size=2592x576:rate=25:duration=2" "${H264[@]}" "${BIT[@]}" "$OUT/valid_towers_ab_25.mp4"
"${FF[@]}" -f lavfi -i "testsrc2=size=1920x412:rate=30:duration=2" "${H264[@]}" "${BIT[@]}" "$OUT/valid_horizontal_30.mp4"
"${FF[@]}" -f lavfi -i "testsrc2=size=1152x576:rate=25:duration=2" "${H264[@]}" "${BIT[@]}" "$OUT/valid_screen_a_25.mp4"
# válido con pista de audio (el audio no afecta B2)
"${FF[@]}" -f lavfi -i "testsrc2=size=1920x412:rate=25:duration=2" -f lavfi -i "sine=frequency=440:duration=2" \
  "${H264[@]}" -c:a aac -shortest "${BIT[@]}" "$OUT/valid_horizontal_25_audio.mp4"

# ── inválidos ────────────────────────────────────────────────────────────
"${FF[@]}" -f lavfi -i "testsrc2=size=1920x1080:rate=25:duration=2" "${H264[@]}" "${BIT[@]}" "$OUT/bad_resolution.mp4"
"${FF[@]}" -f lavfi -i "testsrc2=size=1920x412:rate=25:duration=2" -c:v libx265 -preset ultrafast -pix_fmt yuv420p \
  -x265-params "log-level=error:pools=1" -tag:v hvc1 "${BIT[@]}" "$OUT/bad_codec_hevc.mp4"
"${FF[@]}" -f lavfi -i "testsrc2=size=1920x412:rate=30000/1001:duration=2" "${H264[@]}" "${BIT[@]}" "$OUT/bad_fps_2997.mp4"
"${FF[@]}" -f lavfi -i "testsrc2=size=1920x412:rate=24000/1001:duration=2" "${H264[@]}" "${BIT[@]}" "$OUT/bad_fps_23976.mp4"
"${FF[@]}" -f lavfi -i "testsrc2=size=1920x412:rate=50:duration=2" "${H264[@]}" "${BIT[@]}" "$OUT/bad_fps_50.mp4"
"${FF[@]}" -f lavfi -i "testsrc2=size=1920x412:rate=25:duration=0.4" "${H264[@]}" "${BIT[@]}" "$OUT/too_short.mp4"
# MKV renombrado .mp4: H.264 válido, contenedor equivocado
"${FF[@]}" -f lavfi -i "testsrc2=size=1920x412:rate=25:duration=2" "${H264[@]}" "${BIT[@]}" -f matroska "$OUT/bad_container_mkv.mp4"
# AVI renombrado .mp4
"${FF[@]}" -f lavfi -i "testsrc2=size=1920x412:rate=25:duration=2" -c:v mpeg4 -q:v 5 "${BIT[@]}" -f avi "$OUT/bad_container_avi.mp4"
# QuickTime renombrado .mp4: MISMO demuxer y format_name que MP4; solo el
# major_brand ('qt  ') lo delata
"${FF[@]}" -f lavfi -i "testsrc2=size=1920x412:rate=25:duration=2" "${H264[@]}" "${BIT[@]}" -f mov "$OUT/bad_container_mov.mp4"
# válido con carátula embebida: la carátula es una "pista de video"
# un único frame (MP4 sano, duración 1/fps): el seek de decode cae después del
# frame; el decoder debe reintentar desde 0 (auditoría B2 #1, hallazgo 2)
for R in 25 30; do
  "${FF[@]}" -f lavfi -i "color=size=1920x412:rate=$R" -frames:v 1 "${H264[@]}" "${BIT[@]}" "$OUT/one_frame_$R.mp4"
done
# attached_pic que NO cuenta como segunda pista
"${FF[@]}" -f lavfi -i "color=red:size=320x240:duration=1" -frames:v 1 "$OUT/_cover.png"
"${FF[@]}" -i "$OUT/valid_horizontal_30.mp4" -i "$OUT/_cover.png" -map 0 -map 1 -c copy -disposition:v:1 attached_pic "${BIT[@]}" "$OUT/valid_with_cover_art.mp4"
rm -f "$OUT/_cover.png"
# dos pistas de video
"${FF[@]}" -f lavfi -i "testsrc2=size=1920x412:rate=25:duration=2" -f lavfi -i "testsrc=size=1920x412:rate=25:duration=2" \
  -map 0:v -map 1:v "${H264[@]}" "${BIT[@]}" "$OUT/multiple_video_streams.mp4"
# solo audio, contenedor mp4
"${FF[@]}" -f lavfi -i "sine=frequency=440:duration=2" -c:a aac "${BIT[@]}" "$OUT/no_video_audio_only.mp4"

# ── corrupción, por niveles ──────────────────────────────────────────────
: > "$OUT/empty.mp4"
python3 - "$OUT" <<'PY'
import sys, random, pathlib
out = pathlib.Path(sys.argv[1])
r = random.Random(20261006)
(out / 'random_bytes.mp4').write_bytes(bytes(r.getrandbits(8) for _ in range(65536)))
src = (out / 'valid_horizontal_30.mp4').read_bytes()
# header truncado: solo los primeros 512 bytes (ftyp + comienzo del moov)
(out / 'truncated_header.mp4').write_bytes(src[:512])
# metadata legible, frames destruidos: se conserva todo el moov (índice legible
# por ffprobe) y se reemplaza el contenido de mdat por basura del mismo tamaño
i = src.find(b'mdat')
if i < 4: raise SystemExit('no hay mdat')
size = int.from_bytes(src[i-4:i], 'big')
ini, fin = i + 4, i - 4 + size
basura = bytes(r.getrandbits(8) for _ in range(fin - ini))
(out / 'corrupt_frames.mp4').write_bytes(src[:ini] + basura + src[fin:])
PY
ls "$OUT" | wc -l
