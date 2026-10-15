#!/usr/bin/env bash
# P-03 · publica el check "riesgo" de un PR con protocolo pendiente → final → revalidación
# (Codex #82, P1: un `edited`/retarget entre la foto y el POST no puede dejar un verde
# viejo). Lo corre .github/workflows/riesgo.yml desde la revisión ACTUAL de main.
#
#   scripts/collab/riesgo-ci.sh <PR>...     (env: GH_TOKEN, GITHUB_REPOSITORY)
#
# Por cada PR:
#   1. foto = HEAD, base, sha de la base y sha256 del cuerpo, leídos por API; se publica
#      `riesgo` en_progress sobre el HEAD (invalida cualquier verde anterior de ese HEAD).
#   2. evalúa `risk.mjs verificar` con los scripts de este checkout.
#   3. relee la foto y el sha de origin/main: si cambió algo (cuerpo, HEAD, base, sha de
#      la base o main ≠ los scripts que corrieron) → `failure` "caducado".
#   4. publica el final; si fue success, relee otra vez y, si cambió, lo pisa con
#      `failure` "caducado". El evento que causó el cambio vuelve a evaluar (carril serial).
# Exit: 0 si todos quedaron success; 1 si alguno no.
set -euo pipefail
REPO=${GITHUB_REPOSITORY:?}
AQUI=$(cd "$(dirname "$0")" && pwd)
SCRIPTS_SHA=$(git rev-parse HEAD)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

foto() { # $1 = PR → "head base base_sha body_sha256 state"
  gh api "repos/$REPO/pulls/$1" > "$TMP/pr.json"
  local h b s st c
  h=$(jq -r .head.sha "$TMP/pr.json"); b=$(jq -r .base.ref "$TMP/pr.json"); st=$(jq -r .state "$TMP/pr.json")
  s=$(git ls-remote origin "refs/heads/$b" | cut -f1)
  c=$(jq -r '.body // ""' "$TMP/pr.json" | sha256sum | cut -d' ' -f1)
  echo "$h $b ${s:-sin-base} $c $st"
}
main_actual() { git ls-remote origin refs/heads/main | cut -f1; }
publicar() { # $1 sha, $2 status|conclusion, $3 título, $4 archivo de resumen
  local cuerpo
  cuerpo=$(head -c 60000 "$4" 2>/dev/null || echo "sin salida")
  if [ "$2" = en_progreso ]; then
    jq -n --arg sha "$1" --arg t "$3" '{name:"riesgo", head_sha:$sha, status:"in_progress", output:{title:$t, summary:$t}}'
  else
    jq -n --arg sha "$1" --arg c "$2" --arg t "$3" --arg s "$cuerpo" \
      '{name:"riesgo", head_sha:$sha, status:"completed", conclusion:$c, output:{title:$t, summary:("```\n"+$s+"\n```")}}'
  fi | gh api -X POST "repos/$REPO/check-runs" --input - --jq .html_url
}

total=0
for PR in "$@"; do
  [[ "$PR" =~ ^[0-9]+$ ]] || { echo "riesgo-ci: PR inválido $PR" >&2; total=1; continue; }
  F1=$(foto "$PR"); read -r HEAD BASE BASE_SHA _ ESTADO <<< "$F1"
  [ "$ESTADO" = open ] || { echo "riesgo-ci: #$PR no está abierto; nada que publicar"; continue; }
  jq -r '.body // ""' "$TMP/pr.json" > "$TMP/cuerpo.md"
  publicar "$HEAD" en_progreso "riesgo: evaluando (scripts de main ${SCRIPTS_SHA:0:7})" /dev/null >/dev/null
  RC=0
  if git fetch -q origin "refs/pull/$PR/head" "+refs/heads/$BASE:refs/remotes/origin/$BASE" && git cat-file -e "$HEAD^{commit}"; then
    node "$AQUI/risk.mjs" verificar "$BASE_SHA" "$HEAD" "$TMP/cuerpo.md" > "$TMP/out" 2>&1 || RC=$?
  else
    echo "riesgo-ci: no se pudo traer HEAD $HEAD o base $BASE: sin veredicto" > "$TMP/out"; RC=1
  fi
  echo "== #$PR head=$HEAD base=$BASE@${BASE_SHA:0:7} scripts=${SCRIPTS_SHA:0:7} rc=$RC"; cat "$TMP/out"
  F2=$(foto "$PR"); M2=$(main_actual)
  if [ "$F2" != "$F1" ] || [ "$M2" != "$SCRIPTS_SHA" ]; then
    printf 'caducado: el PR o main cambiaron durante la evaluación\nantes: %s · scripts %s\nahora: %s · main %s\n' "$F1" "$SCRIPTS_SHA" "$F2" "$M2" >> "$TMP/out"
    publicar "$HEAD" failure "riesgo: caducado (el evento siguiente re-evalúa)" "$TMP/out"; total=1; continue
  fi
  if [ "$RC" = 0 ]; then
    publicar "$HEAD" success "riesgo: OK" "$TMP/out"
    F3=$(foto "$PR"); M3=$(main_actual)
    if [ "$F3" != "$F1" ] || [ "$M3" != "$SCRIPTS_SHA" ]; then
      printf 'caducado tras publicar\nahora: %s · main %s\n' "$F3" "$M3" >> "$TMP/out"
      publicar "$HEAD" failure "riesgo: caducado (el evento siguiente re-evalúa)" "$TMP/out"; total=1
    fi
  else
    publicar "$HEAD" failure "riesgo: RECHAZADO o sin veredicto (exit $RC)" "$TMP/out"; total=1
  fi
done
exit "$total"
