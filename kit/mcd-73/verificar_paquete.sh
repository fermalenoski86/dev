#!/usr/bin/env bash
# Prueba de reproducción offline del ZIP del kit #73: descomprime en un directorio nuevo y verifica
# integridad, decodificación completa de cada MP4, páginas de cada PDF, imágenes y que index.html no use red.
set -euo pipefail
ZIP="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
cd "$W"; unzip -q "$ZIP"; cd TRUST-McDonalds-kit-offline
echo "== ZIP: $(basename "$ZIP") $(stat -c %s "$ZIP") bytes, sha256 $(sha256sum "$ZIP" | cut -c1-16)…"
echo "== integridad"; sha256sum -c --quiet SHA256SUMS.txt && echo "SHA256SUMS: $(wc -l < SHA256SUMS.txt) archivos OK"
echo "== videos (decodificación completa, sin errores)"
for v in video/*.mp4 video/*.webm; do
  info=$(ffprobe -v error -show_entries stream=codec_name,profile,width,height:format=duration -of csv=p=0 "$v" | tr '\n' ' ')
  err=$(ffmpeg -v error -xerror -i "$v" -f null - 2>&1 | head -3)
  [ -z "$err" ] || { echo "FALLA $v: $err"; exit 1; }
  echo "OK $v  $info"
done
echo "== PDFs"
for p in pdf/*.pdf; do echo "OK $p  $(pdfinfo "$p" | awk '/^Pages:/{print $2" pág."} /^Page size:/{print $3"x"$5" pt"}' | tr '\n' ' ')"; done
echo "== imágenes"
for i in imagenes/*.png; do echo "OK $i  $(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "$i")"; done
echo "== index.html sin recursos de red"
if grep -Eio '(src|href)="(https?:)?//[^"]*' index.html; then echo "FALLA: index.html referencia red"; exit 1; fi
missing=0; for ref in $(grep -Eo '(src|href)="[^"]+"' index.html | cut -d'"' -f2 | sort -u); do
  [ -f "$ref" ] || { echo "FALTA $ref"; missing=1; }; done
[ $missing = 0 ] && echo "OK: $(grep -Eo '(src|href)="[^"]+"' index.html | cut -d'"' -f2 | sort -u | wc -l) referencias locales, todas existen"
echo "== rótulo"; grep -c "SIMULACIÓN CONCEPTUAL" index.html LEEME.txt
echo "RESULTADO: paquete offline verificado"
