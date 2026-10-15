#!/bin/bash
# P-04 · Plazo de los gates del job, para que un timeout deje evidencia (AUDIT #75).
# Cuando GitHub corta un job por `timeout-minutes` interrumpe el paso activo y run.sh nunca llega a
# escribir la cola ni el log sanitizado. Este paso (el primero después del checkout) fija
# P04_PLAZO_FIN = ahora + timeout-minutes del job − margen; run.sh corta el gate en ese momento
# (exit 124), publica entorno + cola y deja el log, y al job le queda el margen para el paso de
# entorno y el upload del artifact. No cambia ningún umbral: el plazo sale del mismo
# `timeout-minutes` de gates.yml (la foto de politica-fallas.sh) y siempre es menor.
#   margen = min(P04_MARGEN [180 s], un cuarto del timeout del job)
# Los pasos que no pasan por run.sh (setup, acciones `uses:`) los cubre vigia.sh: si hay un
# Runner.Worker entre los ancestros (en CI siempre; P04_VIGIA_RAIZ lo fuerza en la prueba), queda
# en segundo plano y corta el paso que siga colgado en P04_PLAZO_FIN + gracia (AUDIT #75 sobre e40c115).
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
RAIZ=${P04_VIGIA_RAIZ:-}
if [ -z "$RAIZ" ]; then
  p=$$
  while [ -n "$p" ] && [ "$p" -gt 1 ]; do
    [ "$(cat "/proc/$p/comm" 2>/dev/null)" = Runner.Worker ] && { RAIZ=$p; break; }
    p=$(awk '/^PPid:/{print $2}' "/proc/$p/status" 2>/dev/null)
  done
fi
if [ -n "$RAIZ" ]; then
  P04_VIGIA_RAIZ=$RAIZ setsid nohup "$AQUI/vigia.sh" "$FIN" "$MARGEN" > /dev/null 2>&1 < /dev/null &
  echo "plazo: vigía $! sobre el paso activo (hijos de $RAIZ) para lo que no pasa por run.sh"
else
  echo "plazo: sin Runner.Worker entre los ancestros: sin vigía (fuera de CI)"
fi
