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
#   **En auditoría:** #N @ <sha> es la FASE ACTIVA: queda escrita hasta que el PR #N
#   está en main (el turno que mergea la pone en `ninguno`). Mientras exista:
#   R2  solo con la pelota en ChatGPT: el PR #N no cambia; su HEAD tiene que ser <sha> → exit 6
#       (con la pelota en Claude, Claude corrige hallazgos en esa rama: R2 apagado)
#   R3  un lateral no comparte archivos con la fase activa, con CUALQUIER pelota.
#       Se compara contra el HEAD ACTUAL del PR #N (refs/pull/N/head), no contra el
#       sha anotado, porque con la pelota en Claude la rama puede haber avanzado  → exit 7
#   R4  un lateral no toca gates ni scripts de proceso mientras hay fase activa
#       (workflows, scripts/ci, scripts/collab, mutation-check, configs de vitest
#       y playwright): son riesgo alto, no bajo/medio (P-03)                   → exit 8
#   Renames: se listan origen y destino (--no-renames); mover a.txt→b.txt no esquiva R3/R4.
#   Sin fase activa (`ninguno` o sin línea) y pelota en Claude: OK.
#   Uso incorrecto, HANDOFF ilegible o SHA que no se puede traer                → exit 1
#
#   EJECUCIÓN CONFIABLE (Codex, PR #69, P1): CI corre este script desde el checkout
#   de la rama BASE (workflow `paralelo.yml`, evento pull_request_target), nunca
#   desde el checkout del PR. El PR solo aporta su número y su sha como datos.
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
# --no-renames: un rename aparece como origen (borrado) + destino (agregado); así
# a.txt→b.txt sigue chocando con a.txt (R3) y sacar un workflow de .github/ sigue
# siendo tocar gates (R4). (Codex, PR #69, P2)
# -z: rutas separadas por NUL y SIN comillas. Con el formato por defecto git entrecomilla
# las rutas con no-ASCII u otros caracteres raros ('".github/workflows/\303\261.yml"'), y
# GATES_RE (anclado en ^) no las veía (Codex, ronda 2, P2). Se convierte NUL→\n: una
# ruta con salto de línea real es imposible de representar en una lista por líneas,
# así que se rechaza explícitamente (exit 1) en vez de ignorarla.
archivos() { # $1 = base, $2 = head
  local raw
  raw=$(git diff --name-only --no-renames -z "$(git merge-base "$1" "$2")" "$2" | tr '\0' '\n')
  printf '%s' "$raw"
}
# una ruta con '\n' dentro queda partida en dos líneas al convertir NUL→\n; se detecta
# comparando la cantidad de entradas NUL con la de líneas
rutas_validas() { # $1 = base, $2 = head  → falla si alguna ruta contiene salto de línea
  local nul lineas
  nul=$(git diff --name-only --no-renames -z "$(git merge-base "$1" "$2")" "$2" | tr -cd '\0' | wc -c)
  lineas=$(archivos "$1" "$2" | grep -c . || true)
  [ "$nul" -eq "$lineas" ] || fallo "el PR contiene una ruta con salto de línea; no se evalúa"
}
# HEAD actual de un PR del remoto (GitHub expone refs/pull/N/head); vacío si no existe
head_del_pr() { git fetch -q "$REMOTE" "refs/pull/$1/head" 2>/dev/null && git rev-parse -q --verify FETCH_HEAD^{commit} 2>/dev/null || true; }

git fetch -q "$REMOTE" "$BRANCH"
MAIN=$(git rev-parse "$REMOTE/$BRANCH")
HANDOFF=$(git show "$MAIN:$FILE") || fallo "no se puede leer $FILE de $REMOTE/$BRANCH"
HEAD_SHA=$(traer "$HEAD_IN")
if [ "$BASE" = "$BRANCH" ]; then BASE_SHA=$MAIN; else git fetch -q "$REMOTE" "$BASE" || fallo "no se puede traer la rama base $BASE"; BASE_SHA=$(git rev-parse FETCH_HEAD); fi

# R1 · el HANDOFF no viaja en PRs
rutas_validas "$BASE_SHA" "$HEAD_SHA"
MIOS=$(archivos "$BASE_SHA" "$HEAD_SHA")
if printf '%s\n' "$MIOS" | grep -qxF "$FILE"; then
  rechazo 5 "el PR #$PR modifica $FILE. La pelota se transfiere solo en $BRANCH con scripts/collab/handoff.sh; sacá ese cambio de la rama."
fi

if [ "$BASE" != "$BRANCH" ]; then
  echo "paralelo: OK — PR #$PR hacia $BASE (no es $BRANCH): solo aplica la regla del HANDOFF."; exit 0
fi

PELOTA=$(printf '%s\n' "$HANDOFF" | sed -nE 's/^\*\*Pelota en:\*\* (Claude|ChatGPT)\b.*/\1/p' | head -1)
[ -n "$PELOTA" ] || fallo "$FILE de $REMOTE/$BRANCH sin línea '**Pelota en:** Claude|ChatGPT' (correr handoff.sh validar)"
AUD=$(printf '%s\n' "$HANDOFF" | sed -nE 's/^\*\*En auditor(í|i)a:\*\* #([0-9]+) @ ([0-9a-f]{40})\b.*/\2 \3/p' | head -1)

if [ -z "$AUD" ]; then
  [ "$PELOTA" = Claude ] || fallo "pelota en ChatGPT pero $FILE no dice '**En auditoría:** #N @ <sha>' (handoff.sh validar lo exige)"
  echo "paralelo: OK — pelota en Claude (${MAIN:0:7}) y sin fase activa."; exit 0
fi
AUD_PR=${AUD%% *}; AUD_SHA_IN=${AUD##* }
AUD_SHA=$(traer "$AUD_SHA_IN")

# R2 · con la pelota en ChatGPT, la rama de la fase está congelada en el sha anotado
if [ "$PR" = "$AUD_PR" ]; then
  if [ "$PELOTA" = Claude ]; then
    echo "paralelo: OK — PR #$PR es la fase activa y la pelota es de Claude: puede avanzar (anotado ${AUD_SHA:0:7}, HEAD ${HEAD_SHA:0:7})."; exit 0
  fi
  if [ "$HEAD_SHA" = "$AUD_SHA" ]; then
    echo "paralelo: OK — PR #$PR está en auditoría y su HEAD sigue siendo ${AUD_SHA:0:7}."; exit 0
  fi
  rechazo 6 "el PR #$PR está en auditoría sobre ${AUD_SHA:0:7} y su HEAD ahora es ${HEAD_SHA:0:7}. No se toca la rama mientras la pelota es del auditor; esperá AUDIT: CAMBIOS/APROBADO."
fi

# Fase activa: se compara contra el HEAD ACTUAL del PR (refs/pull/N/head), que con la
# pelota en Claude puede ir más allá del sha anotado. Si el remoto no expone esa ref,
# el sha anotado es el mejor dato disponible.
FASE_SHA=$(head_del_pr "$AUD_PR"); FASE_SHA=${FASE_SHA:-$AUD_SHA}

# R3 · el lateral no comparte archivos con la fase activa (cualquier pelota)
AUDITADOS=$(archivos "$MAIN" "$FASE_SHA")
COMUNES=$(comm -12 <(printf '%s\n' "$MIOS" | sort -u) <(printf '%s\n' "$AUDITADOS" | sort -u) || true)
if [ -n "$COMUNES" ]; then
  rechazo 7 "el lateral #$PR toca archivos de la fase activa #$AUD_PR (${FASE_SHA:0:7}, pelota en $PELOTA); posponelo hasta que ese PR esté en $BRANCH:"$'\n'"$COMUNES"
fi

# R4 · el lateral no toca gates ni scripts de proceso mientras hay fase activa
GATES=$(printf '%s\n' "$MIOS" | grep -E "$GATES_RE" || true)
if [ -n "$GATES" ]; then
  rechazo 8 "el lateral #$PR toca gates o scripts de proceso (riesgo alto, no lateral) mientras #$AUD_PR es la fase activa (pelota en $PELOTA):"$'\n'"$GATES"
fi

echo "paralelo: OK — lateral #$PR (${HEAD_SHA:0:7}) no comparte archivos con la fase activa #$AUD_PR (${FASE_SHA:0:7}) ni toca gates."
