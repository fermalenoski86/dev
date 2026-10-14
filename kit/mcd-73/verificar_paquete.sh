#!/usr/bin/env bash
# Prueba de reproducción offline del ZIP del kit #73: descomprime en un directorio nuevo y verifica
# integridad, decodificación completa de cada MP4, páginas de cada PDF, imágenes y que index.html no use red.
# Acepta el ZIP único o las partes (parte1 + parte2): se descomprimen todas en el mismo directorio.
set -euo pipefail
[ $# -ge 1 ] || { echo "uso: $0 <zip> [zip…]"; exit 2; }
ZIPS=(); for a in "$@"; do ZIPS+=("$(cd "$(dirname "$a")" && pwd)/$(basename "$a")"); done
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
cd "$W"; for Z in "${ZIPS[@]}"; do unzip -q -n "$Z"; done; cd TRUST-McDonalds-kit-offline
for Z in "${ZIPS[@]}"; do echo "== ZIP: $(basename "$Z") $(stat -c %s "$Z") bytes, sha256 $(sha256sum "$Z" | cut -c1-16)…"; done
echo "== integridad"
# Explícito: con `cmd && echo`, set -e no corta si falla cmd (un archivo faltante pasaba como OK).
if ! sha256sum -c --quiet SHA256SUMS.txt; then echo "FALLA: SHA256SUMS (archivo faltante o alterado)"; exit 1; fi
echo "SHA256SUMS: $(wc -l < SHA256SUMS.txt) archivos OK"
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
echo "== consola DMX virtual sin red"
if grep -Eio '(src|href)="(https?:)?//[^"]*|(fetch|WebSocket|XMLHttpRequest)\(' consola/consola.html consola/luminarias.js; then echo "FALLA: la consola usa red"; exit 1; fi
for ref in $(grep -Eo '(src|href)="[^"#]+"' consola/consola.html | cut -d'"' -f2 | sort -u); do [ -f "consola/$ref" ] || { echo "FALTA consola/$ref"; exit 1; }; done
echo "OK: consola sin red; $(grep -Eo '(src|href)="[^"#]+"' consola/consola.html | cut -d'"' -f2 | sort -u | wc -l) referencias locales existen; rótulo: $(grep -c 'NO CONECTADO A EQUIPOS REALES' consola/consola.html)"
echo "== TRUST Control sin red"
if grep -Eio '(src|href)="(https?:)?//[^"]*|\b(fetch|WebSocket|XMLHttpRequest|EventSource|RTCPeerConnection)\(' control/index.html control/*.js control/estilo.css; then echo "FALLA: TRUST Control usa red"; exit 1; fi
for ref in $(grep -Eo '(src|href)="[^"#]+"' control/index.html | cut -d'"' -f2 | sort -u); do [ -f "control/$ref" ] || { echo "FALTA control/$ref"; exit 1; }; done
[ -f control/fotos/trust-noche.jpg ] || { echo "FALTA control/fotos/trust-noche.jpg"; exit 1; }
echo "OK: TRUST Control sin red; $(grep -Eo '(src|href)="[^"#]+"' control/index.html | cut -d'"' -f2 | sort -u | wc -l) referencias locales existen; rótulo: $(grep -c 'NO CONECTADA A EQUIPOS REALES' control/index.html)"
echo "== rótulo"; grep -c "SIMULACIÓN CONCEPTUAL" index.html LEEME.txt
echo "RESULTADO: paquete offline verificado"
