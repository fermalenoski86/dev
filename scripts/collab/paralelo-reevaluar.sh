#!/usr/bin/env bash
# P-05 · Re-evaluación de TODOS los PR abiertos hacia main cuando cambia lo que el
# chequeo compara: el HEAD de la fase activa o el HANDOFF de main (auditor, AUDIT:
# CAMBIOS sobre 0f73e0c, P1: un lateral verde contra la fase S1 no puede seguir
# verde cuando la fase avanza a S2 y toca sus archivos — TOCTOU).
#
#   uso: scripts/collab/paralelo-reevaluar.sh [motivo]
#
# Por cada PR abierto hacia main corre paralelo.sh <n> <head> main con el estado
# ACTUAL de origin/main y de refs/pull/N/head, y publica el resultado como check-run
# "paralelo" sobre el HEAD de ese PR (el último check publicado es el que se ve en el
# PR y el que mira la protección de rama). Nunca escribe en ramas ni mergea.
#
# Fuentes y salidas, reemplazables para probar sin GitHub:
#   PARALELO_LISTAR    comando que imprime "<nro> <head sha>" por línea (default: gh api)
#   PARALELO_PUBLICAR  comando que recibe <nro> <sha> <conclusion:success|failure> <titulo> <detalle>
#                      (default: gh api POST check-runs con GH_TOKEN)
# Exit 0 si pudo evaluar y publicar todos; exit 1 si no pudo listar o publicar
# (entonces NO hay veredicto nuevo: el anterior queda y se avisa).
set -euo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
REMOTE=${HANDOFF_REMOTE:-origin}
BRANCH=${HANDOFF_BRANCH:-main}
REPO=${GITHUB_REPOSITORY:-}
MOTIVO=${1:-"cambio en la fase activa o en el HANDOFF"}

listar() {
  if [ -n "${PARALELO_LISTAR:-}" ]; then "${PARALELO_LISTAR}"; return; fi
  [ -n "$REPO" ] || { echo "paralelo-reevaluar: falta GITHUB_REPOSITORY" >&2; return 1; }
  gh api --paginate "repos/$REPO/pulls?state=open&base=$BRANCH&per_page=100" --jq '.[] | "\(.number) \(.head.sha)"'
}
publicar() { # <nro> <sha> <conclusion> <titulo> <detalle>
  if [ -n "${PARALELO_PUBLICAR:-}" ]; then "${PARALELO_PUBLICAR}" "$@"; return; fi
  local n=$1 sha=$2 con=$3 tit=$4 det=$5
  gh api -X POST "repos/$REPO/check-runs" \
    -f name=paralelo -f head_sha="$sha" -f status=completed -f conclusion="$con" \
    -f "output[title]=$tit" -f "output[summary]=$(printf '%s' "$det" | head -c 60000)" >/dev/null
}

git fetch -q "$REMOTE" "$BRANCH"
PRS=$(listar) || { echo "paralelo-reevaluar: no se pudo listar los PR abiertos; sin veredicto nuevo" >&2; exit 1; }
[ -n "$PRS" ] || { echo "paralelo-reevaluar: sin PR abiertos hacia $BRANCH"; exit 0; }
fallos=0; total=0
while read -r n sha; do
  [ -n "$n" ] || continue
  total=$((total+1))
  set +e; OUT=$("$AQUI/paralelo.sh" "$n" "$sha" "$BRANCH" 2>&1); RC=$?; set -e
  if [ "$RC" = 0 ]; then CON=success; TIT="paralelo: OK (re-evaluado: $MOTIVO)"; else CON=failure; TIT="paralelo: RECHAZADO exit $RC (re-evaluado: $MOTIVO)"; fi
  echo "#$n @ ${sha:0:7} → $CON (exit $RC)"
  publicar "$n" "$sha" "$CON" "$TIT" "$OUT" || { echo "paralelo-reevaluar: no se pudo publicar el check de #$n" >&2; fallos=$((fallos+1)); }
done <<< "$PRS"
[ "$fallos" -eq 0 ] || exit 1
echo "paralelo-reevaluar: $total PR re-evaluados ($MOTIVO)"
