#!/usr/bin/env bash
# P-03 · publica el check "riesgo" de un PR con protocolo pendiente → final → revalidación
# (Codex #82, P1: un `edited`/retarget entre la foto y el POST no puede dejar un verde
# viejo). Lo corre .github/workflows/riesgo.yml desde la revisión ACTUAL de main.
#
#   scripts/collab/riesgo-ci.sh <PR[:HEAD]>...     (env: GH_TOKEN, GITHUB_REPOSITORY)
# Con `N:HEAD` (lo que pasa riesgo.yml desde la lista) un PR cuya primera foto falla
# recibe igual `failure` sobre el HEAD listado (Codex #82, P1).
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
declare -A PUBLICADO_FALLA=()  # HEAD → 1 si este lote ya publicó failure sobre él

foto() { # $1 = PR → "head base base_sha body_sha256 state"; exit ≠ 0 si algo falla
  # Se llama siempre desde `x=$(foto) || …`, donde errexit no rige dentro de la función:
  # cada paso se valida a mano (Codex #82, P1), así una API caída no pasa por "no abierto".
  local h b s st c
  gh api "repos/$REPO/pulls/$1" > "$TMP/pr.json" || return 1
  h=$(jq -er .head.sha "$TMP/pr.json") || return 1
  b=$(jq -er .base.ref "$TMP/pr.json") || return 1
  st=$(jq -er .state "$TMP/pr.json") || return 1
  [[ "$h" =~ ^[0-9a-f]{40}$ ]] || return 1
  case "$st" in open|closed) ;; *) return 1 ;; esac
  s=$(git ls-remote origin "refs/heads/$b" | cut -f1) || return 1
  c=$(jq -r '.body // ""' "$TMP/pr.json" | sha256sum | cut -d' ' -f1) || return 1
  echo "$h $b ${s:-sin-base} $c $st"
}
# Nunca aborta (Codex #82, P1): si ls-remote falla devuelve un marcador que no coincide con
# SCRIPTS_SHA, así la comparación publica `failure` en vez de dejar vivo un success.
# Si el PR avanzó durante la evaluación, el HEAD NUEVO también se invalida: puede tener un
# verde viejo (force-push a un commit ya evaluado; Codex #82, P1).
invalidar_nuevo() { # $1 = foto nueva, $2 = HEAD evaluado
  local hn; hn=${1%% *}
  if [[ "$hn" =~ ^[0-9a-f]{40}$ ]] && [ "$hn" != "$2" ]; then
    publicar "$hn" failure "riesgo: caducado (el PR avanzó durante la evaluación; el evento siguiente re-evalúa)" "$TMP/out" || true
  fi
}
main_actual() { local m; m=$(git ls-remote origin refs/heads/main 2>/dev/null | cut -f1) || m=""; echo "${m:-__sin-main__}"; }
publicar() { # $1 sha, $2 status|conclusion, $3 título, $4 archivo de resumen
  local cuerpo
  cuerpo=$(head -c 60000 "$4" 2>/dev/null || echo "sin salida")
  if [ "$2" = en_progreso ]; then
    jq -n --arg sha "$1" --arg t "$3" '{name:"riesgo", head_sha:$sha, status:"in_progress", output:{title:$t, summary:$t}}'
  else
    jq -n --arg sha "$1" --arg c "$2" --arg t "$3" --arg s "$cuerpo" \
      '{name:"riesgo", head_sha:$sha, status:"completed", conclusion:$c, output:{title:$t, summary:("```\n"+$s+"\n```")}}'
  fi > "$TMP/check.json"
  # reintentos: un POST que falla de forma transitoria no puede cortar el lote y dejar
  # verdes viejos en los HEAD que faltaban (Codex #82, P1); si igual falla, el lote sigue
  # y termina en rojo
  local i
  for i in 1 2 3; do
    if gh api -X POST "repos/$REPO/check-runs" --input "$TMP/check.json" --jq .html_url; then
      [ "$2" != failure ] || PUBLICADO_FALLA[$1]=1
      return 0
    fi
    sleep "$i"
  done
  echo "riesgo-ci: no se pudo publicar el check sobre $1 tras 3 intentos" >&2
  return 1
}


total=0
VERDES=()
# Antes de evaluar ninguno, TODOS los HEAD de la foto pasan a en_progreso: en una
# re-evaluación global (política endurecida en main) un PR que espera su turno no puede
# conservar el verde de la política vieja (Codex #82, P2).
declare -A LISTADO=()
ARGS=()
for arg in "$@"; do
  n=${arg%%:*}; h=""; [ "$n" = "$arg" ] || h=${arg#*:}
  [[ "$n" =~ ^[0-9]+$ ]] || { echo "riesgo-ci: PR inválido $arg" >&2; total=1; continue; }
  [[ -z "$h" || "$h" =~ ^[0-9a-f]{40}$ ]] || { echo "riesgo-ci: HEAD inválido $arg" >&2; total=1; continue; }
  # el primero manda (riesgo.yml pone primero la lista de la API); duplicados posteriores se ignoran
  if [ -z "${LISTADO[$n]+x}" ]; then ARGS+=("$n"); LISTADO[$n]=$h; fi
done
set -- "${ARGS[@]+"${ARGS[@]}"}"
sin_foto() { # $1 = PR: sin foto no hay veredicto; si se conoce el HEAD listado, se invalida
  echo "riesgo-ci: sin foto de #$1 (API caída o respuesta inválida): sin veredicto" > "$TMP/out"
  if [ -n "${LISTADO[$1]:-}" ]; then publicar "${LISTADO[$1]}" failure "riesgo: sin veredicto (no se pudo leer el PR)" "$TMP/out" || true; fi
}
for PR in "$@"; do
  F0=$(foto "$PR") || { sin_foto "$PR"; total=1; continue; }
  read -r H0 _ _ _ E0 <<< "$F0"
  if [ "$E0" = open ]; then publicar "$H0" en_progreso "riesgo: en cola de re-evaluación (scripts de main ${SCRIPTS_SHA:0:7})" /dev/null >/dev/null || total=1; fi
done
for PR in "$@"; do
  F1=$(foto "$PR") || { sin_foto "$PR"; total=1; continue; }; read -r HEAD BASE BASE_SHA _ ESTADO <<< "$F1"
  [ "$ESTADO" = open ] || { echo "riesgo-ci: #$PR no está abierto; nada que publicar"; continue; }
  jq -r '.body // ""' "$TMP/pr.json" > "$TMP/cuerpo.md"
  publicar "$HEAD" en_progreso "riesgo: evaluando (scripts de main ${SCRIPTS_SHA:0:7})" /dev/null >/dev/null || total=1
  RC=0
  if git fetch -q origin "refs/pull/$PR/head" "+refs/heads/$BASE:refs/remotes/origin/$BASE" && git cat-file -e "$HEAD^{commit}"; then
    node "$AQUI/risk.mjs" verificar "$BASE_SHA" "$HEAD" "$TMP/cuerpo.md" > "$TMP/out" 2>&1 || RC=$?
  else
    echo "riesgo-ci: no se pudo traer HEAD $HEAD o base $BASE: sin veredicto" > "$TMP/out"; RC=1
  fi
  echo "== #$PR head=$HEAD base=$BASE@${BASE_SHA:0:7} scripts=${SCRIPTS_SHA:0:7} rc=$RC"; cat "$TMP/out"
  F2=$(foto "$PR" 2>/dev/null || echo "__sin-foto__"); M2=$(main_actual)
  if [ "$F2" != "$F1" ] || [ "$M2" != "$SCRIPTS_SHA" ]; then
    printf 'caducado: el PR o main cambiaron durante la evaluación\nantes: %s · scripts %s\nahora: %s · main %s\n' "$F1" "$SCRIPTS_SHA" "$F2" "$M2" >> "$TMP/out"
    publicar "$HEAD" failure "riesgo: caducado (el evento siguiente re-evalúa)" "$TMP/out" || true; invalidar_nuevo "$F2" "$HEAD"; total=1; continue
  fi
  if [ "$RC" = 0 ]; then
    publicar "$HEAD" success "riesgo: OK" "$TMP/out" || total=1
    F3=$(foto "$PR" 2>/dev/null || echo "__sin-foto__"); M3=$(main_actual)
    if [ "$F3" != "$F1" ] || [ "$M3" != "$SCRIPTS_SHA" ]; then
      printf 'caducado tras publicar\nahora: %s · main %s\n' "$F3" "$M3" >> "$TMP/out"
      publicar "$HEAD" failure "riesgo: caducado (el evento siguiente re-evalúa)" "$TMP/out" || true; invalidar_nuevo "$F3" "$HEAD"; total=1
    else
      VERDES+=("$PR|$HEAD|$F1")
    fi
  else
    publicar "$HEAD" failure "riesgo: RECHAZADO o sin veredicto (exit $RC)" "$TMP/out" || true; total=1
  fi
done
# Conciliación por HEAD, no por número (Codex #82, P1 ×2): con RIESGO_GLOBAL=1 se vuelve a
# listar los PR abiertos hacia main y TODO HEAD listado que no sea un verde de este lote
# recibe `failure` "sin veredicto": cubre PR que entraron durante el lote (apertura o
# retarget) y PR —rechazados o no— que avanzaron a otro HEAD (que puede tener un verde viejo).
# El evento que los cambió vuelve a evaluar (carril serial; su pasada previa los pone en_progreso).
if [ "${RIESGO_GLOBAL:-0}" = 1 ]; then
  VERDES_HEADS=" "
  for v in "${VERDES[@]+"${VERDES[@]}"}"; do IFS='|' read -r _ hv _ <<< "$v"; VERDES_HEADS+="$hv "; done
  if LISTA=$(gh api "repos/$REPO/pulls?state=open&base=main&per_page=100" --paginate --jq '.[] | "\(.number) \(.head.sha)"'); then
    while read -r N H; do
      [ -n "${N:-}" ] || continue
      case "$VERDES_HEADS" in *" $H "*) continue ;; esac
      [ "${PUBLICADO_FALLA[$H]:-}" = 1 ] && continue
      echo "riesgo-ci: #$N @ ${H:0:7} no tiene veredicto de este lote (entró o cambió de HEAD durante la corrida): sin veredicto hasta la corrida siguiente" > "$TMP/out"
      publicar "$H" failure "riesgo: sin veredicto (HEAD sin evaluar en este lote)" "$TMP/out" || true
      total=1
    done <<< "$LISTA"
  else
    echo "riesgo-ci: no se pudo volver a listar los PR hacia main" >&2; total=1
  fi
fi
# Conciliación final (Codex #82, P1), lo ÚLTIMO que corre —después de la conciliación
# de PR nuevos, así un main que avanzó mientras tanto también invalida (Codex #82, ronda 6)—: mientras se evaluaban los PR siguientes, el cuerpo,
# la base o main de uno ya verde pudieron cambiar. Se relee cada verde del lote y, si su
# foto o main ya no coinciden, se pisa con `failure` "caducado".
for v in "${VERDES[@]}"; do
  IFS='|' read -r PR HEAD F1 <<< "$v"
  FX=$(foto "$PR" 2>/dev/null || echo "__sin-foto__"); MX=$(main_actual)
  if [ "$FX" != "$F1" ] || [ "$MX" != "$SCRIPTS_SHA" ]; then
    printf 'caducado en la conciliación final del lote
antes: %s · scripts %s
ahora: %s · main %s\n' "$F1" "$SCRIPTS_SHA" "$FX" "$MX" > "$TMP/out"
    publicar "$HEAD" failure "riesgo: caducado (el evento siguiente re-evalúa)" "$TMP/out" || true; invalidar_nuevo "$FX" "$HEAD"; total=1
  fi
done
exit "$total"
