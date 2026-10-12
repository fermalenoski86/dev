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
#            Exit 3 = main avanzó (releer); exit 4 = el push falló por otra causa.
#
# Variables: HANDOFF_BASE_SHA (obligatoria para escribir), HANDOFF_REMOTE (origin),
#            HANDOFF_BRANCH (main), GIT_AUTHOR_NAME/EMAIL como siempre.
set -euo pipefail
REMOTE=${HANDOFF_REMOTE:-origin}
BRANCH=${HANDOFF_BRANCH:-main}
FILE=docs/collab/HANDOFF.md
HIST=docs/collab/HISTORIAL.md
MAX_LINEAS=60

fallo() { echo "handoff: $*" >&2; exit 1; }

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
    git fetch -q "$REMOTE" "$BRANCH"
    ACTUAL=$(git rev-parse "$REMOTE/$BRANCH")
    if [ "$ACTUAL" != "$HANDOFF_BASE_SHA" ]; then
      echo "handoff: ABORTADO — $REMOTE/$BRANCH avanzó de ${HANDOFF_BASE_SHA:0:7} a ${ACTUAL:0:7} desde tu lectura." >&2
      echo "handoff: cambios en $FILE que no viste:" >&2
      git diff "$HANDOFF_BASE_SHA" "$ACTUAL" -- "$FILE" "$HIST" docs/collab/DECISIONES.md >&2 || true
      echo "handoff: releé con 'handoff.sh leer', rehacé tu versión sobre eso y reintentá. Nada se escribió." >&2
      exit 3
    fi
    # Commit construido SOBRE origin/main exacto, en un worktree aparte: no depende
    # del estado de la rama local y el push solo puede ser fast-forward.
    WT=$(mktemp -d)
    trap 'git worktree remove --force "$WT" 2>/dev/null || true' EXIT
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
