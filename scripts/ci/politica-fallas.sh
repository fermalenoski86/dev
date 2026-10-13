#!/bin/bash
# P-04 · Política de fallas de CI, comprobable (AGENTS.md §Fallas de CI):
#   - `retries` de Playwright siempre 0 (#26, DECISIONES 2026-10-09);
#   - timeouts de Playwright (config y por test/aserción en e2e/, e2e-platform/) y
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
  for f in $PW; do grep -E '^[[:space:]]*(retries|timeout|expect):' "$f" | sed -E "s#^[[:space:]]*#$f #;s/[[:space:]]+/ /g;s/,?[[:space:]]*(\/\/.*)?$//"; done
  awk '/^  [a-z0-9-]+:$/{job=$1} /^[ \t]*timeout-minutes:/{gsub(/^[ \t]+|[ \t]+$/,""); gsub(/[ \t]+/," "); print ".github/workflows/gates.yml " job " " $0}' .github/workflows/gates.yml
  # timeouts por test/aserción en las E2E de gate (test.setTimeout, { timeout: N }, setDefault*Timeout):
  # subir uno de estos tapa una falla igual que subir el de la config. Cuenta por archivo y valor,
  # orden estable (LC_ALL=C), sin números de línea.
  for d in e2e e2e-platform; do
    [ -d "$d" ] || continue
    grep -rHoE --include='*.ts' -e '\.set(Default)?(Navigation)?Timeout\([^)]*\)' -e '\btimeout:[[:space:]]*[A-Za-z0-9_.]+' "$d" 2>/dev/null \
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
# 2. timeouts y timeout-minutes = foto
[ -s "$FOTO" ] || { echo "politica-fallas: falta $FOTO (correr 'generar' con decisión)"; fallos=1; }
if [ -s "$FOTO" ] && ! diff -u "$FOTO" <(foto) > /tmp/politica-fallas.diff 2>&1; then
  cat /tmp/politica-fallas.diff
  echo "politica-fallas: timeouts/timeout-minutes distintos de la foto — subirlos o bajarlos exige decisión y auditoría explícitas (regenerar con 'generar' en el mismo PR y citar la decisión)"
  fallos=1
fi
# 3. .only y skips en E2E
ONLY=$(grep -rnE '\.only\(' --include='*.test.ts' --include='*.spec.ts' --include='*.test.mjs' --include='*.test.js' apps packages scripts e2e e2e-platform 2>/dev/null | grep -v node_modules | sed 's/^/politica-fallas: .only — /')
[ -z "$ONLY" ] || { echo "$ONLY"; fallos=1; }
SKIP=$(grep -rnE '\b(test|it|describe)\.(skip|fixme)\(' e2e e2e-platform 2>/dev/null | grep -v node_modules | sed 's/^/politica-fallas: skip en E2E de gate — /')
[ -z "$SKIP" ] || { echo "$SKIP"; fallos=1; }
if [ "$fallos" = 0 ]; then echo "politica-fallas: OK (retries 0, umbrales = foto, sin .only ni skips en E2E)"; exit 0; fi
exit 1
