#!/bin/bash
# P-04 · Una línea con el entorno del runner, para correlacionar fallas sin bajar logs
# (#26: separar "test con carrera" de "runner lento" llevó dos días por falta de esto).
#   uso: scripts/ci/entorno.sh                 → imprime la línea
#        scripts/ci/entorno.sh --notice <tít>  → además ::notice con esa línea
#        scripts/ci/entorno.sh --error  <tít>  → además ::error (falla fuera de un gate) y deja
#                                               $P04_LOGS/entorno.txt (default test-results/ci/) para
#                                               que el artifact exista aunque ningún gate haya corrido;
#                                               con $P04_LOGS/plazo-vencido.txt (vigia.sh) lo agrega
# Herramientas ausentes → n/d; nunca falla.
AQUI=$(cd "$(dirname "$0")" && pwd)
v() { command -v "$1" >/dev/null 2>&1 && "$@" 2>/dev/null | head -1 | tr -d '\r' || echo n/d; }
sha=$(git rev-parse HEAD 2>/dev/null || echo n/d)
# en pull_request el checkout es el merge sintético: el HEAD auditado viene aparte (gates.yml)
head=${P04_HEAD_SHA:-$sha}
node=$(v node -v)
pnpm=$(v pnpm -v)
chrome=$(v google-chrome --version | sed -E 's/^Google Chrome //;s/[[:space:]]+$//'); [ -n "$chrome" ] || chrome=n/d
ffmpeg=$(v ffmpeg -version | sed -nE 's/^ffmpeg version ([^ ]+).*/\1/p'); [ -n "$ffmpeg" ] || ffmpeg=n/d
PSQL=$(command -v psql 2>/dev/null || ls /usr/lib/postgresql/*/bin/psql 2>/dev/null | tail -1)
pg=$( [ -n "$PSQL" ] && "$PSQL" --version 2>/dev/null | sed -nE 's/^psql \(PostgreSQL\) ([^ ]+).*/\1/p'); [ -n "$pg" ] || pg=n/d
carga=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo n/d)
LINEA="sha=$sha head=$head run=${GITHUB_RUN_ID:-n/d}/${GITHUB_RUN_ATTEMPT:-n/d} job=${GITHUB_JOB:-n/d} ImageOS=${ImageOS:-n/d} ImageVersion=${ImageVersion:-n/d} node=$node pnpm=$pnpm chrome=$chrome ffmpeg=$ffmpeg postgres=$pg nproc=$(nproc 2>/dev/null || echo n/d) loadavg=$carga"
LINEA=$(printf '%s' "$LINEA" | "$AQUI/sanitizar.sh")
echo "$LINEA"
case "$1" in
  --notice) echo "::notice title=$2::$LINEA" ;;
  --error)  DIR=${P04_LOGS:-test-results/ci}
            # si vigia.sh cortó un paso colgado (plazo del job vencido fuera de un gate), su evidencia
            # va en la misma anotación: qué procesos estaban corriendo (AUDIT #75 sobre e40c115)
            if [ -s "$DIR/plazo-vencido.txt" ]; then
              echo "::error title=$2 — plazo del job vencido (vigía)::$LINEA%0A$(head -40 "$DIR/plazo-vencido.txt" | "$AQUI/sanitizar.sh" | sed ':a;N;$!ba;s/%/%25/g;s/\r/%0D/g;s/\n/%0A/g')"
            else echo "::error title=$2::$LINEA"; fi
            { mkdir -p "$DIR" && printf '%s\n%s\n' "$2" "$LINEA" > "$DIR/entorno.txt"; } 2>/dev/null || true ;;
esac
exit 0
