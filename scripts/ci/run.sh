#!/bin/bash
# Corre un gate en CI. Si falla, publica las últimas líneas de salida como
# anotación de GitHub (legibles por API sin descargar logs: los agentes no
# siempre pueden bajar los logs crudos).
#   uso: scripts/ci/run.sh "<título>" <comando> [args…]
set -o pipefail
TITULO=$1; shift
LOG=$(mktemp)
"$@" 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
# resumen siempre (también en verde): líneas de conteo de tests
RES=$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g' "$LOG" | grep -aE 'Tests  |Test Files|[0-9]+ (passed|failed)|ATRAPADA|SOBREVIVE|SIN SALIDA|TIMEOUT|TODAS|GATE|atrapadas' | grep -avE '^\s*ATRAPADA' | tail -15)
echo "::notice title=$TITULO (exit $RC)::$(printf '%s' "$RES" | sed ':a;N;$!ba;s/%/%25/g;s/\r/%0D/g;s/\n/%0A/g')"
if [ "$RC" != 0 ]; then
  COLA=$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g' "$LOG" | grep -av '^\s*$' | tail -60 | cut -c1-300)
  echo "::error title=$TITULO falló (exit $RC)::$(printf '%s' "$COLA" | sed ':a;N;$!ba;s/%/%25/g;s/\r/%0D/g;s/\n/%0A/g')"
fi
exit "$RC"
