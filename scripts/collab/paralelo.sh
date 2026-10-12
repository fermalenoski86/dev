#!/usr/bin/env bash
# P-05 · Control comprobable del trabajo paralelo (acordado en #53, "aceptada con ajustes").
#
#   uso: scripts/collab/paralelo.sh <nro-PR> <head-sha> [rama-base]
#        (CI lo corre en cada pull_request; localmente, antes de mergear un lateral)
#
# Lee docs/collab/HANDOFF.md de origin/main (NUNCA la copia de la rama) y aplica:
#   R1  ningún PR modifica docs/collab/HANDOFF.md: la pelota se transfiere solo en
#       main con handoff.sh (P-01). Vale para toda rama base.                → exit 5
#   Si la base no es main (ej. audit/<fase>-<tema> hacia la rama de la fase), termina acá.
#   Si la pelota es de Claude, no hay nada en auditoría: termina acá.
#   Con **Pelota en:** ChatGPT y **En auditoría:** #N @ <sha>:
#   R2  el PR #N no cambia mientras lo audita el otro: su HEAD tiene que ser <sha> → exit 6
#   R3  un lateral no comparte archivos con el PR en auditoría (se pospone)     → exit 7
#   R4  un lateral no toca gates ni scripts de proceso mientras hay auditoría
#       (workflows, scripts/ci, scripts/collab, mutation-check, configs de vitest
#       y playwright): son riesgo alto, no bajo/medio (P-03)                   → exit 8
#   Uso incorrecto, HANDOFF ilegible o SHA que no se puede traer                → exit 1
#
# Variables: HANDOFF_REMOTE (origin), HANDOFF_BRANCH (main).
# Límite declarado: es un chequeo de CI sobre el estado de main en ese momento. No
# reemplaza la protección de rama (pendiente de Fer): un merge fuera de orden hecho
# a mano lo saltea. Por eso también se corre a mano justo antes de mergear un lateral.
set -euo pipefail
REMOTE=${HANDOFF_REMOTE:-origin}
BRANCH=${HANDOFF_BRANCH:-main}
FILE=docs/collab/HANDOFF.md
GATES_RE='^(\.github/workflows/|scripts/ci/|scripts/collab/|scripts/mutation-check\.py$|vitest[^/]*\.config\.ts$|playwright[^/]*\.config\.ts$)'

fallo() { echo "paralelo: $*" >&2; exit "${2:-1}"; }
rechazo() { local code=$1; shift; echo "paralelo: RECHAZADO — $*" >&2; exit "$code"; }

PR=${1:?nro de PR}; HEAD_IN=${2:?sha del HEAD del PR}; BASE=${3:-$BRANCH}
[[ "$PR" =~ ^[0-9]+$ ]] || fallo "nro de PR inválido: $PR"

traer() { # $1 = sha o ref; lo deja disponible localmente e imprime el sha completo
  local r=$1 sha
  if ! sha=$(git rev-parse -q --verify "$r^{commit}" 2>/dev/null); then
    git fetch -q "$REMOTE" "$r" 2>/dev/null || fallo "no se puede traer $r de $REMOTE"
    sha=$(git rev-parse -q --verify "$r^{commit}" 2>/dev/null) || sha=$(git rev-parse -q --verify "FETCH_HEAD^{commit}") || fallo "no se puede resolver $r"
  fi
  printf '%s' "$sha"
}
archivos() { git diff --name-only "$(git merge-base "$1" "$2")" "$2"; } # $1 = base, $2 = head

git fetch -q "$REMOTE" "$BRANCH"
MAIN=$(git rev-parse "$REMOTE/$BRANCH")
HANDOFF=$(git show "$MAIN:$FILE") || fallo "no se puede leer $FILE de $REMOTE/$BRANCH"
HEAD_SHA=$(traer "$HEAD_IN")
if [ "$BASE" = "$BRANCH" ]; then BASE_SHA=$MAIN; else git fetch -q "$REMOTE" "$BASE" || fallo "no se puede traer la rama base $BASE"; BASE_SHA=$(git rev-parse FETCH_HEAD); fi

# R1 · el HANDOFF no viaja en PRs
MIOS=$(archivos "$BASE_SHA" "$HEAD_SHA")
if printf '%s\n' "$MIOS" | grep -qxF "$FILE"; then
  rechazo 5 "el PR #$PR modifica $FILE. La pelota se transfiere solo en $BRANCH con scripts/collab/handoff.sh; sacá ese cambio de la rama."
fi

if [ "$BASE" != "$BRANCH" ]; then
  echo "paralelo: OK — PR #$PR hacia $BASE (no es $BRANCH): solo aplica la regla del HANDOFF."; exit 0
fi

PELOTA=$(printf '%s\n' "$HANDOFF" | sed -nE 's/^\*\*Pelota en:\*\* (Claude|ChatGPT)\b.*/\1/p' | head -1)
[ -n "$PELOTA" ] || fallo "$FILE de $REMOTE/$BRANCH sin línea '**Pelota en:** Claude|ChatGPT' (correr handoff.sh validar)"
if [ "$PELOTA" = Claude ]; then
  echo "paralelo: OK — pelota en Claude (${MAIN:0:7}): no hay PR en auditoría."; exit 0
fi

AUD=$(printf '%s\n' "$HANDOFF" | sed -nE 's/^\*\*En auditor(í|i)a:\*\* #([0-9]+) @ ([0-9a-f]{40})\b.*/\2 \3/p' | head -1)
[ -n "$AUD" ] || fallo "pelota en ChatGPT pero $FILE no dice '**En auditoría:** #N @ <sha>' (handoff.sh validar lo exige)"
AUD_PR=${AUD%% *}; AUD_SHA_IN=${AUD##* }
AUD_SHA=$(traer "$AUD_SHA_IN")

# R2 · la rama en auditoría está congelada
if [ "$PR" = "$AUD_PR" ]; then
  if [ "$HEAD_SHA" = "$AUD_SHA" ]; then
    echo "paralelo: OK — PR #$PR es el que está en auditoría y su HEAD sigue siendo ${AUD_SHA:0:7}."; exit 0
  fi
  rechazo 6 "el PR #$PR está en auditoría sobre ${AUD_SHA:0:7} y su HEAD ahora es ${HEAD_SHA:0:7}. No se toca la rama mientras la pelota es del auditor; esperá AUDIT: CAMBIOS/APROBADO."
fi

# R3 · el lateral no comparte archivos con el PR en auditoría
AUDITADOS=$(archivos "$MAIN" "$AUD_SHA")
COMUNES=$(comm -12 <(printf '%s\n' "$MIOS" | sort -u) <(printf '%s\n' "$AUDITADOS" | sort -u) || true)
if [ -n "$COMUNES" ]; then
  rechazo 7 "el lateral #$PR toca archivos del PR #$AUD_PR en auditoría (${AUD_SHA:0:7}); posponelo hasta que ese PR se mergee:"$'\n'"$COMUNES"
fi

# R4 · el lateral no toca gates ni scripts de proceso mientras hay auditoría
GATES=$(printf '%s\n' "$MIOS" | grep -E "$GATES_RE" || true)
if [ -n "$GATES" ]; then
  rechazo 8 "el lateral #$PR toca gates o scripts de proceso (riesgo alto, no lateral) mientras #$AUD_PR está en auditoría:"$'\n'"$GATES"
fi

echo "paralelo: OK — lateral #$PR (${HEAD_SHA:0:7}) no comparte archivos con #$AUD_PR (${AUD_SHA:0:7}) ni toca gates."
