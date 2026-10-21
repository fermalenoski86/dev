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
# Con RIESGO_OBJETIVO definido (lo pasa riesgo.yml; hallazgo 3 de #54): el exit SOLO clasifica
# al PR objetivo del evento (0 si su último `riesgo` publicado quedó success) y, sin objetivo
# (push a main, `closed`, workflow viejo: RIESGO_OBJETIVO vacío), ningún PR decide el exit.
# Los veredictos de los demás PR van SOLO en su propio check-run (un rechazo de #95 ya no pinta
# de rojo el job del evento de #90); un error de infraestructura (POST o re-listado que fallan
# tras los reintentos) sí da exit 1, porque puede dejar un verde viejo sin invalidar.
#
# Aislamiento por base (AUDIT: CAMBIOS @ 94bad43, P2): el check es por SHA y un PR hacia
# otra base (rama de fase) puede compartir HEAD con uno hacia main. Su veredicto se publica
# con otro nombre (`riesgo (otra base)`) y no entra en la conciliación ni en la dominancia
# por HEAD del check `riesgo`: un rechazo suyo no pinta de rojo al PR hacia main. La base
# sale de la foto por API; si no hay foto, `N:HEAD:otra` (lo que agrega riesgo.yml para el
# PR del evento que no está en la lista de main) decide dónde va el `failure`.
set -euo pipefail
REPO=${GITHUB_REPOSITORY:?}
AQUI=$(cd "$(dirname "$0")" && pwd)
SCRIPTS_SHA=$(git rev-parse HEAD)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
declare -A PUBLICADO_FALLA=()  # HEAD → 1 si este lote ya publicó failure sobre él
declare -A FALLA_HEAD=()       # HEAD → 1 si este lote quiso publicar failure sobre él (aunque el POST fallara)
declare -A ULTIMO=()           # HEAD → última conclusión que este lote publicó con éxito sobre él
# las tres tablas de arriba son SOLO del check `riesgo` (PR hacia main); el de otra base no las toca
CHECK_MAIN=riesgo
CHECK_OTRA="riesgo (otra base)"
CHECK=$CHECK_MAIN               # nombre con el que publica `publicar` (se fija por PR)
check_de() { if [ "$1" = main ]; then echo "$CHECK_MAIN"; else echo "$CHECK_OTRA"; fi; }
# Nombre del check según una foto refrescada (AUDIT: CAMBIOS @ 9a7170b, P2): si el PR se
# retargeteó durante la evaluación, el `caducado` va al check de su base NUEVA. Sin foto
# legible se queda el nombre anterior ($2).
check_de_foto() { local b; read -r _ b _ <<< "$1"; if [ -n "${b:-}" ]; then check_de "$b"; else echo "$2"; fi; }
declare -A SALIO_MAIN=()       # HEAD → 1 si un PR que apuntaba a main se fue a otra base durante el lote
declare -A SALIO_OTRA=()       # HEAD → 1 si un PR que apuntaba a otra base se fue a main durante el lote
declare -A FALLA_OTRA=()       # HEAD → 1 si este lote quiso publicar failure sobre él en `riesgo (otra base)`
declare -A ULTIMO_OTRA=()      # HEAD → última conclusión publicada con éxito en `riesgo (otra base)`

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
# Publica el `caducado` de $2 con el nombre de la foto nueva $1 y, si el PR cambió de
# check (dejó main o llegó a main), anota el nombre VIEJO para cerrarlo sobre ese HEAD al
# final del lote (AUDIT: CAMBIOS @ 6c96f82, P2: el en_progreso del nombre viejo no puede
# quedar sin conclusión).
caducar() { # $1 foto nueva, $2 HEAD evaluado, $3 título
  local viejo=$CHECK
  CHECK=$(check_de_foto "$1" "$viejo")
  [ "$viejo" != "$CHECK_MAIN" ] || [ "$CHECK" = "$CHECK_MAIN" ] || SALIO_MAIN[$2]=1
  [ "$viejo" != "$CHECK_OTRA" ] || [ "$CHECK" = "$CHECK_OTRA" ] || SALIO_OTRA[$2]=1
  publicar "$2" failure "$3" "$TMP/out" || true; invalidar_nuevo "$1" "$2"
  CHECK=$viejo
}
main_actual() { local m; m=$(git ls-remote origin refs/heads/main 2>/dev/null | cut -f1) || m=""; echo "${m:-__sin-main__}"; }
publicar() { # $1 sha, $2 status|conclusion, $3 título, $4 archivo de resumen
  local cuerpo
  cuerpo=$(head -c 60000 "$4" 2>/dev/null || echo "sin salida")
  if [ "$2" = en_progreso ]; then
    jq -n --arg n "$CHECK" --arg sha "$1" --arg t "$3" '{name:$n, head_sha:$sha, status:"in_progress", output:{title:$t, summary:$t}}'
  else
    jq -n --arg n "$CHECK" --arg sha "$1" --arg c "$2" --arg t "$3" --arg s "$cuerpo" \
      '{name:$n, head_sha:$sha, status:"completed", conclusion:$c, output:{title:$t, summary:("```\n"+$s+"\n```")}}'
  fi > "$TMP/check.json"
  local m=0; [ "$CHECK" != "$CHECK_MAIN" ] || m=1
  [ "$m" = 0 ] || [ "$2" != failure ] || FALLA_HEAD[$1]=1
  [ "$m" = 1 ] || [ "$2" != failure ] || FALLA_OTRA[$1]=1
  # reintentos: un POST que falla de forma transitoria no puede cortar el lote y dejar
  # verdes viejos en los HEAD que faltaban (Codex #82, P1); si igual falla, el lote sigue
  # y termina en rojo
  local i
  for i in 1 2 3; do
    if gh api -X POST "repos/$REPO/check-runs" --input "$TMP/check.json" --jq .html_url; then
      if [ "$m" = 1 ]; then [ "$2" != failure ] || PUBLICADO_FALLA[$1]=1; ULTIMO[$1]=$2; else ULTIMO_OTRA[$1]=$2; fi
      return 0
    fi
    sleep "$i"
  done
  echo "riesgo-ci: no se pudo publicar el check sobre $1 tras 3 intentos" >&2
  INFRA=1
  return 1
}


total=0
INFRA=0                        # 1 si falló un POST o el re-listado (no es el veredicto de un PR)
VERDES=()
# Antes de evaluar ninguno, TODOS los HEAD de la foto pasan a en_progreso: en una
# re-evaluación global (política endurecida en main) un PR que espera su turno no puede
# conservar el verde de la política vieja (Codex #82, P2).
declare -A LISTADO=()
declare -A OTRA=()             # PR → 1 si riesgo.yml lo marcó fuera de la lista de main (N:HEAD:otra)
ARGS=()
for arg in "$@"; do
  o=0; case "$arg" in *:otra) o=1; arg=${arg%:otra} ;; esac
  n=${arg%%:*}; h=""; [ "$n" = "$arg" ] || h=${arg#*:}
  [[ "$n" =~ ^[0-9]+$ ]] || { echo "riesgo-ci: PR inválido $arg" >&2; total=1; continue; }
  [[ -z "$h" || "$h" =~ ^[0-9a-f]{40}$ ]] || { echo "riesgo-ci: HEAD inválido $arg" >&2; total=1; continue; }
  # el primero manda (riesgo.yml pone primero la lista de la API); duplicados posteriores se ignoran
  if [ -z "${LISTADO[$n]+x}" ]; then ARGS+=("$n"); LISTADO[$n]=$h; [ "$o" = 0 ] || OTRA[$n]=1; fi
done
set -- "${ARGS[@]+"${ARGS[@]}"}"
sin_foto() { # $1 = PR: sin foto no hay veredicto; si se conoce el HEAD listado, se invalida
  echo "riesgo-ci: sin foto de #$1 (API caída o respuesta inválida): sin veredicto" > "$TMP/out"
  if [ -n "${OTRA[$1]:-}" ]; then CHECK=$CHECK_OTRA; else CHECK=$CHECK_MAIN; fi
  if [ -n "${LISTADO[$1]:-}" ]; then publicar "${LISTADO[$1]}" failure "riesgo: sin veredicto (no se pudo leer el PR)" "$TMP/out" || true; fi
}
for PR in "$@"; do
  F0=$(foto "$PR") || { sin_foto "$PR"; total=1; continue; }
  read -r H0 B0 _ _ E0 <<< "$F0"; CHECK=$(check_de "$B0")
  if [ "$E0" = open ]; then publicar "$H0" en_progreso "riesgo: en cola de re-evaluación (scripts de main ${SCRIPTS_SHA:0:7})" /dev/null >/dev/null || total=1; fi
done
for PR in "$@"; do
  F1=$(foto "$PR") || { sin_foto "$PR"; total=1; continue; }; read -r HEAD BASE BASE_SHA _ ESTADO <<< "$F1"
  CHECK=$(check_de "$BASE")
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
    caducar "$F2" "$HEAD" "riesgo: caducado (el evento siguiente re-evalúa)"; total=1; continue
  fi
  if [ "$RC" = 0 ]; then
    publicar "$HEAD" success "riesgo: OK" "$TMP/out" || total=1
    F3=$(foto "$PR" 2>/dev/null || echo "__sin-foto__"); M3=$(main_actual)
    if [ "$F3" != "$F1" ] || [ "$M3" != "$SCRIPTS_SHA" ]; then
      printf 'caducado tras publicar\nahora: %s · main %s\n' "$F3" "$M3" >> "$TMP/out"
      caducar "$F3" "$HEAD" "riesgo: caducado (el evento siguiente re-evalúa)"; total=1
    else
      VERDES+=("$PR|$HEAD|$CHECK|$F1")
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
  # por par PR:HEAD (AUDIT: CAMBIOS @ e08a47b, P1): un PR que comparte HEAD con un verde
  # pero no fue evaluado en este lote no hereda ese verde
  # solo verdes del check `riesgo`: uno de otra base que se retargeteó a main no cuenta
  for v in "${VERDES[@]+"${VERDES[@]}"}"; do IFS='|' read -r pv hv cv _ <<< "$v"; [ "$cv" = "$CHECK_MAIN" ] && VERDES_HEADS+="$pv:$hv "; done
  # re-listado con reintentos; si se agotan, ningún verde de este lote puede quedar último
  # sobre su HEAD (AUDIT: CAMBIOS @ 157a7f7, P1): se pisan todos con `failure`
  LISTA_OK=0
  for i in 1 2 3; do
    if LISTA=$(gh api "repos/$REPO/pulls?state=open&base=main&per_page=100" --paginate --jq '.[] | "\(.number) \(.head.sha)"'); then LISTA_OK=1; break; fi
    [ "$i" = 3 ] || sleep "$i"
  done
  CHECK=$CHECK_MAIN
  if [ "$LISTA_OK" = 1 ]; then
    while read -r N H; do
      [ -n "${N:-}" ] || continue
      case "$VERDES_HEADS" in *" $N:$H "*) continue ;; esac
      [ "${PUBLICADO_FALLA[$H]:-}" = 1 ] && continue
      echo "riesgo-ci: #$N @ ${H:0:7} no tiene veredicto de este lote (entró o cambió de HEAD durante la corrida): sin veredicto hasta la corrida siguiente" > "$TMP/out"
      publicar "$H" failure "riesgo: sin veredicto (HEAD sin evaluar en este lote)" "$TMP/out" || true
      total=1
    done <<< "$LISTA"
  else
    echo "riesgo-ci: no se pudo volver a listar los PR hacia main tras 3 intentos: los verdes de este lote quedan sin veredicto" | tee "$TMP/out" >&2; total=1; INFRA=1
    for v in "${VERDES[@]+"${VERDES[@]}"}"; do
      IFS='|' read -r _ hv cv _ <<< "$v"
      [ "$cv" = "$CHECK_MAIN" ] || continue
      [ "${ULTIMO[$hv]:-}" = failure ] && continue
      publicar "$hv" failure "riesgo: sin veredicto (no se pudo conciliar el lote)" "$TMP/out" || true
    done
  fi
fi
# Conciliación final (Codex #82, P1), casi lo último que corre (solo la sigue la dominancia por HEAD) —después de la conciliación
# de PR nuevos, así un main que avanzó mientras tanto también invalida (Codex #82, ronda 6)—: mientras se evaluaban los PR siguientes, el cuerpo,
# la base o main de uno ya verde pudieron cambiar. Se relee cada verde del lote y, si su
# foto o main ya no coinciden, se pisa con `failure` "caducado".
declare -A CADUCO_FINAL=()     # "PR|HEAD" → 1 si ese verde caducó en la conciliación final
for v in "${VERDES[@]+"${VERDES[@]}"}"; do
  IFS='|' read -r PR HEAD CHECK F1 <<< "$v"
  FX=$(foto "$PR" 2>/dev/null || echo "__sin-foto__"); MX=$(main_actual)
  if [ "$FX" != "$F1" ] || [ "$MX" != "$SCRIPTS_SHA" ]; then
    printf 'caducado en la conciliación final del lote
antes: %s · scripts %s
ahora: %s · main %s\n' "$F1" "$SCRIPTS_SHA" "$FX" "$MX" > "$TMP/out"
    caducar "$FX" "$HEAD" "riesgo: caducado (el evento siguiente re-evalúa)"; total=1
    CADUCO_FINAL[$PR|$HEAD]=1
  fi
done
# Dominancia por HEAD (AUDIT: CAMBIOS @ e08a47b, P1; Codex #82, P1): el check es por SHA
# y la evaluación por PR. Si dos PR comparten HEAD y uno fue rechazado (o caducó), un
# success de otro PR sobre ese SHA no puede quedar último: se republica `failure`, en
# cualquier orden de procesamiento. Solo la siguen los cierres por retarget.
# Solo entre PR hacia main (check `riesgo`): uno de otra base no domina (AUDIT: CAMBIOS @ 94bad43, P2).
declare -A DOMINADO=()
CHECK=$CHECK_MAIN
for v in "${VERDES[@]+"${VERDES[@]}"}"; do
  IFS='|' read -r PR HEAD cv _ <<< "$v"
  [ "$cv" = "$CHECK_MAIN" ] || continue
  # si lo último publicado sobre el HEAD ya es failure no hace falta repetirlo
  [ "${FALLA_HEAD[$HEAD]:-}" = 1 ] && [ "${ULTIMO[$HEAD]:-}" != failure ] && [ -z "${DOMINADO[$HEAD]:-}" ] || continue
  DOMINADO[$HEAD]=1
  echo "riesgo-ci: ${HEAD:0:7} lo comparte #$PR (verde) con otro PR rechazado, caducado o sin veredicto en este lote: manda el rechazo" > "$TMP/out"
  publicar "$HEAD" failure "riesgo: RECHAZADO (otro PR con el mismo HEAD no pasó)" "$TMP/out" || true
  total=1
done
# Cierre de `riesgo` por retarget (AUDIT: CAMBIOS @ 9a7170b, P2). Un PR que dejó main durante
# el lote publicó su `caducado` en `riesgo (otra base)`, pero antes había dejado en `riesgo`
# un en_progreso (o un success) sobre su HEAD. Con el cierre simétrico de abajo, es lo último del lote:
#  - si ese HEAD tiene un verde VÁLIDO de un PR hacia main de este lote (sobrevivió a la
#    conciliación final) y ningún PR hacia main falló sobre él → se republica su success
#    (el PR que se fue no lo bloquea, como pide el aislamiento por base);
#  - si no lo tiene → `failure` en `riesgo`, para que no quede vivo el success del PR que se fue.
declare -A VALIDO=()
for v in "${VERDES[@]+"${VERDES[@]}"}"; do
  IFS='|' read -r PR HEAD cv _ <<< "$v"
  [ "$cv" = "$CHECK_MAIN" ] && [ -z "${CADUCO_FINAL[$PR|$HEAD]:-}" ] && VALIDO[$HEAD]=1
done
CHECK=$CHECK_MAIN
for H in "${!SALIO_MAIN[@]}"; do
  if [ -n "${VALIDO[$H]:-}" ]; then
    [ "${FALLA_HEAD[$H]:-}" != 1 ] && [ "${ULTIMO[$H]:-}" != success ] || continue
    echo "riesgo-ci: ${H:0:7} tiene un verde válido hacia main; el PR que compartía HEAD se fue a otra base durante el lote" > "$TMP/out"
    publicar "$H" success "riesgo: OK (re-publicado tras el retarget de otro PR con este HEAD)" "$TMP/out" || total=1
  else
    [ "${ULTIMO[$H]:-}" != failure ] || continue
    echo "riesgo-ci: ${H:0:7} quedó sin PR hacia main con veredicto válido (el PR se fue a otra base durante el lote)" > "$TMP/out"
    publicar "$H" failure "riesgo: caducado (el PR dejó de apuntar a main)" "$TMP/out" || true
    total=1
  fi
done
# Cierre de `riesgo (otra base)` por retarget hacia main (AUDIT: CAMBIOS @ 6c96f82, P2), el
# simétrico del de arriba: el PR publicó su `caducado` en `riesgo`, pero antes había dejado en
# `riesgo (otra base)` un en_progreso (o un success) sobre su HEAD. Solo toca ese nombre:
#  - si otro PR hacia otra base de este lote tiene un verde VÁLIDO sobre ese HEAD y ningún
#    PR hacia otra base falló sobre él → se republica su success (no se lo ensucia);
#  - si no → `failure` (cerrado a falla: nunca queda en_progreso ni el success del que se fue;
#    un PR hacia otra base que no estaba en el lote se re-evalúa en su próximo evento).
declare -A VALIDO_OTRA=()
for v in "${VERDES[@]+"${VERDES[@]}"}"; do
  IFS='|' read -r PR HEAD cv _ <<< "$v"
  [ "$cv" = "$CHECK_OTRA" ] && [ -z "${CADUCO_FINAL[$PR|$HEAD]:-}" ] && VALIDO_OTRA[$HEAD]=1
done
CHECK=$CHECK_OTRA
for H in "${!SALIO_OTRA[@]}"; do
  if [ -n "${VALIDO_OTRA[$H]:-}" ] && [ "${FALLA_OTRA[$H]:-}" != 1 ]; then
    [ "${ULTIMO_OTRA[$H]:-}" != success ] || continue
    echo "riesgo-ci: ${H:0:7} tiene un verde válido hacia otra base; el PR que compartía HEAD se fue a main durante el lote" > "$TMP/out"
    publicar "$H" success "riesgo: OK (re-publicado tras el retarget de otro PR con este HEAD)" "$TMP/out" || total=1
  else
    [ "${ULTIMO_OTRA[$H]:-}" != failure ] || continue
    echo "riesgo-ci: ${H:0:7} quedó sin PR hacia otra base con veredicto válido en este lote (el PR se fue a main durante el lote)" > "$TMP/out"
    publicar "$H" failure "riesgo: caducado (el PR pasó a apuntar a main)" "$TMP/out" || true
    total=1
  fi
done
# Exit por objetivo (hallazgo 3 de #54): con RIESGO_OBJETIVO definido, solo el PR del evento
# decide; los demás ya tienen su veredicto en su propio check-run.
if [ -n "${RIESGO_OBJETIVO+x}" ]; then
  RC_OBJ=$INFRA
  if [ -n "$RIESGO_OBJETIVO" ]; then
    OK_OBJ=0
    for v in "${VERDES[@]+"${VERDES[@]}"}"; do
      IFS='|' read -r pv hv cv _ <<< "$v"
      [ "$pv" = "$RIESGO_OBJETIVO" ] || continue
      [ -z "${CADUCO_FINAL[$pv|$hv]:-}" ] || continue
      if [ "$cv" = "$CHECK_MAIN" ]; then u=${ULTIMO[$hv]:-}; else u=${ULTIMO_OTRA[$hv]:-}; fi
      [ "$u" = success ] && OK_OBJ=1
    done
    [ "$OK_OBJ" = 1 ] || RC_OBJ=1
    echo "riesgo-ci: objetivo #$RIESGO_OBJETIVO → $([ "$OK_OBJ" = 1 ] && echo success || echo 'no success')"
  fi
  [ "$total" = 0 ] || [ "$RC_OBJ" != 0 ] || echo "riesgo-ci: otros PR del lote quedaron rechazados o sin veredicto en su propio check (no cambian el resultado de esta ejecución)"
  exit "$RC_OBJ"
fi
exit "$total"
