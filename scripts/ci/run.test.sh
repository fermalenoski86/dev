#!/usr/bin/env bash
# P-04 · Prueba de scripts/ci: run.sh (anotación con entorno + cola, log sanitizado en
# test-results/ci/, marca para el paso final, corte por plazo), plazo.sh, entorno.sh, sanitizar.sh y politica-fallas.sh,
# más chequeos estáticos de gates.yml (todo job anota entorno al fallar y sube test-results/).
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/../.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
ok=0; fallos=0
check() { if eval "$2"; then echo "  ✓ $1"; ok=$((ok+1)); else echo "  ✗ $1"; fallos=$((fallos+1)); fi; }
export RUNNER_TEMP=$T/runner P04_LOGS=$T/logs; mkdir -p "$RUNNER_TEMP"
unset GITHUB_RUN_ID GITHUB_RUN_ATTEMPT GITHUB_JOB GITHUB_ENV ImageOS ImageVersion P04_HEAD_SHA P04_PLAZO_FIN P04_MARGEN

echo "1. entorno.sh"
L=$("$AQUI/entorno.sh"); RC=$?
check "1.1 exit 0 y una sola línea" '[ "$RC" = 0 ] && [ "$(printf "%s\n" "$L" | wc -l)" = 1 ]'
check "1.2 lleva sha, head, ImageOS/ImageVersion, node, pnpm, chrome, ffmpeg, postgres, nproc, loadavg" \
  'for k in sha head run job ImageOS ImageVersion node pnpm chrome ffmpeg postgres nproc loadavg; do printf "%s" "$L" | grep -q " \?$k=" || exit 1; done'
check "1.3 sha = git rev-parse HEAD" 'printf "%s" "$L" | grep -q "sha=$(git -C "$RAIZ" rev-parse HEAD) "'
check "1.4 head toma P04_HEAD_SHA (HEAD auditado en pull_request)" 'P04_HEAD_SHA=abc123 "$AQUI/entorno.sh" | grep -q " head=abc123 "'
check "1.5 ImageOS/ImageVersion/run/job del runner" 'ImageOS=ubuntu24 ImageVersion=20261001.1 GITHUB_RUN_ID=7 GITHUB_RUN_ATTEMPT=2 GITHUB_JOB=media "$AQUI/entorno.sh" | grep -q "run=7/2 job=media ImageOS=ubuntu24 ImageVersion=20261001.1 "'
mkdir -p "$T/bin"; for b in bash sed head tail tr cut nproc git ls dirname; do ln -s "$(command -v $b)" "$T/bin/$b"; done
check "1.6 herramienta ausente → n/d, sin fallar" 'O=$(PATH=$T/bin "$AQUI/entorno.sh"); [ $? = 0 ] && printf "%s" "$O" | grep -q "node=n/d pnpm=n/d chrome=n/d ffmpeg=n/d"'
check "1.7 --notice publica ::notice con título" '"$AQUI/entorno.sh" --notice "media: entorno" | grep -q "^::notice title=media: entorno::sha="'
check "1.8 --error publica ::error (falla fuera de un gate) y exit 0" 'O=$("$AQUI/entorno.sh" --error "x: falló fuera de un gate"); [ $? = 0 ] && printf "%s" "$O" | grep -q "^::error title=x: falló fuera de un gate::sha="'
check "1.9 --error deja \$P04_LOGS/entorno.txt (artifact aunque ningún gate haya corrido)" 'rm -rf "$P04_LOGS"; "$AQUI/entorno.sh" --error "media: falló fuera de un gate" >/dev/null && head -1 "$P04_LOGS/entorno.txt" | grep -q "^media: falló fuera de un gate$" && sed -n 2p "$P04_LOGS/entorno.txt" | grep -q "^sha=.* loadavg="'
mkdir -p "$T/chrome"; printf '#!/bin/bash\necho "Google Chrome 154.0.1.2 "\n' > "$T/chrome/google-chrome"; chmod +x "$T/chrome/google-chrome"
check "1.10 versión de Chrome sin espacio final (la línea no queda con doble espacio)" 'PATH=$T/chrome:$PATH "$AQUI/entorno.sh" | grep -q " chrome=154.0.1.2 ffmpeg="'

echo "2. sanitizar.sh"
S=$(printf '%s\n' 'Authorization: Bearer abc.def' 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123' 'export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG"' 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE' 'Set-Cookie: __Host-trust_session=s3cr3t; Path=/' 'cookie=__Host-trust_session=abc; otra=1' 'DB=postgres://user:pw@host:5433/db' 'token: expirado' '{"password": "hunter2", "apiKey":"k1"}' 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c fin' '-----BEGIN RSA PRIVATE KEY-----' 'MIIEowIBAAKCAQEA' '-----END RSA PRIVATE KEY-----' 'github_pat_11AAAAAAA0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' 'Tests  3 passed, timeout: 30000, TIMEOUT en builder.spec.ts:14' 'expect(received).toBe(expected) // Object.is equality' | "$AQUI/sanitizar.sh")
check "2.1 cabecera Authorization / Set-Cookie / Cookie oculta" 'printf "%s" "$S" | grep -q "^Authorization: \[oculto\]$" && printf "%s" "$S" | grep -q "^Set-Cookie: \[oculto\]$" && printf "%s" "$S" | grep -q "^cookie=\[oculto\]$"'
check "2.2 variables *_TOKEN / *_SECRET_* / password / apiKey ocultas (shell, export y JSON)" 'printf "%s" "$S" | grep -q "^GITHUB_TOKEN=\[oculto\]$" && printf "%s" "$S" | grep -q "^export AWS_SECRET_ACCESS_KEY=\"\[oculto\]\"$" && printf "%s" "$S" | grep -q "{\"password\": \"\[oculto\]\", \"apiKey\":\"\[oculto\]\"}"'
check "2.3 tokens de GitHub, AWS y JWT ocultos" '! printf "%s" "$S" | grep -q "ghp_\|AKIAIOSFODNN7EXAMPLE\|eyJhbGci\|github_pat_11"'
check "2.4 credenciales en URL ocultas, host visible" 'printf "%s" "$S" | grep -q "^DB=postgres://\[oculto\]@host:5433/db$"'
check "2.5 clave privada reemplazada entera" 'printf "%s" "$S" | grep -q "^\[clave privada oculta\]$" && ! printf "%s" "$S" | grep -q "MIIEow\|PRIVATE KEY"'
check "2.6 líneas de tests, timeouts y aserciones quedan legibles" 'printf "%s" "$S" | grep -q "^Tests  3 passed, timeout: 30000, TIMEOUT en builder.spec.ts:14$" && printf "%s" "$S" | grep -q "^expect(received).toBe(expected) // Object.is equality$"'
check "2.7 'token: expirado' se tapa (prefiere ocultar de más)" 'printf "%s" "$S" | grep -q "^token: \[oculto\]$"'
Q=$(printf '%s\n' 'PASSWORD="correct horse battery staple" fin' '{"password":"abc,def","x":1}' "pw_token='a b;c' ok" 'API_KEY="sin cierre y más' "secret='sin cierre" | "$AQUI/sanitizar.sh")
check "2.9 valores entre comillas con espacios, comas o ; se tapan enteros (también sin cierre)" 'printf "%s" "$Q" | grep -q "^PASSWORD=\"\[oculto\]\" fin$" && printf "%s" "$Q" | grep -q "^{\"password\":\"\[oculto\]\",\"x\":1}$" && printf "%s" "$Q" | grep -q "^pw_token=.\[oculto\]. ok$" && ! printf "%s" "$Q" | grep -q "horse\|battery\|def\|b;c\|cierre"'
check "2.8 sin secretos no cambia nada" '[ "$(printf "a=1\nhola mundo\nclave=valor\nMIIEow\n" | "$AQUI/sanitizar.sh")" = "$(printf "a=1\nhola mundo\nclave=valor\nMIIEow\n")" ]'
K=$(printf '%s\n' 'ENCRYPTION_KEY="abc def"' 'SIGNING_KEY=supersecretvalue' 'SSH_KEY=AAAAB3Nza' 'key=valor' | "$AQUI/sanitizar.sh")
check "2.10 cualquier nombre con key (ENCRYPTION_KEY, SIGNING_KEY, SSH_KEY, key) se tapa" 'printf "%s" "$K" | grep -q "^ENCRYPTION_KEY=\"\[oculto\]\"$" && printf "%s" "$K" | grep -q "^SIGNING_KEY=\[oculto\]$" && printf "%s" "$K" | grep -q "^SSH_KEY=\[oculto\]$" && printf "%s" "$K" | grep -q "^key=\[oculto\]$" && ! printf "%s" "$K" | grep -q "abc\|supersecret\|AAAAB3\|valor"'

E=$(printf '%s\n' '{"password":"abc\\\"DEF-SECRET","x":1}' "{'secret':'abc\\'DEF-SECRET','x':1}" '{\"password\":\"DEF-SECRET\",\"x\":1}' 'password=abc\"DEF-SECRET' 'token="abc\\\\" x=1' 'API_KEY="abc\"DEF-SECRET sin cierre' 'password="abc\' | "$AQUI/sanitizar.sh")
check "2.11 comillas escapadas (dobles y simples) no cortan el valor: nada de DEF-SECRET (AUDIT #75)" '! printf "%s" "$E" | grep -q "DEF-SECRET\|abc" && printf "%s\n" "$E" | sed -n 1p | grep -qx "{\"password\":\"\[oculto\]\",\"x\":1}" && printf "%s\n" "$E" | sed -n 2p | grep -qx "{.secret.:.\[oculto\].,.x.:1}" && printf "%s\n" "$E" | sed -n 5p | grep -qx "token=\"\[oculto\]\" x=1"'

echo "3. run.sh"
O=$("$AQUI/run.sh" "verde" bash -c 'echo "Tests  3 passed"; echo "Authorization: Bearer xyz"; exit 0'); RC=$?
check "3.1 verde: exit 0, ::notice con entorno y resumen, sin ::error" '[ "$RC" = 0 ] && printf "%s" "$O" | grep -q "^::notice title=verde (exit 0)::entorno: sha=.*%0ATests  3 passed$" && ! printf "%s" "$O" | grep -q "^::error"'
check "3.2 verde: no deja la marca p04-anotado" '[ ! -e "$RUNNER_TEMP/p04-anotado" ]'
check "3.3 log sanitizado en \$P04_LOGS/<título>.log con la línea de entorno" '[ -s "$P04_LOGS/verde.log" ] && head -1 "$P04_LOGS/verde.log" | grep -q "^entorno: sha=" && grep -q "^Authorization: \[oculto\]$" "$P04_LOGS/verde.log" && ! grep -q xyz "$P04_LOGS/verde.log"'
check "3.4 la salida cruda sigue yendo al log del job (tee)" 'printf "%s" "$O" | grep -q "^Tests  3 passed$"'
O=$("$AQUI/run.sh" "e2e-m2c/x y" bash -c 'echo "1 failed"; echo "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123"; echo "100% roto"; echo "   "; echo "última línea"; exit 3'); RC=$?
check "3.5 rojo: propaga el exit (3) y publica ::error con título 'falló (exit 3)'" '[ "$RC" = 3 ] && printf "%s" "$O" | grep -q "^::error title=e2e-m2c/x y falló (exit 3)::"'
check "3.6 rojo: la anotación empieza con entorno y termina con la cola (sin líneas vacías)" 'printf "%s" "$O" | grep "^::error" | grep -q "::entorno: sha=.* loadavg=[0-9. ]*%0A1 failed%0AGITHUB_TOKEN=\[oculto\]%0A100%25 roto%0Aúltima línea$"'
check "3.7 rojo: secreto oculto en anotación y log; % codificado" '! printf "%s" "$O" | grep "^::" | grep -q ghp_ && ! grep -q ghp_ "$P04_LOGS/e2e-m2c_x_y.log"'
check "3.8 rojo: deja la marca p04-anotado (el paso final no duplica el entorno)" '[ -e "$RUNNER_TEMP/p04-anotado" ]'
check "3.9 rojo: el título se convierte en nombre de archivo seguro" '[ -s "$P04_LOGS/e2e-m2c_x_y.log" ]'
O=$("$AQUI/run.sh" "largo" bash -c 'for i in $(seq 1 80); do echo "línea $i"; done; exit 1' 2>&1)
check "3.10 rojo: cola = últimas 60 líneas" 'printf "%s" "$O" | grep "^::error" | grep -q "%0Alínea 21%0A" && ! printf "%s" "$O" | grep "^::error" | grep -q "%0Alínea 20%0A"'
O=$("$AQUI/run.sh" "inyecta" bash -c 'echo "::error::PASSWORD=hunter2"; echo "::stop-commands::adivino"; exit 1' 2>&1)
check "3.12 comandos de workflow frenados alrededor de la salida cruda (token aleatorio) y solo nuestras anotaciones después" 'T1=$(printf "%s\n" "$O" | sed -n "1s/^::stop-commands::\(p04-[0-9a-f]\{32\}\)$/\1/p"); [ -n "$T1" ] && N=$(printf "%s\n" "$O" | grep -nx "::$T1::" | cut -d: -f1) && [ "$N" = 4 ] && printf "%s\n" "$O" | sed -n 2p | grep -qx "::error::PASSWORD=hunter2" && printf "%s\n" "$O" | sed -n "5,\$p" | grep "^::error title=inyecta" | grep -q "PASSWORD=\[oculto\]" && ! printf "%s\n" "$O" | sed -n "5,\$p" | grep -q hunter2'
O2=$("$AQUI/run.sh" "otro" true 2>&1)
check "3.13 el token del freno cambia en cada corrida" '[ "$(printf "%s\n" "$O" | head -1)" != "$(printf "%s\n" "$O2" | head -1)" ]'
check "3.11 comando inexistente: rojo con exit ≠ 0 y anotación" 'O=$("$AQUI/run.sh" "nada" /no/existe 2>&1); [ $? != 0 ] && printf "%s" "$O" | grep -q "^::error title=nada falló (exit 127)::entorno:"'

cat > "$T/lento.sh" <<'LENTO'
echo '{"password":"abc\\\"DEF-SECRET"}'
sleep 300 &
for i in $(seq 1 100); do echo "línea $i"; sleep 0.05; done
sleep 300
LENTO
rm -f "$RUNNER_TEMP/p04-anotado"; INI=$(date +%s)
O=$(P04_PLAZO_FIN=$(( $(date +%s) + 3 )) "$AQUI/run.sh" "lento" bash "$T/lento.sh" 2>&1); RC=$?; DUR=$(( $(date +%s) - INI ))
check "3.14 plazo: el gate se corta al plazo (exit 124, < 20 s, hijos incluidos) y no espera al timeout del job" '[ "$RC" = 124 ] && [ "$DUR" -lt 20 ] && ! ps -eo args | grep -q "^sleep 300$"'
check "3.15 plazo: ::error con entorno, cola sanitizada y motivo; marca p04-anotado" 'printf "%s" "$O" | grep "^::error title=lento falló (exit 124%2C plazo del job)::entorno: sha=" | grep -q "%0Alínea [0-9]*%0Arun.sh: TIMEOUT — el gate superó el plazo del job" && ! printf "%s" "$O" | grep "^::error" | grep -q DEF-SECRET && [ -e "$RUNNER_TEMP/p04-anotado" ]'
check "3.16 plazo: log sanitizado completo en \$P04_LOGS (artifact) con la cola y el motivo" 'head -1 "$P04_LOGS/lento.log" | grep -q "^entorno: sha=" && grep -q "^línea 1$" "$P04_LOGS/lento.log" && tail -1 "$P04_LOGS/lento.log" | grep -q "^run.sh: TIMEOUT" && ! grep -q DEF-SECRET "$P04_LOGS/lento.log"'
check "3.17 plazo vencido antes de empezar: no corre el comando, exit 124 y anotación" 'O=$(P04_PLAZO_FIN=$(( $(date +%s) - 1 )) "$AQUI/run.sh" "tarde" touch "$T/no-debe" 2>&1); [ $? = 124 ] && [ ! -e "$T/no-debe" ] && printf "%s" "$O" | grep "^::error title=tarde falló (exit 124%2C plazo del job)" | grep -q "agotó su plazo"'
check "3.18 con plazo amplio el gate verde no cambia (exit 0, sin marca de plazo)" 'rm -f "$RUNNER_TEMP/p04-anotado"; O=$(P04_PLAZO_FIN=$(( $(date +%s) + 600 )) "$AQUI/run.sh" "rapido" echo "Tests  1 passed" 2>&1); [ $? = 0 ] && ! printf "%s" "$O" | grep -q "^::error\|TIMEOUT" && [ ! -e "$RUNNER_TEMP/p04-anotado" ]'
check "3.19 plazo.sh: timeout-minutes del job − 180 s en GITHUB_ENV" 'GE=$T/genv; : > "$GE"; A=$(date +%s); GITHUB_JOB=media GITHUB_ENV=$GE "$AQUI/plazo.sh" >/dev/null && F=$(sed -n "s/^P04_PLAZO_FIN=//p" "$GE") && M=$(sed -nE "/^  media:$/,/timeout-minutes/s/.*timeout-minutes: ([0-9]+).*/\1/p" "$RAIZ/.github/workflows/gates.yml") && D=$(( F - A - M * 60 + 180 )) && [ "$D" -ge 0 ] && [ "$D" -le 2 ]'
printf 'jobs:\n  corto:\n    timeout-minutes: 3\n' > "$T/wf.yml"
check "3.20 plazo.sh: margen = un cuarto del timeout si es menor que 180 s; job sin timeout → error" 'GE=$T/genv; : > "$GE"; A=$(date +%s); P04_WORKFLOW=$T/wf.yml GITHUB_JOB=corto GITHUB_ENV=$GE "$AQUI/plazo.sh" >/dev/null && F=$(sed -n "s/^P04_PLAZO_FIN=//p" "$GE") && D=$(( F - A - 135 )) && [ "$D" -ge 0 ] && [ "$D" -le 2 ] && ! P04_WORKFLOW=$T/wf.yml GITHUB_JOB=otro GITHUB_ENV=$GE "$AQUI/plazo.sh" >/dev/null'
check "3.21 SIGKILL externo con plazo de sobra (OOM): exit 137, rotulado SIGKILL, no TIMEOUT (Codex #75)" 'rm -f "$RUNNER_TEMP/p04-anotado"; O=$(P04_PLAZO_FIN=$(( $(date +%s) + 600 )) "$AQUI/run.sh" "oom" bash -c "echo línea; kill -9 \$\$" 2>&1); [ $? = 137 ] && printf "%s" "$O" | grep -q "^::error title=oom falló (exit 137%2C SIGKILL)::" && ! printf "%s" "$O" | grep -q "TIMEOUT\|%2C plazo del job" && tail -1 "$P04_LOGS/oom.log" | grep -q "^run.sh: SIGKILL"'
check "3.22 exit 124 propio del comando con plazo de sobra: no se rotula plazo (Codex #75)" 'O=$(P04_PLAZO_FIN=$(( $(date +%s) + 600 )) "$AQUI/run.sh" "propio" bash -c "exit 124" 2>&1); [ $? = 124 ] && printf "%s" "$O" | grep -q "^::error title=propio falló (exit 124)::" && ! printf "%s" "$O" | grep -q "TIMEOUT"'

echo "4. politica-fallas.sh"
R=$T/repo; mkdir -p "$R/scripts/ci" "$R/.github/workflows" "$R/e2e" "$R/e2e-platform" "$R/packages/x/src"
cp "$RAIZ"/playwright*.config.ts "$R/"; cp -r "$RAIZ/e2e" "$RAIZ/e2e-platform" "$R/"; cp "$RAIZ/.github/workflows/gates.yml" "$R/.github/workflows/"; cp "$AQUI/politica-fallas.sh" "$R/scripts/ci/"
echo "it.skip('requiere MinIO: NO ejecutado en este entorno', () => {});" > "$R/packages/x/src/a.test.ts"
PF() { P04_RAIZ=$R bash "$R/scripts/ci/politica-fallas.sh" "$@"; }
check "4.1 sin foto → rojo" '! PF check 2>&1 | grep -q "OK" && ! PF check >/dev/null 2>&1'
PF generar > /dev/null
check "4.2 foto generada = la del repo (umbrales.txt al día)" 'diff -q "$R/scripts/ci/umbrales.txt" "$RAIZ/scripts/ci/umbrales.txt" >/dev/null'
check "4.3 con foto y configs intactas → OK (it.skip con motivo en unit test se permite)" 'PF check | grep -q "^politica-fallas: OK"'
sed -i 's/retries: 0,/retries: 1,/' "$R/playwright.config.ts"
check "4.4 retries: 1 → rojo, nombra archivo y regla" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "playwright.config.ts:.*retries tiene que ser 0"'
sed -i 's/retries: 1,/retries: 0,/' "$R/playwright.config.ts"
sed -i 's/timeout: 30_000,/timeout: 60_000,/' "$R/playwright.config.ts"
check "4.5 timeout subido sin regenerar la foto → rojo con diff y aviso de decisión" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "^+playwright.config.ts timeout: 60_000" && printf "%s" "$O" | grep -q "exige decisión y auditoría"'
sed -i 's/timeout: 60_000,/timeout: 10_000,/' "$R/playwright.config.ts"
check "4.6 timeout bajado también es un cambio de foto → rojo" '! PF check >/dev/null 2>&1'
sed -i 's/timeout-minutes: 25/timeout-minutes: 25 /' "$R/.github/workflows/gates.yml"
check "4.6b espacios/orden no cambian la foto; una línea nueva arriba tampoco" 'sed -i "1i # comentario nuevo" "$R/.github/workflows/gates.yml"; sed -i "s/timeout: 10_000,/timeout: 30_000,/" "$R/playwright.config.ts"; PF check | grep -q "^politica-fallas: OK"'
sed -i 's/timeout: 10_000,/timeout: 30_000,/' "$R/playwright.config.ts"
sed -i '0,/timeout-minutes: 25/s//timeout-minutes: 45/' "$R/.github/workflows/gates.yml"
check "4.7 timeout-minutes de gates.yml subido → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "^+.github/workflows/gates.yml verify-build: timeout-minutes: 45"'
PF generar > /dev/null
check "4.8 regenerar la foto en el mismo PR → OK (queda a la vista del auditor)" 'PF check | grep -q "^politica-fallas: OK" && grep -q "timeout-minutes: 45" "$R/scripts/ci/umbrales.txt"'
echo "test.only('x', async () => {});" > "$R/e2e/a.spec.ts"
check "4.9 .only( en un spec → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "\.only — e2e/a.spec.ts"'
echo "test.skip('x', async () => {});" > "$R/e2e/a.spec.ts"
check "4.10 test.skip( en e2e/ (gate directo) → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "skip/fixme/slow/fail en E2E de gate — e2e/a.spec.ts"'
echo "test.fixme('x', async () => {});" > "$R/e2e-platform/b.spec.ts"; rm "$R/e2e/a.spec.ts"
check "4.11 test.fixme( en e2e-platform/ → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "e2e-platform/b.spec.ts"'
rm "$R/e2e-platform/b.spec.ts"
check "4.12 limpio otra vez → OK" 'PF check | grep -q "^politica-fallas: OK"'
sed -i '0,/setTimeout(120_000)/s//setTimeout(240_000)/' "$R/e2e/experience.spec.ts"
check "4.14 timeout por test (test.setTimeout) subido en un spec → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "^+e2e/experience.spec.ts .setTimeout(240_000) ×1"'
sed -i 's/setTimeout(240_000)/setTimeout(120_000)/' "$R/e2e/experience.spec.ts"; sed -i '0,/timeout: 40_000/s//timeout: 90_000/' "$R/e2e/experience.spec.ts"
check "4.15 timeout de aserción ({ timeout: N }) subido en un spec → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "^+e2e/experience.spec.ts timeout: 90_000 ×1"'
sed -i 's/timeout: 90_000/timeout: 40_000/' "$R/e2e/experience.spec.ts"
mkdir -p "$R/scripts/collab"; echo "test.only('x', () => {});" > "$R/scripts/collab/a.test.ts"
check "4.16 .only( en un test de scripts/ (lo corre vitest) → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "\.only — scripts/collab/a.test.ts"'
rm "$R/scripts/collab/a.test.ts"
check "4.17 limpio otra vez → OK" 'PF check | grep -q "^politica-fallas: OK"'
echo "test.describe.configure({ retries: 2 });" > "$R/e2e/c.spec.ts"
check "4.18 retries por suite (describe.configure) en una E2E de gate → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "retries — e2e/c.spec.ts:1:"'
echo "test.describe.configure({ retries: 0, mode: 'serial' });" > "$R/e2e/c.spec.ts"
check "4.19 retries: 0 por suite se permite" 'PF check | grep -q "^politica-fallas: OK"'
rm "$R/e2e/c.spec.ts"; sed -i 's#playwright test -c playwright.config.ts#playwright test --retries=2 -c playwright.config.ts#' "$R/.github/workflows/gates.yml"
check "4.20 --retries=2 en el workflow → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "retries — .github/workflows/gates.yml:"'
sed -i 's#--retries=2 ##' "$R/.github/workflows/gates.yml"
check "4.21 limpio otra vez → OK" 'PF check | grep -q "^politica-fallas: OK"'
for v in "0 || 2" "0 ? 0 : 2" "0+2"; do echo "test.describe.configure({ retries: $v });" > "$R/e2e/c.spec.ts"; check "4.21b retries: $v (prefijo 0, evalúa ≠ 0) por suite → rojo (Codex #75)" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "retries — e2e/c.spec.ts:1:"'; done; rm "$R/e2e/c.spec.ts"
sed -i 's/retries: 0,/retries: 0 || 2,/' "$R/playwright.config.ts"; check "4.21c retries: 0 || 2 en la config raíz → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "playwright.config.ts:.*retries tiene que ser 0"'; sed -i 's/retries: 0 || 2,/retries: 0,/' "$R/playwright.config.ts"
sed -i 's#playwright test -c playwright.config.ts#playwright test --retries=0$((2)) -c playwright.config.ts#' "$R/.github/workflows/gates.yml"; check "4.21d --retries=0<expresión> en el workflow → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "retries — .github/workflows/gates.yml:"'; sed -i 's#--retries=0$((2)) ##' "$R/.github/workflows/gates.yml"
for c in "testInfo.skip();" "test.info().skip(true, 'x');" "test.slow();" "testInfo.slow();" "test.fail();" "test.describe.skip('x', () => {});"; do printf "test('x', async ({}, testInfo) => { %s });\n" "$c" > "$R/e2e/d.spec.ts"; check "4.21e $c en una E2E de gate → rojo (Codex #75)" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "skip/fixme/slow/fail en E2E de gate — e2e/d.spec.ts"'; done; rm "$R/e2e/d.spec.ts"
check "4.21f limpio otra vez → OK" 'PF check | grep -q "^politica-fallas: OK"'
sed -i '0,/{ timeout: 40_000 }/s//{ timeout: 40_000 * 10 }/' "$R/e2e/experience.spec.ts"
check "4.22 timeout como expresión ({ timeout: 40_000 * 10 }) → rojo aunque la foto no cambie (AUDIT #75)" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "timeout no literal — e2e/experience.spec.ts:" && ! printf "%s" "$O" | grep -q "^[+-]e2e"'
cp "$RAIZ/e2e/experience.spec.ts" "$R/e2e/"; sed -i '0,/setTimeout(120_000)/s//setTimeout(120 * 1000)/' "$R/e2e/experience.spec.ts"
check "4.23 test.setTimeout(expresión) → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "timeout no literal — e2e/experience.spec.ts:.*setTimeout(120 \* 1000)"'
cp "$RAIZ/e2e/experience.spec.ts" "$R/e2e/"; sed -i 's/^  timeout: 30_000,/  timeout:\n    90_000,/' "$R/playwright.config.ts"
check "4.24 valor en la línea siguiente (config) → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "timeout no literal — playwright.config.ts:"'
cp "$RAIZ/playwright.config.ts" "$R/"; echo "const T = 99_000; test.use({ actionTimeout: T });" > "$R/e2e-platform/d.spec.ts"
check "4.25 actionTimeout con constante en una E2E → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "timeout no literal — e2e-platform/d.spec.ts:"'
rm "$R/e2e-platform/d.spec.ts"; sed -i 's/^  timeout: 30_000,/  timeout: 30_000,\n  use: { actionTimeout: 99_000 },/' "$R/playwright.config.ts"
check "4.26 actionTimeout literal nuevo en una config → cambia la foto → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "^+playwright.config.ts actionTimeout: 99_000"'
cp "$RAIZ/playwright.config.ts" "$R/"
check "4.27 limpio otra vez → OK" 'PF check | grep -q "^politica-fallas: OK"'
# AUDIT #75 sobre cb6901f: `.only (` con espacio y retries por ocurrencia; Codex: `timeout :`
cp "$RAIZ/e2e/experience.spec.ts" "$R/e2e/"; sed -i "0,/test.describe(/s//test.describe.only (/" "$R/e2e/experience.spec.ts"
check "4.28 test.describe.only ( con espacio → rojo (AUDIT #75)" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "\.only — e2e/experience.spec.ts"'
cp "$RAIZ/e2e/experience.spec.ts" "$R/e2e/"
for c in "test.only ('x', async () => {});" "test[\"only\"]('x', async () => {});" "test. only('x', async () => {});" "test.only
  ('x', async () => {});"; do printf "%s\n" "$c" > "$R/e2e/a.spec.ts"; check "4.28b $(printf %s "$c" | head -1) → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "\.only — e2e/a.spec.ts"'; done
for c in "test.skip ('x', async () => {});" "testInfo[\"fixme\"]();" "test.slow ();"; do printf "%s\n" "$c" > "$R/e2e/a.spec.ts"; check "4.28c $c → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "skip/fixme/slow/fail en E2E de gate — e2e/a.spec.ts"'; done; rm "$R/e2e/a.spec.ts"
printf "test('x', async () => { const solo = { only: 1 }; expect(solo.only).toBe(1); });\n" > "$R/e2e/a.spec.ts"
check "4.28d \`.only\` como propiedad (sin llamada) no es foco → OK" 'PF check | grep -q "^politica-fallas: OK"'; rm "$R/e2e/a.spec.ts"
sed -i "s/--reporter=line/--reporter=line --retries=0 --retries=2/" "$R/.github/workflows/gates.yml"
check "4.29 --retries=0 --retries=2 en la misma línea → rojo (AUDIT #75)" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "retries — .github/workflows/gates.yml:"'
sed -i "s/ --retries=0 --retries=2//" "$R/.github/workflows/gates.yml"
for c in "test.describe.configure({ retries: 0, mode: 'serial' }); test.describe.configure({ retries: 2 });" "test.describe.configure({ \"retries\": 2 });" "test.describe.configure({ retries : 2 });"; do printf "%s\n" "$c" > "$R/e2e/c.spec.ts"; check "4.29b $c → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "retries — e2e/c.spec.ts:1:"'; done; rm "$R/e2e/c.spec.ts"
sed -i "s/^  retries: 0,/  retries: 0, use: { trace: 'off' }, retries: 2,/" "$R/playwright.config.ts"
check "4.29c retries 0 y 2 en la misma línea de la config raíz → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "retries — playwright.config.ts:"'
cp "$RAIZ/playwright.config.ts" "$R/"
sed -i '0,/{ timeout: 40_000 }/s//{ timeout : 999_999 }/' "$R/e2e/experience.spec.ts"
check "4.30 { timeout : 999_999 } (espacio antes de :) en una E2E → cambia la foto → rojo (Codex #75)" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "^+e2e/experience.spec.ts timeout: 999_999 ×1"'
cp "$RAIZ/e2e/experience.spec.ts" "$R/e2e/"; sed -i 's/^  timeout: 30_000,/  timeout : 999_999,/' "$R/playwright.config.ts"
check "4.30b timeout : N en la config raíz → cambia la foto → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "^+playwright.config.ts timeout: 999_999"'
cp "$RAIZ/playwright.config.ts" "$R/"; sed -i 's/^  timeout: 30_000,/  timeout : 30_000,/' "$R/playwright.config.ts"
check "4.30c timeout : N con el mismo valor → foto igual → OK" 'PF check | grep -q "^politica-fallas: OK"'
cp "$RAIZ/playwright.config.ts" "$R/"
check "4.31 limpio otra vez → OK" 'PF check | grep -q "^politica-fallas: OK"'
# Codex #75 sobre 886d2e4: modificadores partidos en varias líneas (análisis por archivo entero)
for c in 'test[
"only"
]("x", async () => {});' 'test.
only("x", async () => {});' "test.only.each([1])('x %s', async () => {});" 'test[`only`]("x", async () => {});'; do printf "%s\n" "$c" > "$R/e2e/a.spec.ts"; check "4.32 $(printf %s "$c" | tr '\n' ' ') → rojo (Codex #75)" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "\.only — e2e/a.spec.ts:1:"'; done
for c in 'test[
"skip"
]("x", async () => {});' "test.
fixme('x', async () => {});" 'testInfo[
  "slow"
]();'; do printf "x;\n%s\n" "$c" > "$R/e2e/a.spec.ts"; check "4.32b $(printf %s "$c" | tr '\n' ' ') → rojo con la línea donde empieza" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "skip/fixme/slow/fail en E2E de gate — e2e/a.spec.ts:2:"'; done
printf "const solo = { only: 1, fail: 2 };\nexpect(solo.only + solo\n.fail).toBe(3);\n" > "$R/e2e/a.spec.ts"
check "4.32c propiedades sueltas partidas en líneas (sin llamada) → OK" 'PF check | grep -q "^politica-fallas: OK"'; rm "$R/e2e/a.spec.ts"
check "4.13 el repo real cumple la política (retries 0, foto al día, sin .only)" 'bash "$AQUI/politica-fallas.sh" check | grep -q "^politica-fallas: OK"'

echo "5. gates.yml (estático)"
G=$RAIZ/.github/workflows/gates.yml
JOBS=$(sed -nE '/^jobs:/,$ s/^  ([a-z0-9-]+):$/\1/p' "$G")
bloque() { awk -v j="$1" '/^  [a-z0-9-]+:$/{en=($0=="  "j":")} en' "$G"; }
check "5.1 siete jobs" '[ "$(printf "%s\n" $JOBS | wc -l)" = 7 ]'
for j in $JOBS; do
  B=$(bloque "$j")
  check "5.2 $j: paso 'Entorno (falla fuera de un gate)' con if: failure() || cancelled() (timeout) y la marca p04-anotado" 'printf "%s" "$B" | grep -A2 "name: Entorno (falla fuera de un gate)" | grep -q "if: failure() || cancelled()$" && printf "%s" "$B" | grep -q "p04-anotado.*entorno.sh --error \"$j: falló fuera de un gate"'
  check "5.3 $j: upload-artifact if: failure() || cancelled() con test-results/ y retención" 'printf "%s" "$B" | grep -B1 -A6 "uses: actions/upload-artifact@v4" | grep -q "if: failure() || cancelled()$" && printf "%s" "$B" | grep -A8 "if: failure() || cancelled()" | grep -qE "^\s+(- )?(path: test-results/|test-results/ci/)$" && printf "%s" "$B" | grep -q "retention-days:"'
  check "5.11 $j: primer paso después del checkout = plazo.sh (AUDIT #75)" 'printf "%s" "$B" | grep -A4 "uses: actions/checkout@v4" | grep -m1 "run:" | grep -q "run: scripts/ci/plazo.sh$"'
  check "5.4 $j: al menos un gate pasa por scripts/ci/run.sh" 'printf "%s" "$B" | grep -q "scripts/ci/run.sh "'
done
check "5.5 P04_HEAD_SHA en el env del workflow (HEAD auditado, no el merge sintético)" 'grep -q "^  P04_HEAD_SHA: \${{ github.event.pull_request.head.sha || github.sha }}$" "$G"'
check "5.6 gates.yml no usa secrets.* (los artifacts no pueden contener secretos reales)" '! grep -q "secrets\." "$G"'
check "5.7 verify-build corre run.test.sh y politica-fallas.sh check" 'grep -q "scripts/ci/run.sh ci-test bash scripts/ci/run.test.sh" "$G" && grep -q "scripts/ci/run.sh politica-fallas scripts/ci/politica-fallas.sh check" "$G"'
check "5.8 e2e-m2c publica el entorno antes del gate (entorno.sh)" 'bloque e2e-m2c | grep -q "run: scripts/ci/entorno.sh$"'
check "5.10 e2e-platform sube test-results/ entero (incluye e2e-platform-results.json)" 'bloque e2e-platform | grep -A6 "name: trazas de fallos" | grep -qE "^\s+path: test-results/$"'
check "5.9 retries: 0 en los dos playwright configs (acceptación P-04)" '[ "$(grep -h "retries:" "$RAIZ"/playwright.config.ts "$RAIZ"/playwright.platform.config.ts | grep -vc "retries: 0")" = 0 ] && [ "$(grep -hc "retries:" "$RAIZ"/playwright.config.ts "$RAIZ"/playwright.platform.config.ts | paste -sd+ | bc)" = 2 ]'

echo
echo "run.test: $ok OK, $fallos fallos"
[ "$fallos" = 0 ]
