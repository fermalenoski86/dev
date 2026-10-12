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
#   R3  un lateral no comparte archivos con la fase activa, con CUALQUIER pelota;
#       R3b: tampoco dependencias del workspace (mismo paquete o uno depende del otro)
#       Se compara contra el HEAD ACTUAL del PR #N (refs/pull/N/head), no contra el
#       sha anotado, porque con la pelota en Claude la rama puede haber avanzado  → exit 7
#   R4  un lateral no toca las familias de riesgo ALTO acordadas en #53 (P-03) mientras
#       hay fase activa: gates y scripts de proceso (workflows, scripts/ci,
#       scripts/collab, mutation-check, configs de vite/vitest/playwright),
#       migraciones, auth/CSRF/CORS, aprobación, storage, procesos externos y
#       apps/control congelado (mapa de rutas en GATES_RE). La transferencia de
#       pelota (HANDOFF.md) la cubre R1 para todo PR.                           → exit 8
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
# Familias de riesgo ALTO acordadas en #53 (P-03 "alto" + ajuste del auditor: scripts
# de CI/collab, gates, auth, transferencia de pelota), en UN solo lugar para que P-03
# lo reutilice. Mapeo a rutas del repo, sin inventar familias nuevas:
#   gates/proceso: workflows, scripts/ci, scripts/collab, mutation-check, configs de
#                  vite/vitest/playwright a cualquier profundidad y extensión, más
#                  vitest.workspace.* / vitest.projects.* (Vitest 2 los lee solo; Codex ronda 12)
#                  + lo que gates.yml ejecuta o lo que define un gate (ronda 9, autorrevisión):
#                  scripts/{dev,acceptance,e2e-platform}/ y los scripts/ de CADA paquete
#                  del workspace (docs-contract.ts, db-migrate, e2e-stack, bootstrap-smoke,
#                  make-fixtures…: lo que gates.yml ejecuta vía pnpm --filter o por ruta;
#                  Codex sobre fe2f6c3, P2) y en la RAÍZ package.json (define
#                  verify/acceptance:check/progress:check), .eslintrc* (lint) y
#                  tsconfig.base.json (typecheck). El package.json de un paquete es
#                  producto (deps: R3/R3b), SALVO su bloque "scripts": lo que pnpm -r
#                  build/typecheck/test y pnpm --filter docs:contract ejecutan; si cambia,
#                  es gate (R4b, misma ronda).
#                  + entradas que los gates consumen (Codex sobre b4aeebb): pnpm-lock.yaml,
#                  pnpm-workspace.yaml, .npmrc (install), .env.example, docker-compose*.yml
#                  y docker/ (compose-smoke).
#   migraciones:   packages/platform-db/src/{migrations,migrator.ts,bootstrap.sql}
#   auth/CSRF/CORS: packages/platform-auth, apps/platform-api/src/{auth*,actor.ts,cors.ts}
#   aprobación:    packages/platform-approval, apps/platform-api/src/approval*
#   storage:       packages/platform-storage
#   procesos externos (ffmpeg/ffprobe, execFile): packages/platform-media/src/process.ts,
#                  apps/platform-api/src/server.ts
#   congelado:     apps/control (M2C.2)
# Hardware: sin rutas todavía (no existe). HANDOFF.md lo cubre R1 para todo PR.
GATES_RE='^(\.github/workflows/|scripts/ci/|scripts/collab/|scripts/mutation-check\.py$|scripts/(dev|acceptance|e2e-platform)/|__WS__/[^/]+/scripts/|(package|tsconfig\.base)\.json$|\.eslintrc[^/]*$|pnpm-(lock|workspace)\.yaml$|\.npmrc$|\.env\.example$|docker-compose[^/]*\.ya?ml$|docker/|packages/platform-db/src/(migrations/|migrator\.ts$|bootstrap\.sql$)|packages/platform-auth/|apps/platform-api/src/(auth|approval)|apps/platform-api/src/(actor|cors|server)\.ts$|packages/platform-approval/|packages/platform-storage/|packages/platform-media/src/process\.ts$|apps/control/)|(^|/)(vite|vitest|playwright)[^/]*\.config\.[cm]?[jt]s$|(^|/)vitest\.(workspace|projects)\.[^/]+$'

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

# Fase activa: se compara SIEMPRE contra el HEAD ACTUAL del PR (refs/pull/N/head) y
# nunca contra el sha anotado: con la pelota en Claude la rama avanza, y con la pelota
# en ChatGPT alguien puede haberla empujado igual (R2 pone rojo a ese PR, pero no
# frena a un lateral). Si la ref no se puede traer se FALLA CERRADO, exit 1
# (Codex, rondas 3 y 4, P2).
FASE_SHA=$(head_del_pr "$AUD_PR")
[ -n "$FASE_SHA" ] || fallo "no se pudo traer refs/pull/$AUD_PR/head de $REMOTE: sin el HEAD actual de la fase activa no se aprueba ningún lateral (sha anotado ${AUD_SHA:0:7}, no se usa como respaldo)"

# R3 · el lateral no comparte archivos con la fase activa (cualquier pelota)
AUDITADOS=$(archivos "$MAIN" "$FASE_SHA")
COMUNES=$(comm -12 <(printf '%s\n' "$MIOS" | sort -u) <(printf '%s\n' "$AUDITADOS" | sort -u) || true)
if [ -n "$COMUNES" ]; then
  rechazo 7 "el lateral #$PR toca archivos de la fase activa #$AUD_PR (${FASE_SHA:0:7}, pelota en $PELOTA); posponelo hasta que ese PR esté en $BRANCH:"$'\n'"$COMUNES"
fi

# R3b · ni dependencias: un paquete del workspace tocado por el lateral no puede ser
# el mismo, depender de, ni ser dependencia (transitiva) de uno que toca la fase
# (Codex sobre b4aeebb, P2: "comparta archivos o dependencias" de AGENTS.md).
# Grafo = unión de los package.json de main, la fase y el lateral. Sin node → exit 1.
command -v node >/dev/null || fallo "falta node para evaluar dependencias del workspace (R3b); no se aprueba"
DEPS=$(FASE_FILES="$AUDITADOS" LAT_FILES="$MIOS" node "$(dirname "$0")/paralelo-deps.mjs" "$MAIN" "$FASE_SHA" "$HEAD_SHA") \
  || fallo "no se pudo evaluar el grafo de dependencias del workspace (R3b); no se aprueba"
if [ -n "$DEPS" ]; then
  rechazo 7 "el lateral #$PR comparte dependencias del workspace con la fase activa #$AUD_PR (${FASE_SHA:0:7}, pelota en $PELOTA); posponelo hasta que ese PR esté en $BRANCH:"$'\n'"$DEPS"
fi

# Raíces del workspace según pnpm-workspace.yaml de MAIN (revisión confiable; el del PR
# es gate por R4): apps/*, packages/*, edge/*… Un paquete bajo cualquier raíz entra en
# pnpm -r (Codex sobre 3108da9, P2). Sin archivo o sin patrones → apps|packages.
ws_raices() { { git show "$1:pnpm-workspace.yaml" 2>/dev/null || true; } | sed -nE "s/^[[:space:]]*-[[:space:]]*['\"]?([A-Za-z0-9_.@-]+)\/\*['\"]?[[:space:]]*$/\1/p" | sed 's/\./\\./g' | paste -sd'|'; }
WS=$(ws_raices "$MAIN" || true); [ -n "$WS" ] || WS='apps|packages'
WS_RE="($WS)"
GATES_RE=${GATES_RE//__WS__/$WS_RE}

# R4 · el lateral no toca gates ni scripts de proceso mientras hay fase activa
GATES=$(printf '%s\n' "$MIOS" | grep -E "$GATES_RE" || true)
if [ -n "$GATES" ]; then
  rechazo 8 "el lateral #$PR toca una familia de riesgo alto según #53/P-03 (gates, proceso, migraciones, auth/CSRF/CORS, aprobación, storage, procesos externos, apps/control): no es lateral mientras #$AUD_PR es la fase activa (pelota en $PELOTA):"$'\n'"$GATES"
fi

# R4b · el bloque "scripts" de un package.json del workspace define lo que los gates
# ejecutan (pnpm -r build/typecheck/test, pnpm --filter … docs:contract): si cambia,
# o el package.json aparece/desaparece, es gate. Las deps son producto (R3/R3b).
command -v jq >/dev/null || fallo "falta jq para evaluar los scripts de package.json (R4b); no se aprueba"
scripts_de() { git show "$1:$2" 2>/dev/null | jq -cS '.scripts // {}' 2>/dev/null || echo "__sin-package-json__"; }
PKG_GATES=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [[ "$f" =~ ^$WS_RE/[^/]+/package\.json$ ]] || continue
  if [ "$(scripts_de "$BASE_SHA" "$f")" != "$(scripts_de "$HEAD_SHA" "$f")" ]; then PKG_GATES+="$f (bloque scripts)"$'\n'; fi
done <<< "$MIOS"
if [ -n "$PKG_GATES" ]; then
  rechazo 8 "el lateral #$PR cambia el bloque \"scripts\" de un package.json del workspace (lo que pnpm -r / pnpm --filter ejecutan en los gates): no es lateral mientras #$AUD_PR es la fase activa (pelota en $PELOTA):"$'\n'"$PKG_GATES"
fi

echo "paralelo: OK — lateral #$PR (${HEAD_SHA:0:7}) no comparte archivos con la fase activa #$AUD_PR (${FASE_SHA:0:7}) ni toca gates."
