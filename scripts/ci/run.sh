#!/bin/bash
# Corre un gate en CI. Publica como anotación de GitHub (legible por API sin descargar
# logs: los agentes no siempre pueden bajar los logs crudos) el resumen y, si falla,
# las últimas líneas de salida. P-04: la anotación lleva primero la línea de entorno
# (SHA, imagen del runner, versiones) y todo pasa por sanitizar.sh; la salida completa
# queda sanitizada en test-results/ci/<título>.log para subirla como artifact.
#   uso: scripts/ci/run.sh "<título>" <comando> [args…]
set -o pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
TITULO=$1; shift
LOG=$(mktemp)
"$@" 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
limpio() { sed 's/\x1b\[[0-9;]*[A-Za-z]//g' "$LOG" | "$AQUI/sanitizar.sh"; }
codifica() { printf '%s' "$1" | sed ':a;N;$!ba;s/%/%25/g;s/\r/%0D/g;s/\n/%0A/g'; }
ENT=$("$AQUI/entorno.sh")
# copia sanitizada de la salida completa (artifact al fallar, P-04)
DIR=${P04_LOGS:-test-results/ci}
mkdir -p "$DIR" && { echo "entorno: $ENT"; limpio; } > "$DIR/$(printf '%s' "$TITULO" | tr -c 'A-Za-z0-9._-' '_').log"
# resumen siempre (también en verde): líneas de conteo de tests
RES=$(limpio | grep -aE 'Tests  |Test Files|[0-9]+ (passed|failed)|ATRAPADA|SOBREVIVE|SIN SALIDA|TIMEOUT|TODAS|GATE|atrapadas|paralelo:' | grep -avE '^\s*ATRAPADA' | tail -15)
echo "::notice title=$TITULO (exit $RC)::$(codifica "entorno: $ENT
$RES")"
if [ "$RC" != 0 ]; then
  COLA=$(limpio | grep -av '^\s*$' | tail -60 | cut -c1-300)
  echo "::error title=$TITULO falló (exit $RC)::$(codifica "entorno: $ENT
$COLA")"
  # marca para el paso final del job: la falla ya quedó anotada con entorno y cola
  touch "${RUNNER_TEMP:-/tmp}/p04-anotado" 2>/dev/null || true
fi
exit "$RC"
