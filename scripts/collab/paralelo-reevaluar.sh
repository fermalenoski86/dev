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

# HEAD de la fase activa (refs/pull/N/head) según el HANDOFF de main: se captura al
# empezar y se revalida antes de publicar, igual que main (Codex sobre 7700da3, P1).
fase_pr() { git show "$REMOTE/$BRANCH:docs/collab/HANDOFF.md" 2>/dev/null | sed -nE 's/^\*\*En auditor(í|i)a:\*\* #([0-9]+) @ [0-9a-f]{40}\b.*/\2/p' | head -1; }
fase_head() { [ -n "$1" ] || { echo ""; return; }; git fetch -q "$REMOTE" "refs/pull/$1/head" 2>/dev/null && git rev-parse -q --verify FETCH_HEAD^{commit} 2>/dev/null || echo "sin-ref"; }

git fetch -q "$REMOTE" "$BRANCH"
MAIN0=$(git rev-parse "$REMOTE/$BRANCH")
FASE_PR=$(fase_pr); FASE0=$(fase_head "$FASE_PR")
PRS=$(listar) || { echo "paralelo-reevaluar: no se pudo listar los PR abiertos; sin veredicto nuevo" >&2; exit 1; }
[ -n "$PRS" ] || { echo "paralelo-reevaluar: sin PR abiertos hacia $BRANCH"; exit 0; }
# 1) evaluar todo con la política de MAIN0 …
RES=()
while read -r n sha; do
  [ -n "$n" ] || continue
  set +e; OUT=$("$AQUI/paralelo.sh" "$n" "$sha" "$BRANCH" 2>&1); RC=$?; set -e
  if [ "$RC" = 0 ]; then CON=success; TIT="paralelo: OK (re-evaluado: $MOTIVO)"; else CON=failure; TIT="paralelo: RECHAZADO exit $RC (re-evaluado: $MOTIVO)"; fi
  echo "#$n @ ${sha:0:7} → $CON (exit $RC)"
  RES+=("$n"$'\t'"$sha"$'\t'"$CON"$'\t'"$TIT"$'\t'"$(printf '%s' "$OUT" | tr '\n' '\r')")
done <<< "$PRS"
# 2) … y recién publicar si main (la política y el HANDOFF) sigue siendo el mismo que
#    al empezar. Si avanzó, otra corrida (la del push a main) ya tiene la última
#    palabra: no se publica nada con una política superada (Codex ronda 13, P2).
git fetch -q "$REMOTE" "$BRANCH"
MAIN1=$(git rev-parse "$REMOTE/$BRANCH")
if [ "$MAIN1" != "$MAIN0" ]; then
  echo "paralelo-reevaluar: $BRANCH avanzó de ${MAIN0:0:7} a ${MAIN1:0:7} durante la evaluación; no se publica (la corrida del push nuevo decide)" >&2
  exit 1
fi
FASE1=$(fase_head "$FASE_PR")
if [ "$FASE1" != "$FASE0" ]; then
  echo "paralelo-reevaluar: la fase activa #$FASE_PR avanzó de ${FASE0:0:7} a ${FASE1:0:7} durante la evaluación; no se publica (la corrida de su synchronize decide)" >&2
  exit 1
fi
fallos=0; total=0
for r in "${RES[@]}"; do
  IFS=$'\t' read -r n sha con tit det <<< "$r"
  total=$((total+1))
  publicar "$n" "$sha" "$con" "$tit" "$(printf '%s' "$det" | tr '\r' '\n')" || { echo "paralelo-reevaluar: no se pudo publicar el check de #$n" >&2; fallos=$((fallos+1)); }
done
[ "$fallos" -eq 0 ] || exit 1
echo "paralelo-reevaluar: $total PR re-evaluados con $BRANCH@${MAIN0:0:7} ($MOTIVO)"
