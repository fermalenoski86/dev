#!/usr/bin/env bash
# P-05 · Prueba de paralelo.sh sobre un remoto bare local.
# Criterio (ChatGPT, #53): el lateral no toca HANDOFF ni la rama en auditoría ni
# sus archivos; se pospone si comparte archivos; concurrencia (dos laterales,
# HANDOFF que cambia en main mientras el lateral está abierto) y ausencia de
# merges fuera de orden (el lateral que comparte archivos queda rojo hasta que
# el PR de la fase se mergea).
set -euo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=t@t
ok=0; fallos=0
check() { if eval "$2"; then echo "  ✓ $1"; ok=$((ok+1)); else echo "  ✗ $1"; fallos=$((fallos+1)); fi; }
P=scripts/collab/paralelo.sh
# corre el script desde el clon "ci" y guarda exit code + stderr
corre() { set +e; (cd "$T/ci" && git fetch -q origin && $P "$@" >"$T/out" 2>"$T/err"); RC=$?; set -e; }

# escribe HANDOFF en main del remoto (como lo haría handoff.sh): $1 pelota, $2 línea "En auditoría" (opcional)
handoff_main() {
  (cd "$T/semilla" && git checkout -q main && git pull -q origin main \
    && { printf '# HANDOFF\n\n**Pelota en:** %s — test\n' "$1"; [ -n "${2:-}" ] && printf '**En auditoría:** %s\n' "$2"; true; } > docs/collab/HANDOFF.md \
    && { git diff --quiet || git commit -qam "handoff: $1 ${2:-}"; } && git push -q origin main)
}
# simula GitHub: refs/pull/N/head apunta al HEAD actual del PR N
pr_head() { git -C "$T/remoto.git" update-ref "refs/pull/$1/head" "$2"; }
# crea una rama desde main que toca los archivos dados; imprime el sha
rama() { # $1 nombre, resto archivos
  local n=$1; shift
  (cd "$T/semilla" && git checkout -q main && git pull -q origin main && git checkout -q -B "$n" main \
    && for f in "$@"; do mkdir -p "$(dirname "$f")"; echo "$n $RANDOM" >> "$f"; git add "$f"; done \
    && git commit -qm "$n" && git push -q -f origin "$n" && git rev-parse HEAD)
}

git init -q --bare -b main "$T/remoto.git"
git init -q -b main "$T/semilla" && cd "$T/semilla"
mkdir -p docs/collab scripts/collab .github/workflows scripts/ci && cp "$AQUI/paralelo.sh" "$AQUI/handoff.sh" scripts/collab/
printf '# HANDOFF\n\n**Pelota en:** Claude — inicio\n' > docs/collab/HANDOFF.md
echo a > a.txt; echo b > b.txt; echo gates > .github/workflows/gates.yml; echo run > scripts/ci/run.sh
git add -A && git commit -qm init && git remote add origin "$T/remoto.git" && git push -q origin main
git clone -q "$T/remoto.git" "$T/ci"

echo "1) PR #7 (fase) toca a.txt; Claude lo entrega: pelota a ChatGPT con 'En auditoría: #7 @ sha'"
S7=$(rama fase/x a.txt); pr_head 7 "$S7"
handoff_main ChatGPT "#7 @ $S7"
check "el HANDOFF escrito pasa validar (handoff.sh)" '(cd "$T/ci" && git fetch -q origin && git show origin/main:docs/collab/HANDOFF.md > "$T/h.md" && scripts/collab/handoff.sh validar "$T/h.md" >/dev/null)'
corre 7 "$S7"; check "el PR en auditoría con su HEAD exacto → OK" '[ "$RC" = 0 ]'

echo "2) la rama en auditoría se modifica mientras la pelota es de ChatGPT"
S7b=$(rama fase/x a.txt); pr_head 7 "$S7b"   # nuevo commit sobre la misma rama (otro sha)
corre 7 "$S7b"; check "nuevo HEAD en el PR auditado → exit 6" '[ "$RC" = 6 ]'
check "el mensaje nombra el sha auditado y el nuevo" 'grep -q "${S7:0:7}" "$T/err" && grep -q "${S7b:0:7}" "$T/err"'
corre 7 "$S7"; check "el sha auditado sigue siendo válido (CI re-corrido sobre el mismo HEAD)" '[ "$RC" = 0 ]'

echo "3) laterales mientras #7 está en auditoría"
SL=$(rama lateral/b b.txt)
corre 8 "$SL"; check "lateral que toca b.txt (ajeno a #7) → OK" '[ "$RC" = 0 ]'
SA=$(rama lateral/a a.txt)
corre 9 "$SA"; check "lateral que toca a.txt (archivo de #7) → exit 7 (posponer)" '[ "$RC" = 7 ]'
check "el mensaje lista el archivo compartido" 'grep -q "^a.txt$" "$T/err"'
SH=$(rama lateral/handoff docs/collab/HANDOFF.md)
corre 10 "$SH"; check "lateral que modifica HANDOFF.md → exit 5" '[ "$RC" = 5 ]'
SG=$(rama lateral/gates .github/workflows/gates.yml)
corre 11 "$SG"; check "lateral que toca un workflow → exit 8 (gate, riesgo alto)" '[ "$RC" = 8 ]'
SC=$(rama lateral/collab scripts/collab/otro.sh)
corre 12 "$SC"; check "lateral que toca scripts/collab → exit 8" '[ "$RC" = 8 ]'
SM=$(rama lateral/mixto b.txt a.txt)
corre 13 "$SM"; check "lateral mixto (b.txt + a.txt) → exit 7: un archivo compartido alcanza" '[ "$RC" = 7 ]'

echo "4) concurrencia: dos laterales independientes abiertos a la vez, ambos OK; el HANDOFF cambia en main y el chequeo lo sigue"
SL2=$(rama lateral/b2 c.txt)
corre 8 "$SL"; R1=$RC; corre 14 "$SL2"; check "dos laterales sin archivos en común → ambos OK" '[ "$R1" = 0 ] && [ "$RC" = 0 ]'
# el lateral tiene una copia VIEJA del HANDOFF en su rama (no lo modifica); main cambia de PR auditado
S15=$(rama fase/y b.txt); pr_head 15 "$S15"
handoff_main ChatGPT "#15 @ $S15"
corre 8 "$SL"; check "ahora #15 (toca b.txt) está en auditoría: el lateral de b.txt pasa a exit 7 sin cambiar su rama" '[ "$RC" = 7 ]'
corre 9 "$SA"; check "y el lateral de a.txt ya es válido (lee main, no la copia de la rama)" '[ "$RC" = 0 ]'

echo "5) ausencia de merges fuera de orden: el lateral que comparte archivos queda rojo hasta que la fase está en main"
corre 8 "$SL"; check "antes del merge de #15: rojo" '[ "$RC" = 7 ]'
echo "5b) Codex P1: la pelota vuelve a Claude (AUDIT: CAMBIOS) y #15 sigue SIN mergear: R3/R4 siguen activos"
handoff_main Claude "#15 @ $S15"
corre 8 "$SL"; check "pelota en Claude, #15 sin mergear, lateral toca b.txt → exit 7 (antes pasaba: era el bug)" '[ "$RC" = 7 ]'
corre 11 "$SG"; check "pelota en Claude, #15 sin mergear, lateral toca un workflow → exit 8" '[ "$RC" = 8 ]'
corre 9 "$SA"; check "lateral que toca a.txt (ajeno a #15) → OK" '[ "$RC" = 0 ]'
S15b=$(rama fase/y b.txt c.txt); pr_head 15 "$S15b"   # Claude corrige hallazgos: la fase avanza y ahora toca c.txt
corre 15 "$S15b"; check "la fase activa puede avanzar con la pelota en Claude (R2 apagado) → OK" '[ "$RC" = 0 ]'
corre 14 "$SL2"; check "R3 compara contra el HEAD ACTUAL de #15 (refs/pull/15/head), no el sha anotado: c.txt ahora choca → exit 7" '[ "$RC" = 7 ]'
check "el mensaje cita el HEAD actual de la fase" 'grep -q "${S15b:0:7}" "$T/err"'
(cd "$T/semilla" && git checkout -q main && git pull -q origin main && git merge -q --squash "fase/y" >/dev/null && git commit -qm "fase y (#15)" && git push -q origin main)
handoff_main Claude "ninguno"
corre 8 "$SL"; check "después del merge y con 'ninguno': OK (nada activo)" '[ "$RC" = 0 ]'
corre 14 "$SL2"; check "y el de c.txt también: OK" '[ "$RC" = 0 ]'
corre 7 "$S7b"; check "sin fase activa, cualquier rama puede cambiar → OK" '[ "$RC" = 0 ]'
corre 10 "$SH"; check "pero HANDOFF.md en un PR sigue rechazado con cualquier pelota → exit 5" '[ "$RC" = 5 ]'

echo "5c) Codex P2: un rename no esquiva R3/R4"
S20=$(rama fase/z a.txt); pr_head 20 "$S20"
handoff_main ChatGPT "#20 @ $S20"
(cd "$T/semilla" && git checkout -q main && git pull -q origin main && git checkout -q -B lateral/rename main && git mv a.txt renombrado.txt && git commit -qm "rename a→renombrado" && git push -q -f origin lateral/rename)
SR=$(cd "$T/semilla" && git rev-parse HEAD)
corre 21 "$SR"; check "lateral que renombra a.txt (archivo de la fase #20) → exit 7" '[ "$RC" = 7 ]'
check "el mensaje lista el origen del rename (a.txt)" 'grep -q "^a.txt$" "$T/err"'
(cd "$T/semilla" && git checkout -q -B lateral/mueve-workflow main && git mv .github/workflows/gates.yml gates-viejo.yml && git commit -qm "saca el workflow" && git push -q -f origin lateral/mueve-workflow)
SW=$(cd "$T/semilla" && git rev-parse HEAD)
corre 22 "$SW"; check "lateral que mueve un workflow fuera de .github/ → exit 8" '[ "$RC" = 8 ]'

echo "5d) Codex P1: un PR que reescribe paralelo.sh para aprobarse no engaña al chequeo corrido desde main"
(cd "$T/semilla" && git checkout -q -B lateral/sabotaje main && printf '#!/bin/sh\necho "paralelo: OK"\nexit 0\n' > scripts/collab/paralelo.sh && git commit -qam "paralelo.sh siempre OK" && git push -q -f origin lateral/sabotaje)
SS=$(cd "$T/semilla" && git rev-parse HEAD)
corre 23 "$SS"; check "el chequeo (versión de main) rechaza al PR que toca scripts/collab → exit 8" '[ "$RC" = 8 ]'
check "el workflow de CI usa pull_request_target y hace checkout de la BASE, no del PR" 'grep -q "pull_request_target" "$AQUI/../../.github/workflows/paralelo.yml" && grep -q "pull_request.base.sha" "$AQUI/../../.github/workflows/paralelo.yml" && ! grep -q "pull_request.head.ref" "$AQUI/../../.github/workflows/paralelo.yml"'
check "gates.yml ya no ejecuta paralelo.sh desde el checkout del PR" '! grep -E "run:.*paralelo\.sh " "$AQUI/../../.github/workflows/gates.yml" | grep -q .'
echo "5e) Codex ronda 2 P2: rutas con no-ASCII (git las entrecomilla sin -z) no esquivan R3/R4"
(cd "$T/semilla" && git checkout -q -B lateral/enie main && echo x > ".github/workflows/ñ.yml" && git add -A && git commit -qm "workflow ñ" && git push -q -f origin lateral/enie)
SN=$(cd "$T/semilla" && git rev-parse HEAD)
corre 24 "$SN"; check "lateral que agrega .github/workflows/ñ.yml → exit 8" '[ "$RC" = 8 ]'
check "el mensaje muestra la ruta sin comillas" 'grep -q "^.github/workflows/ñ.yml$" "$T/err"'
S25=$(rama fase/enie "carpeta ñ/dato ü.txt"); pr_head 25 "$S25"
handoff_main ChatGPT "#25 @ $S25"
S26=$(rama lateral/enie2 "carpeta ñ/dato ü.txt")
corre 26 "$S26"; check "lateral que toca 'carpeta ñ/dato ü.txt' (archivo de la fase #25) → exit 7" '[ "$RC" = 7 ]'
check "el workflow escucha también 'edited' (retarget de base; Codex ronda 2 P1)" 'grep -qE "types:.*\bedited\b" "$AQUI/../../.github/workflows/paralelo.yml"'
handoff_main Claude "ninguno"

echo "5f) Codex ronda 2 (turno programado): mismos casos con otro armado de ramas"
handoff_main ChatGPT "#7 @ $S7b"
SNQ=$(rama lateral/enie ".github/workflows/ñ.yml")
corre 40 "$SNQ"; check "lateral que agrega .github/workflows/ñ.yml → exit 8" '[ "$RC" = 8 ]'
check "el mensaje muestra la ruta sin comillas" 'grep -qF ".github/workflows/ñ.yml" "$T/err" && ! grep -qF "\".github" "$T/err"'
check "paralelo.yml se dispara también con 'edited' (cambio de base)" 'grep -qE "types:.*\bedited\b" "$AQUI/../../.github/workflows/paralelo.yml"'

echo "5g) Codex rondas 3 y 4 P2: sin refs/pull/N/head el chequeo falla cerrado con CUALQUIER pelota"
S30=$(rama fase/w a.txt); pr_head 30 "$S30"
handoff_main Claude "#30 @ $S30"
git -C "$T/remoto.git" update-ref -d refs/pull/30/head
corre 31 "$SL"; check "pelota en Claude, ref del PR ausente, lateral ajeno → exit 1 (no se aprueba contra el sha viejo)" '[ "$RC" = 1 ]'
check "el mensaje explica que falta refs/pull/30/head" 'grep -q "refs/pull/30/head" "$T/err"'
handoff_main ChatGPT "#30 @ $S30"
corre 31 "$SL"; check "pelota en ChatGPT, ref ausente → también exit 1 (sin respaldo al sha anotado)" '[ "$RC" = 1 ]'
pr_head 30 "$S30"
corre 31 "$SL"; check "con la ref presente: lateral ajeno OK" '[ "$RC" = 0 ]'
corre 9 "$SA"; check "y el que toca a.txt (archivo de #30) → exit 7" '[ "$RC" = 7 ]'
corre 30 "$S30"; check "el propio PR #30 con su HEAD anotado → OK (R2)" '[ "$RC" = 0 ]'
handoff_main Claude "ninguno"

echo "5h) Codex ronda 5 P2: configs de vitest/playwright anidadas también son gates"
S40=$(rama fase/v a.txt); pr_head 40 "$S40"
handoff_main ChatGPT "#40 @ $S40"
SV=$(rama lateral/vitest-anidado packages/foo/vitest.config.ts)
corre 41 "$SV"; check "lateral que toca packages/foo/vitest.config.ts → exit 8" '[ "$RC" = 8 ]'
SP=$(rama lateral/pw-anidado apps/bar/playwright.e2e.config.mjs)
corre 42 "$SP"; check "lateral que toca apps/bar/playwright.e2e.config.mjs → exit 8" '[ "$RC" = 8 ]'
SX=$(rama lateral/no-config packages/foo/vitest-helpers.ts)
corre 43 "$SX"; check "un archivo que solo empieza con 'vitest' pero no es config → OK" '[ "$RC" = 0 ]'
handoff_main Claude "ninguno"

echo "6) base distinta de main (audit/<tema> hacia la rama de la fase): solo la regla del HANDOFF"
handoff_main ChatGPT "#7 @ $S7b"
(cd "$T/semilla" && git checkout -q fase/x && git checkout -q -B audit/x-tema && echo fix >> a.txt && git commit -qam "audit" && git push -q -f origin audit/x-tema)
SAU=$(cd "$T/semilla" && git rev-parse HEAD)
corre 16 "$SAU" fase/x; check "PR del auditor hacia fase/x tocando a.txt → OK" '[ "$RC" = 0 ]'
(cd "$T/semilla" && echo x >> docs/collab/HANDOFF.md && git commit -qam "audit toca handoff" && git push -q -f origin audit/x-tema)
SAU2=$(cd "$T/semilla" && git rev-parse HEAD)
corre 16 "$SAU2" fase/x; check "PR hacia fase/x que toca HANDOFF.md → exit 5" '[ "$RC" = 5 ]'

echo "7) errores de uso y HANDOFF inconsistente"
corre x "$SL"; check "nro de PR inválido → exit 1" '[ "$RC" = 1 ]'
corre 8 deadbeefdeadbeefdeadbeefdeadbeefdeadbeef; check "sha inexistente → exit 1" '[ "$RC" = 1 ]'
(cd "$T/semilla" && git checkout -q main && git pull -q origin main && printf '# HANDOFF\n\n**Pelota en:** ChatGPT — sin línea\n' > docs/collab/HANDOFF.md && git commit -qam "handoff roto" && git push -q origin main)
corre 8 "$SL"; check "pelota en ChatGPT sin 'En auditoría' → exit 1 (no se asume nada)" '[ "$RC" = 1 ]'
check "ningún git push en paralelo.sh (solo lee)" '! grep -E "git push" "$AQUI/paralelo.sh" | grep -v "^\s*#" | grep -q .'

echo; echo "paralelo.test: $ok ok, $fallos fallos"
[ "$fallos" -eq 0 ]
