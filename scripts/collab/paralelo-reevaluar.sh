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
publicar() { # <nro> <sha> <conclusion|pendiente> <titulo> <detalle>
  if [ -n "${PARALELO_PUBLICAR:-}" ]; then "${PARALELO_PUBLICAR}" "$@"; return; fi
  local n=$1 sha=$2 con=$3 tit=$4 det=$5
  if [ "$con" = pendiente ]; then
    gh api -X POST "repos/$REPO/check-runs" -f name=paralelo -f head_sha="$sha" -f status=in_progress \
      -f "output[title]=$tit" -f "output[summary]=$det" >/dev/null; return
  fi
  gh api -X POST "repos/$REPO/check-runs" \
    -f name=paralelo -f head_sha="$sha" -f status=completed -f conclusion="$con" \
    -f "output[title]=$tit" -f "output[summary]=$(printf '%s' "$det" | head -c 60000)" >/dev/null
}
# Publicar con reintentos: un fallo transitorio de la API no puede dejar vivo un check
# viejo (Codex sobre 4d6746b, P1). Antes del veredicto final se publica "pendiente"
# sobre cada HEAD, así un success anterior deja de ser el último aunque la publicación
# final falle; y la final se reintenta.
REINTENTOS=${PARALELO_REINTENTOS:-3}
publicar_firme() { local i; for ((i=1; i<=REINTENTOS; i++)); do publicar "$@" && return 0; [ "$i" -lt "$REINTENTOS" ] && sleep "${PARALELO_ESPERA:-2}"; done; return 1; }

# HEAD de la fase activa (refs/pull/N/head) según el HANDOFF de main: se captura al
# empezar y se revalida antes de publicar, igual que main (Codex sobre 7700da3, P1).
fase_pr() { git show "$REMOTE/$BRANCH:docs/collab/HANDOFF.md" 2>/dev/null | sed -nE 's/^\*\*En auditor(í|i)a:\*\* #([0-9]+) @ [0-9a-f]{40}\b.*/\2/p' | head -1; }
fase_head() { [ -n "$1" ] || { echo ""; return; }; git fetch -q "$REMOTE" "refs/pull/$1/head" 2>/dev/null && git rev-parse -q --verify FETCH_HEAD^{commit} 2>/dev/null || echo "sin-ref"; }

git fetch -q "$REMOTE" "$BRANCH"
MAIN0=$(git rev-parse "$REMOTE/$BRANCH")
# Los scripts que se están ejecutando (este archivo, paralelo.sh, paralelo-deps.mjs)
# son los del checkout; la política que se compara es la de origin/main recién traída.
# Si main avanzó entre el checkout (worktree) y este fetch, serían dos revisiones
# distintas y MAIN0 "estable" taparía la deriva (Codex sobre e511687, P1). Se exige
# que el checkout SEA MAIN0; si no, se aborta sin publicar (la corrida del push decide).
EJEC=$(git rev-parse HEAD)
if [ "$EJEC" != "$MAIN0" ]; then
  echo "paralelo-reevaluar: los scripts en ejecución son de ${EJEC:0:7} y $REMOTE/$BRANCH ya está en ${MAIN0:0:7}; no se evalúa con política superada (la corrida del push nuevo decide)" >&2
  exit 1
fi
FASE_PR=$(fase_pr); FASE0=$(fase_head "$FASE_PR")
PRS=$(listar) || { echo "paralelo-reevaluar: no se pudo listar los PR abiertos; sin veredicto nuevo" >&2; exit 1; }
[ -n "$PRS" ] || { echo "paralelo-reevaluar: sin PR abiertos hacia $BRANCH"; exit 0; }
# 0) "pendiente" sobre TODOS los HEAD listados ANTES de evaluar (Codex sobre 9307391, P1):
#    desde acá ningún success viejo es el último check, ni siquiera durante la ventana
#    de evaluación (varios PR, fetches lentos). Si después no se publica final (main o la
#    fase avanzan, API caída), queda el pendiente: nunca un verde viejo.
fallos=0; total=0
while read -r n sha; do
  [ -n "$n" ] || continue
  publicar_firme "$n" "$sha" pendiente "paralelo: re-evaluando ($MOTIVO)" "Veredicto nuevo en curso con $BRANCH@${MAIN0:0:7}; el anterior ya no vale." \
    || { echo "paralelo-reevaluar: no se pudo marcar pendiente el check de #$n" >&2; fallos=$((fallos+1)); }
done <<< "$PRS"
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
  echo "paralelo-reevaluar: $BRANCH avanzó de ${MAIN0:0:7} a ${MAIN1:0:7} durante la evaluación; no se publica veredicto (quedan los 'pendiente'; la corrida del push nuevo decide)" >&2
  exit 1
fi
FASE1=$(fase_head "$FASE_PR")
if [ "$FASE1" != "$FASE0" ]; then
  echo "paralelo-reevaluar: la fase activa #$FASE_PR avanzó de ${FASE0:0:7} a ${FASE1:0:7} durante la evaluación; no se publica veredicto (quedan los 'pendiente'; la corrida de su synchronize decide)" >&2
  exit 1
fi
# 2b) veredicto final, con reintentos; si aun así falla, queda el "pendiente" (nunca un verde viejo)
for r in "${RES[@]}"; do
  IFS=$'\t' read -r n sha con tit det <<< "$r"
  total=$((total+1))
  publicar_firme "$n" "$sha" "$con" "$tit" "$(printf '%s' "$det" | tr '\r' '\n')" || { echo "paralelo-reevaluar: no se pudo publicar el check de #$n tras $REINTENTOS intentos; queda pendiente (no success)" >&2; fallos=$((fallos+1)); }
done
# 3) … volver a listar (Codex sobre cfc5752, P1): un PR retargeteado a main (o abierto)
#    después de la foto inicial no recibió "pendiente" ni veredicto, y su check viejo
#    (solo R1, de cuando apuntaba a la fase) podría seguir verde mientras su edited espera
#    detrás en el carril. Todo HEAD que aparezca ahora y no estuviera en la foto recibe
#    failure "SIN VEREDICTO"; la corrida encolada lo evalúa de verdad.
#    Si no se puede volver a listar, NO se corta acá (Codex sobre 168d4eb, P1): la
#    revalidación final de main/fase tiene que correr igual; se sale 1 al final.
concilia_fallo=0
PRS2=$(listar) || { echo "paralelo-reevaluar: no se pudo volver a listar los PR para conciliar; sin conciliación (exit 1 al final)" >&2; concilia_fallo=1; PRS2=""; }
nuevos=0
while read -r n sha; do
  [ -n "$n" ] || continue
  visto=0; for r in "${RES[@]}"; do case "$r" in "$n"$'\t'"$sha"$'\t'*) visto=1; break;; esac; done
  [ "$visto" = 1 ] && continue
  nuevos=$((nuevos+1))
  echo "paralelo-reevaluar: #$n @ ${sha:0:7} apareció hacia $BRANCH durante la re-evaluación; sin veredicto hasta la corrida siguiente" >&2
  publicar_firme "$n" "$sha" failure "paralelo: SIN VEREDICTO (#$n entró hacia $BRANCH durante la re-evaluación; la corrida siguiente lo evalúa)" "Este HEAD no estaba en la lista evaluada con $BRANCH@${MAIN0:0:7}; su check anterior ya no vale." || true
done <<< "$PRS2"
# 4) … y revalidar DESPUÉS de publicar y de conciliar (Codex sobre baec6ab, P1; sobre
#    545512c, P1: esta guarda es lo ÚLTIMO que corre, nada publica después): si main o la
#    fase avanzaron mientras corría el bucle de publicación o la conciliación, lo publicado puede ser un verde
#    calculado con estado viejo. Se invalida de inmediato publicando failure
#    "caducado" sobre todos los HEAD evaluados; la corrida encolada vuelve a evaluar.
git fetch -q "$REMOTE" "$BRANCH"
MAIN2=$(git rev-parse "$REMOTE/$BRANCH"); FASE2=$(fase_head "$FASE_PR")
if [ "$MAIN2" != "$MAIN0" ] || [ "$FASE2" != "$FASE0" ]; then
  echo "paralelo-reevaluar: $BRANCH (${MAIN0:0:7}→${MAIN2:0:7}) o la fase #$FASE_PR (${FASE0:0:7}→${FASE2:0:7}) avanzaron durante la publicación; se invalida lo publicado" >&2
  for r in "${RES[@]}"; do
    IFS=$'\t' read -r n sha con tit det <<< "$r"
    publicar_firme "$n" "$sha" failure "paralelo: CADUCADO (main o la fase avanzaron durante la publicación; re-evaluación pendiente)" "El veredicto anterior se calculó con $BRANCH@${MAIN0:0:7} y fase@${FASE0:0:7}; ahora $BRANCH@${MAIN2:0:7} y fase@${FASE2:0:7}. La corrida siguiente lo recalcula." || true
  done
  exit 1
fi
[ "$concilia_fallo" -eq 0 ] || exit 1
[ "$nuevos" -eq 0 ] || exit 1
[ "$fallos" -eq 0 ] || exit 1
echo "paralelo-reevaluar: $total PR re-evaluados con $BRANCH@${MAIN0:0:7} ($MOTIVO)"
