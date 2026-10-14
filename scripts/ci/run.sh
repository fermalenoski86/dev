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
# la salida cruda va al log del job sin sanitizar: con los comandos de workflow frenados,
# un `::error::PASSWORD=…` del comando no se vuelve anotación (solo publican las nuestras,
# ya sanitizadas). Token impredecible: el comando no puede reactivarlos.
FRENO=p04-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
# Plazo del job (plazo.sh, AUDIT #75): el gate se corta antes del timeout-minutes para que este
# script llegue a publicar entorno + cola y dejar el log (si GitHub cancela el job, no llega).
# `timeout` manda la señal a todo el grupo de procesos del gate (hijos incluidos).
PLAZO=
if [ -n "${P04_PLAZO_FIN:-}" ]; then
  PLAZO=$(( P04_PLAZO_FIN - $(date +%s) ))
  if [ "$PLAZO" -le 0 ]; then set -- bash -c 'echo "run.sh: el job ya agotó su plazo (P04_PLAZO_FIN) antes de este gate: no se corre"; exit 124'
  else set -- timeout --kill-after=10 "$PLAZO" "$@"; fi
fi
echo "::stop-commands::$FRENO"
"$@" 2>&1 | tee "$LOG"
# los dos códigos, inmediatamente: si `tee` no puede escribir el log (disco lleno, ruta inválida,
# mktemp fallido) el gate no puede quedar verde sin log (AUDIT #75 sobre 15f7c8a)
EST=("${PIPESTATUS[@]}"); RC=${EST[0]}; RC_TEE=${EST[1]:-1}
echo "::$FRENO::"
POR_PLAZO=
NOTA=
if [ "$RC_TEE" != 0 ]; then
  NOTA="run.sh: no se pudo escribir el log del gate (tee exit $RC_TEE): falta la copia completa; la salida cruda quedó solo en el log del job"
  POR_PLAZO=", log no escrito"
  [ "$RC" = 0 ] && RC=$RC_TEE
fi
# 124/137 cuentan como plazo solo si el plazo efectivamente venció: un SIGKILL externo (OOM) o un
# 124 propio del comando con tiempo de sobra no se rotula TIMEOUT (Codex #75 sobre ecb774f)
if [ -n "$PLAZO" ] && { [ "$RC" = 124 ] || [ "$RC" = 137 ]; } && [ "$(date +%s)" -ge "$P04_PLAZO_FIN" ]; then
  POR_PLAZO="$POR_PLAZO, plazo del job"
  echo "run.sh: TIMEOUT — el gate superó el plazo del job (${PLAZO}s; timeout-minutes menos el margen de plazo.sh) y se cortó (exit $RC)" 2>/dev/null >> "$LOG"
elif [ "$RC" = 137 ]; then
  POR_PLAZO="$POR_PLAZO, SIGKILL"
  echo "run.sh: SIGKILL — el gate murió por SIGKILL antes del plazo del job (OOM u otra señal externa; exit 137)" 2>/dev/null >> "$LOG"
fi
limpio() { { sed 's/\x1b\[[0-9;]*[A-Za-z]//g' "$LOG" 2>/dev/null; [ -z "$NOTA" ] || echo "$NOTA"; } | "$AQUI/sanitizar.sh"; }
codifica() { printf '%s' "$1" | sed ':a;N;$!ba;s/%/%25/g;s/\r/%0D/g;s/\n/%0A/g'; }
# propiedades (title=…): además `:` y `,` (GitHub corta el título en la primera coma: run 38342453191)
prop() { codifica "$1" | sed 's/:/%3A/g;s/,/%2C/g'; }
ENT=$("$AQUI/entorno.sh")
# copia sanitizada de la salida completa (artifact al fallar, P-04)
DIR=${P04_LOGS:-test-results/ci}
mkdir -p "$DIR" && { echo "entorno: $ENT"; limpio; } > "$DIR/$(printf '%s' "$TITULO" | tr -c 'A-Za-z0-9._-' '_').log"
# resumen siempre (también en verde): líneas de conteo de tests
RES=$(limpio | grep -aE 'Tests  |Test Files|[0-9]+ (passed|failed)|ATRAPADA|SOBREVIVE|SIN SALIDA|TIMEOUT|TODAS|GATE|atrapadas|paralelo:' | grep -avE '^\s*ATRAPADA' | tail -15)
echo "::notice title=$(prop "$TITULO (exit $RC)")::$(codifica "entorno: $ENT
$RES")"
if [ "$RC" != 0 ]; then
  COLA=$(limpio | grep -av '^\s*$' | tail -60 | cut -c1-300)
  echo "::error title=$(prop "$TITULO falló (exit $RC$POR_PLAZO)")::$(codifica "entorno: $ENT
$COLA")"
  # marca para el paso final del job: la falla ya quedó anotada con entorno y cola
  touch "${RUNNER_TEMP:-/tmp}/p04-anotado" 2>/dev/null || true
fi
exit "$RC"
