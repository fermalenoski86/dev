#!/bin/bash
# P-04 · Política de fallas de CI, comprobable (AGENTS.md §Fallas de CI):
#   - `retries` de Playwright siempre 0 (#26, DECISIONES 2026-10-09): en las configs, por suite
#     en e2e/ y e2e-platform/, y `--retries` en workflows o package.json;
#   - timeouts de Playwright (config y por test/aserción en e2e/, e2e-platform/; solo literales
#     numéricos, una expresión o constante se rechaza) y
#     `timeout-minutes` de gates.yml iguales a la foto en
#     scripts/ci/umbrales.txt: cambiarlos exige decisión y auditoría explícitas, con la
#     foto regenerada en el mismo PR (`generar`) y la decisión citada en el PR;
#   - ningún `.only(` (con o sin espacio, o `["only"]`) en tests; ningún `.skip(`/`.fixme(` en las E2E que gates.yml corre
#     directamente (e2e/, e2e-platform/): un test que no corre no es un test verde.
#   uso: scripts/ci/politica-fallas.sh check     → exit 1 si algo no cumple
#        scripts/ci/politica-fallas.sh generar   → reescribe umbrales.txt (solo con decisión)
set -uo pipefail
RAIZ=${P04_RAIZ:-$(cd "$(dirname "$0")/../.." && pwd)}
FOTO=$RAIZ/scripts/ci/umbrales.txt
cd "$RAIZ" || exit 2
PW=$(ls playwright*.config.ts 2>/dev/null)
Q="[\"'\`]"   # comilla que puede rodear una clave de objeto: " ' `
# foto sin números de línea (una edición arriba no la invalida): archivo, job si lo hay, clave y valor, en orden
foto() {
  # `clave :` (espacio antes de los dos puntos) es válido en TS: se normaliza a `clave:` (Codex #75 sobre cb6901f).
  # Clave entre comillas (`"timeout": N`, `'actionTimeout': N`) también: se le sacan las comillas, así que
  # la foto no cambia por citarla pero sí por cambiar el valor (AUDIT #75 sobre 15f7c8a). $Q = ["'`]
  for f in $PW; do grep -E "^[[:space:]]*$Q?(retries|timeout|expect)$Q?[[:space:]]*:" "$f" | sed -E "s#^[[:space:]]*#$f #;s#^($f )$Q?(retries|timeout|expect)$Q?#\\1\\2#;s/[[:space:]]+/ /g;s/ :/:/;s/,?[[:space:]]*(\/\/.*)?$//"
    grep -oE "$Q?\b(action|navigation)Timeout$Q?[[:space:]]*:[[:space:]]*[A-Za-z0-9_.]+" "$f" | sed -E "s#^$Q?#$f #;s/$Q?[[:space:]]*:[[:space:]]*/: /;s/[[:space:]]+/ /g"; done
  awk '/^  [a-z0-9-]+:$/{job=$1} /^[ \t]*timeout-minutes:/{gsub(/^[ \t]+|[ \t]+$/,""); gsub(/[ \t]+/," "); print ".github/workflows/gates.yml " job " " $0}' .github/workflows/gates.yml
  # timeouts por test/aserción en las E2E de gate (test.setTimeout, { timeout: N }, setDefault*Timeout):
  # subir uno de estos tapa una falla igual que subir el de la config. Cuenta por archivo y valor,
  # orden estable (LC_ALL=C), sin números de línea.
  for d in e2e e2e-platform; do
    [ -d "$d" ] || continue
    grep -rHoE --include='*.ts' -e '\.set(Default)?(Navigation)?Timeout\([^)]*\)' -e "$Q?\b([a-z]+T|t)imeout$Q?[[:space:]]*:[[:space:]]*[A-Za-z0-9_.]+" "$d" 2>/dev/null \
      | grep -v node_modules | sed -E "s/^([^:]+):$Q?/\\1 /;s/$Q?[[:space:]]*:[[:space:]]*/: /" | LC_ALL=C sort | uniq -c | sed -E 's/^[[:space:]]*([0-9]+) (.*)$/\2 ×\1/'
  done
}
case "${1:-check}" in
  generar) foto > "$FOTO"; echo "politica-fallas: foto escrita en $FOTO"; exit 0 ;;
  check) ;;
  *) echo "uso: $0 check|generar" >&2; exit 2 ;;
esac
fallos=0
# 1. retries: 0, ocurrencia por ocurrencia (AUDIT #75 sobre cb6901f: una línea con un retries
#    permitido y otro prohibido no se valida entera). Vale sólo el literal 0 seguido de `,`, `}`,
#    comentario o fin de línea; la clave puede ir entre comillas o con espacio antes de `:`.
#    Cubre las configs raíz y las E2E de gate (por suite: test.describe.configure({ retries: N }))
#    y `--retries` en workflows y package.json: Playwright respeta todos.
MAL=$( { { for f in $PW; do echo "$f"; done; for d in e2e e2e-platform; do [ -d "$d" ] && grep -rl --include='*.ts' 'retries' "$d" | grep -v node_modules; done; } | sort -u | while read -r f; do
  awk -v f="$f" '{
    s = $0
    while (match(s, /(^|[^A-Za-z0-9_$])retries["'"'"'`]?[ \t]*:/)) {
      r = substr(s, RSTART + RLENGTH)
      if (r !~ /^[ \t]*0[ \t]*(,|}|\/\/|$)/) { print f ":" FNR ": " $0; break }
      s = r
    }
  }' "$f"; done
  for f in .github/workflows/*.yml package.json; do [ -f "$f" ] || continue
    awk -v f="$f" '{
      s = $0
      while (match(s, /--retries([^A-Za-z0-9_-]|$)/)) {
        r = substr(s, RSTART + 9)
        if (r !~ /^[= ]0([ \t"'"'"';]|$)/) { print f ":" FNR ": " $0; break }
        s = r
      }
    }' "$f"; done; } \
  | sed 's/^/politica-fallas: retries — /;s/$/ — retries tiene que ser 0 (literal)/')
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
    while (match(s, /(^|[^A-Za-z0-9_$])([a-z]+T|t)imeout["'"'"'`]?[ \t]*:/)) {
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
# 3. .only y skips en E2E. Skips/slow/fail por cualquier receptor (test, describe, testInfo,
#    test.info(), un alias…): `.slow()` triplica el timeout sin tocar la foto y `.fail()` vuelve
#    verde un test roto (Codex #75 sobre ecb774f).
#    Espacios o saltos antes del paréntesis y acceso con corchetes (`test.only (`, `test["only"](`)
#    son JS válido y enfocan igual (AUDIT #75 sobre cb6901f). El análisis es por archivo entero, no
#    por línea: `test[\n"only"\n](`, `test.\nonly(` también enfocan (Codex #75 sobre 886d2e4). Cuenta
#    como uso el modificador seguido de `(`, `.`, `[` o una plantilla (`test.only.each(…)`); una
#    propiedad suelta (`solo.only`) no. Salida `archivo:línea:texto` (línea donde empieza el acceso).
modificadores() { # $1 = nombres (alternativa perl); stdin = archivos separados por NUL
  P04_MODS="$1" xargs -0 -r perl -0777 -ne '
    my $n = $ENV{P04_MODS};
    while (/(?:\.\s*(?:$n)|\[\s*(["\x27`])(?:$n)\1\s*\])\s*[(.\[`]/g) {
      my $l = 1 + (substr($_, 0, $-[0]) =~ tr/\n//);
      print "$ARGV:$l:" . (split /\n/, $_, -1)[$l - 1] . "\n";
    }'
}
ONLY=$(find apps packages scripts e2e e2e-platform -type d -name node_modules -prune -o -type f \( -name '*.test.ts' -o -name '*.spec.ts' -o -name '*.test.mjs' -o -name '*.test.js' \) -print0 2>/dev/null \
  | modificadores 'only' | sed 's/^/politica-fallas: .only — /')
[ -z "$ONLY" ] || { echo "$ONLY"; fallos=1; }
SKIP=$(find e2e e2e-platform -type d -name node_modules -prune -o -type f -print0 2>/dev/null \
  | modificadores 'skip|fixme|slow|fail' | sed 's/^/politica-fallas: skip\/fixme\/slow\/fail en E2E de gate — /')
[ -z "$SKIP" ] || { echo "$SKIP"; fallos=1; }
if [ "$fallos" = 0 ]; then echo "politica-fallas: OK (retries 0, umbrales = foto, sin .only ni skips en E2E)"; exit 0; fi
exit 1
