#!/bin/bash
# P-04 · Plazo de los gates del job, para que un timeout deje evidencia (AUDIT #75).
# Cuando GitHub corta un job por `timeout-minutes` interrumpe el paso activo y run.sh nunca llega a
# escribir la cola ni el log sanitizado. Este paso (el primero después del checkout) fija
# P04_PLAZO_FIN = ahora + timeout-minutes del job − margen; run.sh corta el gate en ese momento
# (exit 124), publica entorno + cola y deja el log, y al job le queda el margen para el paso de
# entorno y el upload del artifact. No cambia ningún umbral: el plazo sale del mismo
# `timeout-minutes` de gates.yml (la foto de politica-fallas.sh) y siempre es menor.
#   margen = min(P04_MARGEN [180 s], un cuarto del timeout del job)
#   uso: scripts/ci/plazo.sh   (en CI: GITHUB_JOB y GITHUB_ENV del runner)
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
WF=${P04_WORKFLOW:-$AQUI/../../.github/workflows/gates.yml}
JOB=${GITHUB_JOB:?plazo.sh: falta GITHUB_JOB}
MIN=$(awk -v j="  $JOB:" '/^  [a-z0-9-]+:$/{en=($0==j)} en && /^[ \t]*timeout-minutes:/{print $2; exit}' "$WF")
case "$MIN" in ''|*[!0-9]*) echo "::error title=plazo: $JOB::sin timeout-minutes numérico en $WF"; exit 1 ;; esac
TOTAL=$((MIN * 60)); MARGEN=${P04_MARGEN:-180}
[ "$MARGEN" -le $((TOTAL / 4)) ] || MARGEN=$((TOTAL / 4))
FIN=$(( $(date +%s) + TOTAL - MARGEN ))
if [ -n "${GITHUB_ENV:-}" ]; then echo "P04_PLAZO_FIN=$FIN" >> "$GITHUB_ENV"; else echo "P04_PLAZO_FIN=$FIN"; fi
echo "plazo: $JOB timeout-minutes=$MIN margen=${MARGEN}s → los gates cortan a las $(date -u -d "@$FIN" +%H:%M:%SZ)"
