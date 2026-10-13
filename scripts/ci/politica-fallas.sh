#!/bin/bash
# P-04 · Política de fallas de CI, comprobable (AGENTS.md §Fallas de CI):
#   - `retries` de Playwright siempre 0 (#26, DECISIONES 2026-10-09): en las configs, por suite
#     en e2e/ y e2e-platform/, y `--retries` en workflows o package.json;
#   - timeouts de Playwright (config y por test/aserción en e2e/, e2e-platform/; solo literales
#     numéricos, una expresión o constante se rechaza) y
#     `timeout-minutes` de gates.yml iguales a la foto en
#     scripts/ci/umbrales.txt: cambiarlos exige decisión y auditoría explícitas, con la
#     foto regenerada en el mismo PR (`generar`) y la decisión citada en el PR;
#   - ningún `.only(` en tests; ningún `.skip(`/`.fixme(` en las E2E que gates.yml corre
#     directamente (e2e/, e2e-platform/): un test que no corre no es un test verde.
#   uso: scripts/ci/politica-fallas.sh check     → exit 1 si algo no cumple
#        scripts/ci/politica-fallas.sh generar   → reescribe umbrales.txt (solo con decisión)
set -uo pipefail
RAIZ=${P04_RAIZ:-$(cd "$(dirname "$0")/../.." && pwd)}
FOTO=$RAIZ/scripts/ci/umbrales.txt
cd "$RAIZ" || exit 2
PW=$(ls playwright*.config.ts 2>/dev/null)
# foto sin números de línea (una edición arriba no la invalida): archivo, job si lo hay, clave y valor, en orden
foto() {
  for f in $PW; do grep -E '^[[:space:]]*(retries|timeout|expect):' "$f" | sed -E "s#^[[:space:]]*#$f #;s/[[:space:]]+/ /g;s/,?[[:space:]]*(\/\/.*)?$//"
    grep -oE '\b(action|navigation)Timeout:[[:space:]]*[A-Za-z0-9_.]+' "$f" | sed -E "s#^#$f #;s/[[:space:]]+/ /g"; done
  awk '/^  [a-z0-9-]+:$/{job=$1} /^[ \t]*timeout-minutes:/{gsub(/^[ \t]+|[ \t]+$/,""); gsub(/[ \t]+/," "); print ".github/workflows/gates.yml " job " " $0}' .github/workflows/gates.yml
  # timeouts por test/aserción en las E2E de gate (test.setTimeout, { timeout: N }, setDefault*Timeout):
  # subir uno de estos tapa una falla igual que subir el de la config. Cuenta por archivo y valor,
  # orden estable (LC_ALL=C), sin números de línea.
  for d in e2e e2e-platform; do
    [ -d "$d" ] || continue
    grep -rHoE --include='*.ts' -e '\.set(Default)?(Navigation)?Timeout\([^)]*\)' -e '\b([a-z]+T|t)imeout:[[:space:]]*[A-Za-z0-9_.]+' "$d" 2>/dev/null \
      | grep -v node_modules | sed -E 's/:[[:space:]]+/: /;s/^([^:]+):/\1 /' | LC_ALL=C sort | uniq -c | sed -E 's/^[[:space:]]*([0-9]+) (.*)$/\2 ×\1/'
  done
}
case "${1:-check}" in
  generar) foto > "$FOTO"; echo "politica-fallas: foto escrita en $FOTO"; exit 0 ;;
  check) ;;
  *) echo "uso: $0 check|generar" >&2; exit 2 ;;
esac
fallos=0
# 1. retries: 0
for f in $PW; do
  MAL=$(grep -nE '^\s*retries:' "$f" | grep -vE 'retries:\s*0\s*,?' | sed "s#^#politica-fallas: $f:#;s/\$/ — retries tiene que ser 0/")
  [ -z "$MAL" ] || { echo "$MAL"; fallos=1; }
done
# 1b. retries fuera de las configs raíz: por suite (test.describe.configure({ retries: N })) en las
#     E2E de gate y --retries en el workflow o en scripts de package.json: Playwright respeta ambos
MAL=$( { grep -rnE '\bretries[[:space:]]*:' --include='*.ts' e2e e2e-platform 2>/dev/null | grep -v node_modules | grep -vE '\bretries[[:space:]]*:[[:space:]]*0\b'
         grep -nE -- '--retries\b' .github/workflows/*.yml package.json 2>/dev/null | grep -vE -- '--retries[= ]0\b'; } \
       | sed 's/^/politica-fallas: retries fuera de las configs — /;s/$/ — retries tiene que ser 0/')
[ -z "$MAL" ] || { echo "$MAL"; fallos=1; }
# 2. timeouts y timeout-minutes = foto
[ -s "$FOTO" ] || { echo "politica-fallas: falta $FOTO (correr 'generar' con decisión)"; fallos=1; }
if [ -s "$FOTO" ] && ! diff -u "$FOTO" <(foto) > /tmp/politica-fallas.diff 2>&1; then
  cat /tmp/politica-fallas.diff
  echo "politica-fallas: timeouts/timeout-minutes distintos de la foto — subirlos o bajarlos exige decisión y auditoría explícitas (regenerar con 'generar' en el mismo PR y citar la decisión)"
  fallos=1
fi
# 2b. todo timeout de Playwright (configs y E2E de gate) es un literal numérico: la foto guarda el
#     literal, así que una expresión (`40_000 * 10`, una constante, el valor en la línea siguiente)
#     la dejaría igual con el umbral cambiado (AUDIT #75). Permitido: `clave: 40_000` seguido de `,`,
#     `}`, comentario o fin de línea, y `.set…Timeout(40_000)`.
NOLIT=$( { for f in $PW; do echo "$f"; done; for d in e2e e2e-platform; do [ -d "$d" ] && grep -rl --include='*.ts' -iE 'timeout' "$d" | grep -v node_modules; done; } | sort -u | while read -r f; do
  awk -v f="$f" '{
    s = $0
    while (match(s, /(^|[^A-Za-z0-9_$])([a-z]+T|t)imeout[ \t]*:/)) {
      r = substr(s, RSTART + RLENGTH)
      if (r !~ /^[ \t]*[0-9][0-9_]*[ \t]*(,|}|\/\/|$)/) print f ":" FNR ": " $0
      s = r
    }
    s = $0
    while (match(s, /\.set(Default)?(Navigation)?Timeout[ \t]*\(/)) {
      r = substr(s, RSTART + RLENGTH)
      if (r !~ /^[ \t]*[0-9][0-9_]*[ \t]*\)/) print f ":" FNR ": " $0
      s = r
    }
  }' "$f"; done | sed 's/^/politica-fallas: timeout no literal — /;s/$/ — tiene que ser un número literal (la foto no ve expresiones)/')
[ -z "$NOLIT" ] || { echo "$NOLIT"; fallos=1; }
# 3. .only y skips en E2E
ONLY=$(grep -rnE '\.only\(' --include='*.test.ts' --include='*.spec.ts' --include='*.test.mjs' --include='*.test.js' apps packages scripts e2e e2e-platform 2>/dev/null | grep -v node_modules | sed 's/^/politica-fallas: .only — /')
[ -z "$ONLY" ] || { echo "$ONLY"; fallos=1; }
SKIP=$(grep -rnE '\b(test|it|describe)\.(skip|fixme)\(' e2e e2e-platform 2>/dev/null | grep -v node_modules | sed 's/^/politica-fallas: skip en E2E de gate — /')
[ -z "$SKIP" ] || { echo "$SKIP"; fallos=1; }
if [ "$fallos" = 0 ]; then echo "politica-fallas: OK (retries 0, umbrales = foto, sin .only ni skips en E2E)"; exit 0; fi
exit 1
