#!/bin/bash
# P-04 · Vigía del plazo del job, para los pasos que NO pasan por run.sh (AUDIT #75 sobre e40c115, P1):
# setup (`apt-get`, `pnpm install`, `pg-up.sh`, descarga de Playwright, builds sin run.sh) y acciones
# `uses:` (setup-node). plazo.sh lo lanza en segundo plano y queda vivo entre pasos (el runner mata
# los procesos huérfanos recién al terminar el job). Duerme hasta P04_PLAZO_FIN + gracia; si para
# entonces el job no entró en su cierre (marcas `p04-final` del paso de entorno o `p04-anotado` de
# un gate que ya falló y anotó), el paso activo se colgó: deja la evidencia en
# $P04_LOGS/plazo-vencido.txt (línea de entorno + procesos del paso, sanitizados) y corta el árbol
# de procesos de ese paso (TERM, 10 s, KILL). El paso falla antes del `timeout-minutes`, así que
# `Entorno (falla fuera de un gate)` la publica como anotación y `upload-artifact` la sube con el
# margen que reservó plazo.sh. No cambia ningún umbral: corta antes del mismo `timeout-minutes`.
#   gracia = min(30 s, margen/3): los gates bajo run.sh se cortan solos en P04_PLAZO_FIN (+10 s de
#   kill-after) y anotan con su cola; el vigía llega después y solo actúa si nadie lo hizo.
#   uso: scripts/ci/vigia.sh <fin epoch> <margen s>   (lo lanza plazo.sh; no se llama a mano)
#   P04_VIGIA_RAIZ=<pid>: proceso cuyos hijos son "el paso activo" (en CI: Runner.Worker, que plazo.sh
#   busca subiendo por sus ancestros; la prueba local pasa uno propio).
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
FIN=${1:?vigia.sh: falta el fin}; MARGEN=${2:?vigia.sh: falta el margen}
GRACIA=$(( MARGEN / 3 )); [ "$GRACIA" -le 30 ] || GRACIA=30
MARCAS=${RUNNER_TEMP:-/tmp}
DIR=${P04_LOGS:-test-results/ci}
RAIZ=${P04_VIGIA_RAIZ:?vigia.sh: falta P04_VIGIA_RAIZ}
ESPERA=$(( FIN + GRACIA - $(date +%s) ))
[ "$ESPERA" -le 0 ] || sleep "$ESPERA"
# sin el directorio de marcas (RUNNER_TEMP de otro proceso que ya terminó) no hay job que vigilar
[ -d "$MARCAS" ] || exit 0
[ -e "$MARCAS/p04-final" ] || [ -e "$MARCAS/p04-anotado" ] && exit 0
kill -0 "$RAIZ" 2>/dev/null || exit 0
# el paso activo = hijos directos de la raíz, salvo este vigía; su árbol completo
arbol() { local h; for h in $(ps -o pid= --ppid "$1" 2>/dev/null); do [ "$h" = $$ ] && continue; echo "$h"; arbol "$h"; done; }
PIDS=$(arbol "$RAIZ")
{ mkdir -p "$DIR" && {
    echo "plazo del job vencido fuera de un gate: el vigía cortó el paso activo a las $(date -u +%H:%M:%SZ) (P04_PLAZO_FIN + ${GRACIA}s)"
    echo "entorno: $("$AQUI/entorno.sh")"
    echo "procesos del paso cortado:"
    [ -z "$PIDS" ] || ps -o pid=,etime=,args= -p "$(echo $PIDS | tr ' ' ,)" 2>/dev/null | cut -c1-300
  } | "$AQUI/sanitizar.sh" > "$DIR/plazo-vencido.txt"; } 2>/dev/null || true
[ -n "$PIDS" ] || exit 0
kill -TERM $PIDS 2>/dev/null
vivos() { local p; for p in $PIDS; do kill -0 "$p" 2>/dev/null && return 0; done; return 1; }
for _ in $(seq 1 10); do sleep 1; vivos || exit 0; done
kill -KILL $PIDS 2>/dev/null
exit 0
