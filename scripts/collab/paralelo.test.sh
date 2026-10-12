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
# corre paralelo-reevaluar.sh desde el clon "ci" parado en origin/main (como el worktree del
# workflow): el script exige que los scripts en ejecución sean los de main (Codex sobre e511687)
reeval() { (cd "$T/ci" && git fetch -q origin && git checkout -q --detach origin/main && scripts/collab/paralelo-reevaluar.sh "$@"); }
# crea una rama desde main que toca los archivos dados; imprime el sha
rama() { # $1 nombre, resto archivos
  local n=$1; shift
  (cd "$T/semilla" && git checkout -q main && git pull -q origin main && git checkout -q -B "$n" main \
    && for f in "$@"; do mkdir -p "$(dirname "$f")"; echo "$n $RANDOM" >> "$f"; git add "$f"; done \
    && git commit -qm "$n" && git push -q -f origin "$n" && git rev-parse HEAD)
}

git init -q --bare -b main "$T/remoto.git"
git init -q -b main "$T/semilla" && cd "$T/semilla"
mkdir -p docs/collab scripts/collab .github/workflows scripts/ci && cp "$AQUI/paralelo.sh" "$AQUI/paralelo-deps.mjs" "$AQUI/paralelo-reevaluar.sh" "$AQUI/handoff.sh" scripts/collab/
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
SVI=$(rama lateral/vite-anidado packages/foo/vite.config.ts)
corre 44 "$SVI"; check "lateral que toca packages/foo/vite.config.ts (vitest lo lee) → exit 8" '[ "$RC" = 8 ]'
SVM=$(rama lateral/vite-mts apps/bar/vite.config.mts)
corre 47 "$SVM"; check "apps/bar/vite.config.mts → exit 8" '[ "$RC" = 8 ]'
SVW=$(rama lateral/vitest-workspace vitest.workspace.ts)
corre 50 "$SVW"; check "Codex ronda 12: vitest.workspace.ts (Vitest lo lee solo) → exit 8" '[ "$RC" = 8 ]'
SVP=$(rama lateral/vitest-projects packages/foo/vitest.projects.json)
corre 51 "$SVP"; check "packages/foo/vitest.projects.json → exit 8" '[ "$RC" = 8 ]'
check "paralelo.yml corre con la revisión ACTUAL de la base, no con base.sha del evento (re-runs)" 'grep -q "git checkout -q --detach FETCH_HEAD" "$AQUI/../../.github/workflows/paralelo.yml" && grep -q "git checkout -q --detach origin/main" "$AQUI/../../.github/workflows/paralelo.yml"'
SX=$(rama lateral/no-config packages/foo/vitest-helpers.ts)
corre 43 "$SX"; check "un archivo que solo empieza con 'vitest' pero no es config → OK" '[ "$RC" = 0 ]'
handoff_main Claude "ninguno"

echo "5i) AUDIT: CAMBIOS (auditor, sobre 49acd37): auth es riesgo alto (#53, P-03) y R4 tiene que rechazarlo"
S45=$(rama fase/w a.txt); pr_head 45 "$S45"
handoff_main ChatGPT "#45 @ $S45"
SRISK=$(rama lateral/auth packages/platform-auth/src/x.ts)
corre 17 "$SRISK"; check "reproducción del auditor: lateral que toca packages/platform-auth/src/x.ts → exit 8" '[ "$RC" = 8 ]'
check "el mensaje nombra auth como riesgo alto" 'grep -q "auth" "$T/err" && grep -q "packages/platform-auth/src/x.ts" "$T/err"'
SRA=$(rama lateral/auth-routes apps/platform-api/src/auth-routes.ts)
corre 18 "$SRA"; check "lateral que toca apps/platform-api/src/auth-routes.ts → exit 8" '[ "$RC" = 8 ]'
SRN=$(rama lateral/no-auth packages/platform-media/src/x.ts apps/platform-api/src/campaigns.ts)
corre 19 "$SRN"; check "lateral de producto fuera de las familias de riesgo alto (media, campañas) → OK" '[ "$RC" = 0 ]'
# Codex ronda 7: TODAS las familias "alto" de P-03 (BACKLOG), no solo auth
for par in "migr:packages/platform-db/src/migrations/0009_x.sql" "migrator:packages/platform-db/src/migrator.ts" "bootstrap:packages/platform-db/src/bootstrap.sql" \
           "approval:packages/platform-approval/src/x.ts" "approval-routes:apps/platform-api/src/approval-routes.ts" "storage:packages/platform-storage/src/x.ts" \
           "process:packages/platform-media/src/process.ts" "server:apps/platform-api/src/server.ts" "cors:apps/platform-api/src/cors.ts" "actor:apps/platform-api/src/actor.ts" \
           "control:apps/control/src/x.ts"; do
  SF=$(rama "lateral/alto-${par%%:*}" "${par#*:}")
  corre 48 "$SF"; check "familia alto P-03: ${par#*:} → exit 8" '[ "$RC" = 8 ]'
done
# Ronda 9 (autorrevisión de Claude): lo que gates.yml ejecuta o lo que define un gate
for par in "pgup:scripts/dev/pg-up.sh" "accept:scripts/acceptance/cli.mjs" "e2eman:scripts/e2e-platform/manifest.mjs" \
           "bsmoke:packages/platform-db/scripts/bootstrap-smoke.sh" "pkg:package.json" "eslint:.eslintrc.json" "tsbase:tsconfig.base.json" \
           "lock:pnpm-lock.yaml" "wsy:pnpm-workspace.yaml" "npmrc:.npmrc" "envex:.env.example" "compose:docker-compose.yml" "dockerdir:docker/seaweedfs/s3.json"; do
  SF=$(rama "lateral/gate-${par%%:*}" "${par#*:}")
  corre 50 "$SF"; check "script/config de gate: ${par#*:} → exit 8" '[ "$RC" = 8 ]'
done
SPK=$(rama lateral/pkg-paquete packages/platform-media/package.json apps/platform-api/tsconfig.json)
corre 51 "$SPK"; check "package.json/tsconfig de un paquete (producto, no raíz) → OK" '[ "$RC" = 0 ]'
SRM=$(rama lateral/media-ok packages/platform-media/src/validator.ts packages/platform-db/src/fixtures.ts)
corre 49 "$SRM"; check "media (sin process.ts) y platform-db fuera de migraciones → OK" '[ "$RC" = 0 ]'
SRAU=$(rama lateral/authoring packages/show-authoring/src/x.ts)
corre 44 "$SRAU"; check "'show-authoring' no es auth: → OK (sin falsos positivos por prefijo)" '[ "$RC" = 0 ]'
handoff_main Claude "ninguno"

echo "5j) R3b · dependencias del workspace (Codex sobre b4aeebb): no basta con no compartir rutas"
# workspace de prueba: b → a, api → b (api depende de a transitivamente); c independiente
(cd "$T/semilla" && git checkout -q main && git pull -q origin main \
  && printf "packages:\n  - 'apps/*'\n  - 'packages/*'\n" > pnpm-workspace.yaml \
  && mkdir -p packages/a/src packages/b/src packages/c/src apps/api/src \
  && echo '{"name":"@t/a"}' > packages/a/package.json \
  && echo '{"name":"@t/b","dependencies":{"@t/a":"workspace:*"}}' > packages/b/package.json \
  && echo '{"name":"@t/c"}' > packages/c/package.json \
  && echo '{"name":"@t/api","dependencies":{"@t/b":"workspace:*"}}' > apps/api/package.json \
  && for d in packages/a packages/b packages/c apps/api; do echo x > $d/src/i.ts; done \
  && git add -A && git commit -qm "workspace de prueba" && git push -q origin main)
S60=$(rama fase/deps packages/a/src/x.ts); pr_head 60 "$S60"
handoff_main ChatGPT "#60 @ $S60"
SD1=$(rama lateral/dep-api apps/api/src/y.ts)
corre 61 "$SD1"; check "fase toca @t/a; lateral en apps/api (api→b→a, ninguna ruta en común) → exit 7" '[ "$RC" = 7 ]'
check "el mensaje explica la dependencia" 'grep -q "@t/api (apps/api) ~ @t/a (packages/a): el lateral depende" "$T/err"'
SD2=$(rama lateral/dep-c packages/c/src/z.ts)
corre 62 "$SD2"; check "lateral en @t/c (independiente) → OK" '[ "$RC" = 0 ]'
SD3=$(rama lateral/dep-mismo packages/a/src/otro.ts)
corre 63 "$SD3"; check "lateral en otro archivo del mismo paquete @t/a → exit 7" '[ "$RC" = 7 ] && grep -q "mismo paquete" "$T/err"'
SD4=$(cd "$T/semilla" && git checkout -q main && git checkout -q -B lateral/dep-nueva main \
  && echo '{"name":"@t/c","dependencies":{"@t/a":"workspace:*"}}' > packages/c/package.json && echo y >> packages/c/src/i.ts \
  && git commit -qam "c pasa a depender de a" && git push -q -f origin lateral/dep-nueva && git rev-parse HEAD)
corre 64 "$SD4"; check "lateral que AGREGA una dependencia hacia @t/a (grafo del lateral) → exit 7" '[ "$RC" = 7 ]'
S65=$(rama fase/deps-api apps/api/src/z.ts); pr_head 65 "$S65"
handoff_main ChatGPT "#65 @ $S65"
SD5=$(rama lateral/dep-a packages/a/src/w.ts)
corre 66 "$SD5"; check "fase en apps/api; lateral en @t/a (la fase depende del lateral) → exit 7" '[ "$RC" = 7 ] && grep -q "la fase depende" "$T/err"'
corre 62 "$SD2"; check "y el lateral de @t/c sigue OK" '[ "$RC" = 0 ]'
# auditor (AUDIT: CAMBIOS sobre 0f73e0c, P2): la fase toca @t/a; el lateral renombra @t/b → @t/bb
# y le QUITA la dependencia a @t/a. La arista histórica b→a de main tiene que seguir conectada
# a packages/b, aunque en el lateral esa carpeta se llame distinto.
handoff_main ChatGPT "#60 @ $S60"
SD6=$(cd "$T/semilla" && git checkout -q main && git pull -q origin main && git checkout -q -B lateral/dep-rename main \
  && echo '{"name":"@t/bb"}' > packages/b/package.json && echo r >> packages/b/src/i.ts \
  && git commit -qam "b pasa a llamarse bb y deja de depender de a" && git push -q -f origin lateral/dep-rename && git rev-parse HEAD)
corre 67 "$SD6"; check "lateral que renombra @t/b→@t/bb y quita b→a mientras la fase toca @t/a → exit 7 (alias por revisión)" '[ "$RC" = 7 ]'
check "el mensaje muestra los dos nombres de la carpeta y la arista histórica" 'grep -q "@t/b|@t/bb (packages/b)" "$T/err" && grep -q "@t/b → @t/a" "$T/err"'
# Codex ronda 13 P2: workspace bajo ruta no-ASCII (git lo entrecomilla sin -z)
(cd "$T/semilla" && git checkout -q main && git pull -q origin main && mkdir -p "packages/ñ/src" \
  && echo '{"name":"@t/enie","dependencies":{"@t/a":"workspace:*"}}' > "packages/ñ/package.json" && echo x > "packages/ñ/src/i.ts" \
  && git add -A && git commit -qm "workspace ñ" && git push -q origin main)
SD7=$(rama lateral/dep-enie "packages/ñ/src/y.ts")
corre 68 "$SD7"; check "lateral en packages/ñ (depende de @t/a, que toca la fase) → exit 7 (ls-tree -z)" '[ "$RC" = 7 ] && grep -q "@t/enie" "$T/err"'
handoff_main Claude "ninguno"

echo "5k) auditor (AUDIT: CAMBIOS sobre 0f73e0c, P1): la fase avanza S1→S2 y el lateral verde deja de serlo (re-evaluación)"
S70=$(rama fase/toctou a.txt); pr_head 70 "$S70"
handoff_main ChatGPT "#70 @ $S70"
SL70=$(rama lateral/toctou b.txt)
corre 71 "$SL70"; check "lateral que toca b.txt contra la fase S1 (solo a.txt) → OK" '[ "$RC" = 0 ]'
# la fase avanza a S2 y ahora también toca b.txt; el lateral NO cambió (sin push → sin evento propio)
S70b=$(cd "$T/semilla" && git checkout -q fase/toctou && echo s2 >> b.txt && git commit -qam "fase S2 toca b.txt" && git push -q -f origin fase/toctou && git rev-parse HEAD)
pr_head 70 "$S70b"
cat > "$T/listar.sh" <<LISTAR
#!/usr/bin/env bash
echo "71 $SL70"
echo "70 $S70b"
LISTAR
cat > "$T/publicar.sh" <<'PUBLICAR'
#!/usr/bin/env bash
printf '%s %s %s | %s\n' "$1" "${2:0:7}" "$3" "$4" >> "$PUBLICADO"
PUBLICAR
chmod +x "$T/listar.sh" "$T/publicar.sh"
: > "$T/publicado"
set +e; PARALELO_LISTAR="$T/listar.sh" PARALELO_PUBLICAR="$T/publicar.sh" PUBLICADO="$T/publicado" reeval "fase a S2" >"$T/out" 2>"$T/err"; RC=$?; set -e
check "re-evaluación corre sobre todos los PR abiertos → exit 0" '[ "$RC" = 0 ]'
check "el lateral de b.txt pasa a failure (exit 7) sin haber cambiado" 'grep -q "^71 ${SL70:0:7} failure | paralelo: RECHAZADO exit 7" "$T/publicado"'
check "la fase misma, con la pelota en ChatGPT y HEAD ≠ anotado, queda failure (exit 6)" 'grep -q "^70 ${S70b:0:7} failure | paralelo: RECHAZADO exit 6" "$T/publicado"'
corre 71 "$SL70"; check "y el chequeo directo del lateral coincide (exit 7)" '[ "$RC" = 7 ]'
# el HANDOFF cambia (fase mergeada → ninguno): la re-evaluación por push a main vuelve a aprobar
handoff_main Claude "ninguno"
: > "$T/publicado"
PARALELO_LISTAR="$T/listar.sh" PARALELO_PUBLICAR="$T/publicar.sh" PUBLICADO="$T/publicado" reeval "handoff" >/dev/null 2>&1
check "tras el cambio de HANDOFF, ambos PR vuelven a success" '[ "$(grep -c " success | " "$T/publicado")" = 2 ]'
# sin poder listar → exit 1 y nada publicado (no se inventa un veredicto)
: > "$T/publicado"
set +e; PARALELO_LISTAR=/bin/false PARALELO_PUBLICAR="$T/publicar.sh" PUBLICADO="$T/publicado" reeval >/dev/null 2>"$T/err"; RC=$?; set -e
check "si no se pueden listar los PR → exit 1 y ningún check publicado" '[ "$RC" = 1 ] && [ ! -s "$T/publicado" ]'
# Codex ronda 13 P2: si main avanza mientras se evalúa, NO se publica (la corrida nueva decide)
handoff_main ChatGPT "#70 @ $S70b"
cat > "$T/listar-mueve-main.sh" <<LISTAR
#!/usr/bin/env bash
# lista los PR y, de paso, mueve main (simula un push concurrente de HANDOFF)
echo "71 $SL70"
(cd "$T/semilla" && git checkout -q -f main && git pull -q origin main && echo tick >> docs/collab/HISTORIAL.md && git add -A && git commit -qm "historial" && git push -q origin main) >/dev/null 2>&1
exit 0
LISTAR
chmod +x "$T/listar-mueve-main.sh"
: > "$T/publicado"
set +e; PARALELO_LISTAR="$T/listar-mueve-main.sh" PARALELO_PUBLICAR="$T/publicar.sh" PUBLICADO="$T/publicado" reeval "carrera" >/dev/null 2>"$T/err"; RC=$?; set -e
check "main avanza durante la re-evaluación → exit 1, solo 'pendiente' publicado (ningún veredicto) y el motivo lo dice" '[ "$RC" = 1 ] && ! grep -qE " (success|failure) \| " "$T/publicado" && grep -q " pendiente | " "$T/publicado" && grep -q "avanzó" "$T/err"'
check "paralelo.yml publica el veredicto del PR como check sobre HEAD_SHA por API y usa un solo carril serial" 'grep -q "head_sha=\"\$HEAD_SHA\"" "$AQUI/../../.github/workflows/paralelo.yml" && grep -qE "^  group: paralelo$" "$AQUI/../../.github/workflows/paralelo.yml" && grep -q "cancel-in-progress: false" "$AQUI/../../.github/workflows/paralelo.yml"'
# auditor (AUDIT: CAMBIOS sobre 7700da3, P1): un evento con base ≠ main también desplaza al run
# pendiente; por eso la re-evaluación corre en TODO evento y con los scripts de main.
check "paralelo.yml re-evalúa en TODO evento pull_request_target, sin condición por rama base, con un worktree de origin/main" '! grep -qE "if: github.event.pull_request.base.ref == .main." "$AQUI/../../.github/workflows/paralelo.yml" && grep -q "git worktree add -q --detach \"\$RUNNER_TEMP/main\" origin/main" "$AQUI/../../.github/workflows/paralelo.yml"'
# Codex sobre 7700da3, P1: la fase avanza entre la evaluación y la publicación → no se publica
handoff_main ChatGPT "#70 @ $S70b"
cat > "$T/listar-mueve-fase.sh" <<LISTAR
#!/usr/bin/env bash
echo "71 $SL70"
(cd "$T/semilla" && git checkout -q -f fase/toctou && echo s3 >> c3.txt && git add -A && git commit -qm "fase S3" && git push -q -f origin fase/toctou && git push -q origin "fase/toctou:refs/pull/70/head") >/dev/null 2>&1
exit 0
LISTAR
chmod +x "$T/listar-mueve-fase.sh"
: > "$T/publicado"
set +e; PARALELO_LISTAR="$T/listar-mueve-fase.sh" PARALELO_PUBLICAR="$T/publicar.sh" PUBLICADO="$T/publicado" reeval "carrera fase" >/dev/null 2>"$T/err"; RC=$?; set -e
check "la fase activa avanza durante la re-evaluación → exit 1, solo 'pendiente' publicado (ningún veredicto) y el motivo lo dice" '[ "$RC" = 1 ] && ! grep -qE " (success|failure) \| " "$T/publicado" && grep -q " pendiente | " "$T/publicado" && grep -q "fase activa #70 avanzó" "$T/err"'
(cd "$T/semilla" && git checkout -q -f main)
# Codex sobre baec6ab, P1: main avanza DURANTE el bucle de publicación → lo publicado se invalida (failure CADUCADO)
: > "$T/publicado"
cat > "$T/publicar-mueve-main.sh" <<'PUBLICAR'
#!/usr/bin/env bash
printf '%s %s %s | %s\n' "$1" "${2:0:7}" "$3" "$4" >> "$PUBLICADO"
# mueve main en la PRIMERA publicación FINAL (los "pendiente" van antes de evaluar)
if [ "$3" != pendiente ] && [ ! -e "$PUBLICADO.movido" ]; then
  touch "$PUBLICADO.movido"
  (cd "$SEMILLA" && git checkout -q -f main && git pull -q origin main && echo tock >> docs/collab/HISTORIAL.md && git add -A && git commit -qm "historial 2" && git push -q origin main) >/dev/null 2>&1
fi
exit 0
PUBLICAR
chmod +x "$T/publicar-mueve-main.sh"; rm -f "$T/publicado.movido"
set +e; PARALELO_LISTAR="$T/listar.sh" PARALELO_PUBLICAR="$T/publicar-mueve-main.sh" PUBLICADO="$T/publicado" SEMILLA="$T/semilla" reeval "carrera en publicación" >/dev/null 2>"$T/err"; RC=$?; set -e
check "main avanza durante la publicación → exit 1 y todos los HEAD reciben failure CADUCADO después de lo publicado" '[ "$RC" = 1 ] && [ "$(grep -c " failure | paralelo: CADUCADO" "$T/publicado")" = 2 ] && grep -q "durante la publicación" "$T/err"'
# Codex sobre 4d6746b, P1: si la publicación final de un lateral falla, su success viejo no puede
# sobrevivir: antes se publica "pendiente" sobre cada HEAD y la final se reintenta.
check "todos los 'pendiente' se publican ANTES de cualquier veredicto final (el pendiente de #70 precede a la final de #71)" 'P70=$(grep -n "^70 .* pendiente |" "$T/publicado" | head -1 | cut -d: -f1); F71=$(grep -n "^71 ${SL70:0:7} failure |" "$T/publicado" | head -1 | cut -d: -f1); [ -n "$P70" ] && [ -n "$F71" ] && [ "$P70" -lt "$F71" ]'
check "cada HEAD recibe 'pendiente' ANTES de su veredicto final (ambos en orden)" 'P71=$(grep -n "^71 ${SL70:0:7} pendiente |" "$T/publicado" | head -1 | cut -d: -f1); F71=$(grep -n "^71 ${SL70:0:7} failure |" "$T/publicado" | head -1 | cut -d: -f1); [ -n "$P71" ] && [ -n "$F71" ] && [ "$P71" -lt "$F71" ]'
cat > "$T/publicar-falla-final.sh" <<'PUBLICAR'
#!/usr/bin/env bash
printf '%s %s %s | %s\n' "$1" "${2:0:7}" "$3" "$4" >> "$PUBLICADO"
# la publicación FINAL de #71 falla siempre (API caída); las demás y los "pendiente" andan
[ "$1" = 71 ] && [ "$3" != pendiente ] && exit 1
exit 0
PUBLICAR
chmod +x "$T/publicar-falla-final.sh"
: > "$T/publicado"
set +e; PARALELO_LISTAR="$T/listar.sh" PARALELO_PUBLICAR="$T/publicar-falla-final.sh" PUBLICADO="$T/publicado" PARALELO_ESPERA=0 reeval "api caída" >/dev/null 2>"$T/err"; RC=$?; set -e
check "falla la publicación final de un lateral → exit 1, se reintentó 3 veces, queda 'pendiente' (sin success nuevo) y se avisa" '[ "$RC" = 1 ] && [ "$(grep -c "^71 ${SL70:0:7} failure |" "$T/publicado")" = 3 ] && grep -q "^71 ${SL70:0:7} pendiente |" "$T/publicado" && ! grep -q "^71 .* success |" "$T/publicado" && grep -q "queda pendiente" "$T/err"'
check "y el otro PR sí recibió su veredicto final" 'grep -qE "^70 ${S70b:0:7} (success|failure) \| paralelo: (OK|RECHAZADO)" "$T/publicado"'
# Codex sobre e511687, P1: los scripts en ejecución tienen que SER la revisión de main que se
# compara. Si el checkout quedó atrás (main avanzó entre el worktree y el fetch), no se evalúa.
(cd "$T/semilla" && git checkout -q -f main && git pull -q origin main && echo tack >> docs/collab/HISTORIAL.md && git add -A && git commit -qm "historial 3" && git push -q origin main) >/dev/null 2>&1
: > "$T/publicado"
set +e; (cd "$T/ci" && git checkout -q --detach HEAD~0 && PARALELO_LISTAR="$T/listar.sh" PARALELO_PUBLICAR="$T/publicar.sh" PUBLICADO="$T/publicado" scripts/collab/paralelo-reevaluar.sh "checkout viejo" >/dev/null 2>"$T/err"); RC=$?; set -e
check "checkout de main viejo (main ya avanzó) → exit 1, nada publicado y el motivo nombra la deriva" '[ "$RC" = 1 ] && [ ! -s "$T/publicado" ] && grep -q "scripts en ejecución" "$T/err"'
check "y parado en origin/main actual vuelve a evaluar" 'PARALELO_LISTAR="$T/listar.sh" PARALELO_PUBLICAR="$T/publicar.sh" PUBLICADO="$T/publicado" reeval "al día" >/dev/null 2>&1 && [ -s "$T/publicado" ]'
check "paralelo.yml re-evalúa ANTES de publicar el veredicto del HEAD y lo condiciona a RC2 (sin success si la re-evaluación no completó)" 'W="$AQUI/../../.github/workflows/paralelo.yml"; LR=$(grep -n "name: Re-evaluar todos los PR abiertos hacia main (cualquier evento" "$W" | cut -d: -f1); LP=$(grep -n "name: Publicar el veredicto como check sobre el HEAD del PR" "$W" | cut -d: -f1); [ -n "$LR" ] && [ -n "$LP" ] && [ "$LR" -lt "$LP" ] && grep -q "RC2=\${PIPESTATUS\[0\]}" "$W" && grep -q "SIN VEREDICTO" "$W" && grep -q "exit \"\$RC2\"" "$W" && grep -q "\"\$BASE_JOB\" != \"\$BASE_AHORA\"" "$W" && grep -q "no se pisa" "$W" && grep -q "\"\$BASE_PUB\" != \"\$BASE_JOB\"" "$W" && grep -q "BASE_MOVIDA=1" "$W" && ! grep -B1 "scripts/collab/paralelo-reevaluar.sh \"evento en" "$W" | grep -q "else" && grep -q "status=in_progress" "$W" && grep -q "pulls/\$PR\"" "$W" && grep -q "\"\$HEAD_NOW\" != \"\$HEAD_SHA\"" "$W" && grep -q "\"\$BASE_NOW\" != \"\$BASE_REF\"" "$W" && grep -q "\"\$DESPUES\" != \"\$BASE_REF \$HEAD_SHA\"" "$W" && grep -q "\"\$BASE_FIN\" != \"\$BASE_JOB\"" "$W" && [ "$(grep -c "WF_SHA: \${{ github.workflow_sha }}" "$W")" = 2 ] && grep -q "RC_TIT" "$W"'
check "paralelo.yml re-evalúa TODOS los PR en cada evento hacia main (no solo cuando el PR es la fase: GitHub descarta runs pendientes)" '! grep -q "FASE=\$(git show origin/main" "$AQUI/../../.github/workflows/paralelo.yml" && grep -q "name: Re-evaluar todos los PR abiertos hacia main" "$AQUI/../../.github/workflows/paralelo.yml"'
check "paralelo.yml re-evalúa en push a main y cuando el PR evaluado es la fase activa" 'grep -q "^  push:" "$AQUI/../../.github/workflows/paralelo.yml" && grep -q "paralelo-reevaluar.sh" "$AQUI/../../.github/workflows/paralelo.yml" && grep -qE "checks: write" "$AQUI/../../.github/workflows/paralelo.yml" && ! grep -qE "contents: write|pull-requests: write" "$AQUI/../../.github/workflows/paralelo.yml"'
check "ningún git push en paralelo-reevaluar.sh (solo lee y publica checks)" '! grep -E "git push" "$AQUI/paralelo-reevaluar.sh" | grep -v "^\s*#" | grep -q .'

echo "5l) Codex sobre fe2f6c3 P2: ejecutables de gates dentro de paquetes y el bloque scripts de su package.json"
handoff_main Claude "ninguno"
(cd "$T/semilla" && git checkout -q main && git pull -q origin main && mkdir -p apps/api/scripts packages/c/scripts \
  && echo 'export {}' > apps/api/scripts/docs-contract.ts && echo 'true' > packages/c/scripts/make-fixtures.sh \
  && printf '{"name":"@t/c","scripts":{"typecheck":"tsc --noEmit"}}\n' > packages/c/package.json \
  && git add -A && git commit -qm "scripts de paquetes" && git push -q origin main)
S80=$(rama fase/otra a.txt); pr_head 80 "$S80"
handoff_main ChatGPT "#80 @ $S80"
SG1=$(rama lateral/docs-contract apps/api/scripts/docs-contract.ts)
corre 81 "$SG1"; check "lateral que toca apps/api/scripts/docs-contract.ts (lo ejecuta pnpm docs:contract) → exit 8" '[ "$RC" = 8 ]'
SG2=$(rama lateral/fixtures packages/c/scripts/make-fixtures.sh)
corre 82 "$SG2"; check "lateral que toca packages/c/scripts/make-fixtures.sh → exit 8" '[ "$RC" = 8 ]'
SG3=$(cd "$T/semilla" && git checkout -q main && git pull -q origin main && git checkout -q -B lateral/pkg-scripts main \
  && printf '{"name":"@t/c","scripts":{"typecheck":"true"}}\n' > packages/c/package.json && git commit -qam "typecheck a true" && git push -q -f origin lateral/pkg-scripts && git rev-parse HEAD)
corre 83 "$SG3"; check "lateral que cambia el bloque scripts de packages/c/package.json (typecheck→true) → exit 8 y lo nombra" '[ "$RC" = 8 ] && grep -q "packages/c/package.json (bloque scripts)" "$T/err"'
SG4=$(cd "$T/semilla" && git checkout -q -B lateral/pkg-deps main \
  && printf '{"name":"@t/c","scripts":{"typecheck":"tsc --noEmit"},"dependencies":{"left-pad":"1.0.0"}}\n' > packages/c/package.json && git commit -qam "agrega dep externa" && git push -q -f origin lateral/pkg-deps && git rev-parse HEAD)
corre 84 "$SG4"; check "lateral que solo agrega una dependencia externa en packages/c/package.json (mismo bloque scripts) → OK" '[ "$RC" = 0 ]'
SG5=$(cd "$T/semilla" && git checkout -q -B lateral/pkg-nuevo main && mkdir -p packages/nuevo \
  && printf '{"name":"@t/nuevo","scripts":{"test":"true"}}\n' > packages/nuevo/package.json && git add -A && git commit -qm "paquete nuevo" && git push -q -f origin lateral/pkg-nuevo && git rev-parse HEAD)
corre 85 "$SG5"; check "lateral que agrega un package.json nuevo con scripts → exit 8 (aparece en pnpm -r)" '[ "$RC" = 8 ]'
# Codex sobre 3108da9, P2: las raíces del workspace salen de pnpm-workspace.yaml (edge/*), no de una lista fija
(cd "$T/semilla" && git checkout -q -f main && git pull -q origin main && printf "packages:\n  - 'apps/*'\n  - 'packages/*'\n  - 'edge/*'\n" > pnpm-workspace.yaml && git commit -qam "workspace con edge/*" && git push -q origin main)
SG6=$(cd "$T/semilla" && git checkout -q -B lateral/edge-pkg main && mkdir -p edge/trust-edge \
  && printf '{"name":"@t/edge","scripts":{"typecheck":"true"}}\n' > edge/trust-edge/package.json && git add -A && git commit -qm "paquete edge" && git push -q -f origin lateral/edge-pkg && git rev-parse HEAD)
corre 86 "$SG6"; check "lateral que agrega edge/trust-edge/package.json con scripts (raíz edge/* del workspace) → exit 8" '[ "$RC" = 8 ] && grep -q "edge/trust-edge/package.json (bloque scripts)" "$T/err"'
SG7=$(cd "$T/semilla" && git checkout -q -B lateral/edge-script main && mkdir -p edge/trust-edge/scripts && echo x > edge/trust-edge/scripts/deploy.sh && git add -A && git commit -qm "script edge" && git push -q -f origin lateral/edge-script && git rev-parse HEAD)
corre 87 "$SG7"; check "lateral que toca edge/trust-edge/scripts/deploy.sh → exit 8" '[ "$RC" = 8 ]'
SG8=$(cd "$T/semilla" && git checkout -q -B lateral/otra-raiz main && mkdir -p tools/x && printf '{"name":"@t/x","scripts":{"test":"true"}}\n' > tools/x/package.json && git add -A && git commit -qm "fuera del workspace" && git push -q -f origin lateral/otra-raiz && git rev-parse HEAD)
corre 88 "$SG8"; check "package.json fuera de las raíces del workspace (tools/x) no entra en pnpm -r → OK" '[ "$RC" = 0 ]'
# Codex sobre 2093df6, P2: las pruebas E2E que gates.yml ejecuta directamente son gate (M2C congelado)
SG9=$(rama lateral/e2e-m2c e2e/experience.spec.ts)
corre 89 "$SG9"; check "lateral que toca e2e/experience.spec.ts (gate M2C) → exit 8" '[ "$RC" = 8 ]'
SG10=$(rama lateral/e2e-plat e2e-platform/login.spec.ts)
corre 90 "$SG10"; check "lateral que toca e2e-platform/login.spec.ts → exit 8" '[ "$RC" = 8 ]'
SG11=$(rama lateral/e2e-nombre packages/x/src/e2e-helper.ts)
corre 91 "$SG11"; check "un archivo que solo contiene 'e2e' en el nombre, fuera de e2e/ → OK" '[ "$RC" = 0 ]'
(cd "$T/semilla" && git checkout -q -f main)

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
