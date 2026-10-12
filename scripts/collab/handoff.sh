#!/usr/bin/env bash
# P-01 · Único camino para escribir docs/collab/HANDOFF.md en main.
#
#   leer   : scripts/collab/handoff.sh leer
#            Hace fetch, muestra HANDOFF.md de origin/main e imprime el SHA leído.
#            Guardalo: export HANDOFF_BASE_SHA=<sha>
#   escribir: scripts/collab/handoff.sh escribir <archivo-nuevo> "<mensaje de commit>" [--historial "<línea>"]
#            Compare-and-swap: si origin/main ya no es HANDOFF_BASE_SHA, ABORTA y
#            muestra el diff para releer. Si coincide: valida el archivo, commitea
#            sobre origin/main y hace push SOLO fast-forward. Nunca --force.
#            Exit 3 = main avanzó (releer); exit 4 = el push falló por otra causa;
#            exit 5 = la fase activa anterior ('En auditoría: #N @ sha') desaparece o
#            cambia de PR sin que #N esté mergeado en main (P-05; Codex sobre 89bd718).
#
# Variables: HANDOFF_BASE_SHA (obligatoria para escribir), HANDOFF_REMOTE (origin),
#            HANDOFF_BRANCH (main), GIT_AUTHOR_NAME/EMAIL como siempre.
#            HANDOFF_PR_MERGEADO: comando que recibe <nro> e imprime "<merged> <base.ref>
#            <merge_commit_sha>" (default: gh api repos/<owner>/<repo>/pulls/<nro>). Mergeado
#            "en main" = merged true, base == main y merge commit ancestro de origin/main
#            (Codex sobre 8fe9a9f: .merged es relativo a la base actual del PR, un retarget
#            mergeado en otra rama también da true). Sin verificación → exit 5.
set -euo pipefail
REMOTE=${HANDOFF_REMOTE:-origin}
BRANCH=${HANDOFF_BRANCH:-main}
FILE=docs/collab/HANDOFF.md
HIST=docs/collab/HISTORIAL.md
MAX_LINEAS=60

fallo() { echo "handoff: $*" >&2; exit 1; }

# P-05 · la línea 'En auditoría: #N @ sha' es la fase activa y queda hasta que #N esté
# en main. Pasar la pelota a Claude NO la borra (AUDIT: CAMBIOS la deja); solo el turno
# que mergea la pone en 'ninguno' o la cambia por otro PR. Se verifica contra GitHub.
fase_de() { { grep -E '^\*\*En auditor(í|i)a:\*\* #[0-9]+ @ [0-9a-f]{40}\b' "$1" 2>/dev/null || true; } | head -1 | sed -E 's/^\*\*En auditor(í|i)a:\*\* #([0-9]+) @.*/\2/'; }
repo_github() {
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then echo "$GITHUB_REPOSITORY"; return; fi
  git remote get-url "$REMOTE" 2>/dev/null | sed -nE 's#^(https://github\.com/|git@github\.com:)([^/]+/[^/]+)/?$#\2#p' | sed -E 's/\.git$//'
}
pr_estado() { # $1 = nro → "<merged> <base.ref> <merge_commit_sha>"; falla si no puede consultar
  if [ -n "${HANDOFF_PR_MERGEADO:-}" ]; then "${HANDOFF_PR_MERGEADO}" "$1"; return; fi
  local repo; repo=$(repo_github); [ -n "$repo" ] || return 1
  command -v gh >/dev/null || return 1
  gh api "repos/$repo/pulls/$1" --jq '"\(.merged) \(.base.ref) \(.merge_commit_sha)"' 2>/dev/null
}
pr_mergeado() { # $1 = nro → imprime true|false|<motivo>; "true" solo si está EN $BRANCH
  local est merged base mc
  est=$(pr_estado "$1") || { echo "no se pudo consultar #$1"; return 1; }
  read -r merged base mc <<< "$est"
  [ "$merged" = true ] || { echo "false"; return 0; }
  [ "$base" = "$BRANCH" ] || { echo "mergeado en '$base', no en $BRANCH"; return 0; }
  git fetch -q "$REMOTE" "$BRANCH" 2>/dev/null || true
  [ -n "$mc" ] && [ "$mc" != null ] && git merge-base --is-ancestor "$mc" "$REMOTE/$BRANCH" 2>/dev/null \
    || { echo "el merge commit ${mc:0:7} no es ancestro de $REMOTE/$BRANCH"; return 0; }
  echo true
}

validar() { # $1 = archivo
  local f=$1 n pelotas
  [ -s "$f" ] || fallo "archivo vacío: $f"
  # Líneas LÓGICAS: `wc -l` cuenta saltos de línea y no ve una última línea sin
  # "\n" (61 líneas con 60 "\n" pasaban; #58, AUDIT: CAMBIOS). awk sí la cuenta.
  n=$(awk 'END { print NR }' "$f")
  [ "$n" -le $MAX_LINEAS ] || fallo "$n líneas (máx. $MAX_LINEAS). Mové decisiones a DECISIONES.md e historial a HISTORIAL.md."
  pelotas=$(grep -cE '^\*\*Pelota en:\*\* (Claude|ChatGPT)\b' "$f" || true)
  [ "$pelotas" -eq 1 ] || fallo "debe haber exactamente UNA línea '**Pelota en:** Claude|ChatGPT' (hay $pelotas)"
  ! grep -qE '^(<<<<<<<|=======|>>>>>>>)' "$f" || fallo "marcadores de conflicto en $f"
  # P-05: qué PR está congelado mientras audita el otro. Con la pelota en ChatGPT
  # es obligatoria (#N @ sha completo); con la pelota en Claude puede faltar o
  # decir "ninguno". paralelo.sh la lee de origin/main en cada PR.
  local aud_lineas aud_validas
  aud_lineas=$(grep -cE '^\*\*En auditor(í|i)a:\*\*' "$f" || true)
  aud_validas=$(grep -cE '^\*\*En auditor(í|i)a:\*\* (#[0-9]+ @ [0-9a-f]{40}\b|ninguno\b)' "$f" || true)
  [ "$aud_lineas" -le 1 ] || fallo "más de una línea '**En auditoría:**' (hay $aud_lineas)"
  [ "$aud_lineas" -eq "$aud_validas" ] || fallo "línea '**En auditoría:**' inválida: tiene que ser '#<PR> @ <sha de 40 hex>' o 'ninguno'"
  if grep -qE '^\*\*Pelota en:\*\* ChatGPT\b' "$f"; then
    grep -qE '^\*\*En auditor(í|i)a:\*\* #[0-9]+ @ [0-9a-f]{40}\b' "$f" || fallo "con la pelota en ChatGPT hace falta '**En auditoría:** #<PR> @ <sha de 40 hex>' (P-05)"
  fi
}

case "${1:-}" in
  leer)
    git fetch -q "$REMOTE" "$BRANCH"
    SHA=$(git rev-parse "$REMOTE/$BRANCH")
    git show "$SHA:$FILE"
    echo
    echo "HANDOFF_BASE_SHA=$SHA"
    ;;
  validar)
    validar "${2:-$FILE}"; echo "handoff: OK (${2:-$FILE})"
    ;;
  escribir)
    NUEVO=${2:?archivo nuevo}; MSG=${3:?mensaje de commit}; shift 3 || true
    LINEA_HIST=""
    while [ $# -gt 0 ]; do case "$1" in --historial) LINEA_HIST=$2; shift 2;; *) fallo "opción desconocida $1";; esac; done
    [ -n "${HANDOFF_BASE_SHA:-}" ] || fallo "falta HANDOFF_BASE_SHA: primero 'handoff.sh leer'"
    validar "$NUEVO"
    WT_PREV=$(mktemp); trap 'rm -f "$WT_PREV"' EXIT
    git fetch -q "$REMOTE" "$BRANCH"
    ACTUAL=$(git rev-parse "$REMOTE/$BRANCH")
    if [ "$ACTUAL" != "$HANDOFF_BASE_SHA" ]; then
      echo "handoff: ABORTADO — $REMOTE/$BRANCH avanzó de ${HANDOFF_BASE_SHA:0:7} a ${ACTUAL:0:7} desde tu lectura." >&2
      echo "handoff: cambios en $FILE que no viste:" >&2
      git diff "$HANDOFF_BASE_SHA" "$ACTUAL" -- "$FILE" "$HIST" docs/collab/DECISIONES.md >&2 || true
      echo "handoff: releé con 'handoff.sh leer', rehacé tu versión sobre eso y reintentá. Nada se escribió." >&2
      exit 3
    fi
    # P-05: la fase activa anterior no puede desaparecer ni cambiar de PR sin merge.
    git show "$ACTUAL:$FILE" > "$WT_PREV" 2>/dev/null || : > "$WT_PREV"
    FASE_PREV=$(fase_de "$WT_PREV"); FASE_NUEVA=$(fase_de "$NUEVO")
    if [ -n "$FASE_PREV" ] && [ "$FASE_PREV" != "$FASE_NUEVA" ]; then
      MERGEADO=$(pr_mergeado "$FASE_PREV" 2>/dev/null) || MERGEADO=""
      if [ "$MERGEADO" != true ]; then
        echo "handoff: ABORTADO — el HANDOFF actual tiene la fase activa #$FASE_PREV y la versión nueva la ${FASE_NUEVA:+cambia por #$FASE_NUEVA}${FASE_NUEVA:-quita}, pero #$FASE_PREV no está mergeado en $BRANCH (${MERGEADO:-no se pudo verificar}). La línea 'En auditoría' queda hasta el merge; con AUDIT: CAMBIOS se conserva. Nada se escribió." >&2
        exit 5
      fi
    fi
    # Commit construido SOBRE origin/main exacto, en un worktree aparte: no depende
    # del estado de la rama local y el push solo puede ser fast-forward.
    WT=$(mktemp -d)
    trap 'git worktree remove --force "$WT" 2>/dev/null || true; rm -f "$WT_PREV"' EXIT
    git worktree add -q --detach "$WT" "$ACTUAL"
    cp "$NUEVO" "$WT/$FILE"
    if [ -n "$LINEA_HIST" ]; then printf '%s\n' "$LINEA_HIST" >> "$WT/$HIST"; fi
    git -C "$WT" add "$FILE" "$HIST"
    git -C "$WT" commit -q -m "$MSG"
    NUEVO_SHA=$(git -C "$WT" rev-parse HEAD)
    # Push estrictamente fast-forward. Si alguien ganó la carrera en estos ms, git
    # rechaza (non-fast-forward) y no se reescribe nada.
    if ERR_PUSH=$(git push -q "$REMOTE" "$NUEVO_SHA:refs/heads/$BRANCH" 2>&1); then
      echo "handoff: escrito en $REMOTE/$BRANCH → ${NUEVO_SHA:0:7} (base ${ACTUAL:0:7})"
      echo "HANDOFF_BASE_SHA=$NUEVO_SHA"
    else
      # No todo fallo de push es una carrera (#58, AUDIT: CAMBIOS): puede ser
      # autenticación, protección de rama, un hook del servidor o la red. Siempre
      # se muestra el error real de git; "carrera" solo si se comprueba que main
      # avanzó desde ACTUAL.
      printf '%s\n' "$ERR_PUSH" >&2
      if git fetch -q "$REMOTE" "$BRANCH" 2>/dev/null && [ "$(git rev-parse "$REMOTE/$BRANCH")" != "$ACTUAL" ]; then
        echo "handoff: ABORTADO — $REMOTE/$BRANCH avanzó de ${ACTUAL:0:7} a $(git rev-parse --short "$REMOTE/$BRANCH") entre tu fetch y tu push (carrera). Releé con 'handoff.sh leer' y reintentá. Nada se escribió." >&2
        exit 3
      fi
      echo "handoff: ABORTADO — el push falló y no es una carrera comprobada ($REMOTE/$BRANCH sigue en ${ACTUAL:0:7} o no se pudo verificar). Mirá el error de git de arriba (autenticación, protección de rama, hook o red). Nada se escribió." >&2
      exit 4
    fi
    ;;
  *)
    sed -n '2,14p' "$0"; exit 2;;
esac
