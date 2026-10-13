#!/usr/bin/env bash
# P-04 · Prueba de scripts/ci: run.sh (anotación con entorno + cola, log sanitizado en
# test-results/ci/, marca para el paso final), entorno.sh, sanitizar.sh y politica-fallas.sh,
# más chequeos estáticos de gates.yml (todo job anota entorno al fallar y sube test-results/).
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/../.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
ok=0; fallos=0
check() { if eval "$2"; then echo "  ✓ $1"; ok=$((ok+1)); else echo "  ✗ $1"; fallos=$((fallos+1)); fi; }
export RUNNER_TEMP=$T/runner P04_LOGS=$T/logs; mkdir -p "$RUNNER_TEMP"
unset GITHUB_RUN_ID GITHUB_RUN_ATTEMPT GITHUB_JOB ImageOS ImageVersion P04_HEAD_SHA

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

echo "2. sanitizar.sh"
S=$(printf '%s\n' 'Authorization: Bearer abc.def' 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123' 'export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG"' 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE' 'Set-Cookie: __Host-trust_session=s3cr3t; Path=/' 'cookie=__Host-trust_session=abc; otra=1' 'DB=postgres://user:pw@host:5433/db' 'token: expirado' '{"password": "hunter2", "apiKey":"k1"}' 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c fin' '-----BEGIN RSA PRIVATE KEY-----' 'MIIEowIBAAKCAQEA' '-----END RSA PRIVATE KEY-----' 'github_pat_11AAAAAAA0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' 'Tests  3 passed, timeout: 30000, TIMEOUT en builder.spec.ts:14' 'expect(received).toBe(expected) // Object.is equality' | "$AQUI/sanitizar.sh")
check "2.1 cabecera Authorization / Set-Cookie / Cookie oculta" 'printf "%s" "$S" | grep -q "^Authorization: \[oculto\]$" && printf "%s" "$S" | grep -q "^Set-Cookie: \[oculto\]$" && printf "%s" "$S" | grep -q "^cookie=\[oculto\]$"'
check "2.2 variables *_TOKEN / *_SECRET_* / password / apiKey ocultas (shell, export y JSON)" 'printf "%s" "$S" | grep -q "^GITHUB_TOKEN=\[oculto\]$" && printf "%s" "$S" | grep -q "^export AWS_SECRET_ACCESS_KEY=\"\[oculto\]\"$" && printf "%s" "$S" | grep -q "{\"password\": \"\[oculto\]\", \"apiKey\":\"\[oculto\]\"}"'
check "2.3 tokens de GitHub, AWS y JWT ocultos" '! printf "%s" "$S" | grep -q "ghp_\|AKIAIOSFODNN7EXAMPLE\|eyJhbGci\|github_pat_11"'
check "2.4 credenciales en URL ocultas, host visible" 'printf "%s" "$S" | grep -q "^DB=postgres://\[oculto\]@host:5433/db$"'
check "2.5 clave privada reemplazada entera" 'printf "%s" "$S" | grep -q "^\[clave privada oculta\]$" && ! printf "%s" "$S" | grep -q "MIIEow\|PRIVATE KEY"'
check "2.6 líneas de tests, timeouts y aserciones quedan legibles" 'printf "%s" "$S" | grep -q "^Tests  3 passed, timeout: 30000, TIMEOUT en builder.spec.ts:14$" && printf "%s" "$S" | grep -q "^expect(received).toBe(expected) // Object.is equality$"'
check "2.7 'token: expirado' se tapa (prefiere ocultar de más)" 'printf "%s" "$S" | grep -q "^token: \[oculto\]$"'
check "2.8 sin secretos no cambia nada" '[ "$(printf "a=1\nhola mundo\nkey=valor\nMIIEow\n" | "$AQUI/sanitizar.sh")" = "$(printf "a=1\nhola mundo\nkey=valor\nMIIEow\n")" ]'

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
check "3.11 comando inexistente: rojo con exit ≠ 0 y anotación" 'O=$("$AQUI/run.sh" "nada" /no/existe 2>&1); [ $? != 0 ] && printf "%s" "$O" | grep -q "^::error title=nada falló (exit 127)::entorno:"'

echo "4. politica-fallas.sh"
R=$T/repo; mkdir -p "$R/scripts/ci" "$R/.github/workflows" "$R/e2e" "$R/e2e-platform" "$R/packages/x/src"
cp "$RAIZ"/playwright*.config.ts "$R/"; cp "$RAIZ/.github/workflows/gates.yml" "$R/.github/workflows/"; cp "$AQUI/politica-fallas.sh" "$R/scripts/ci/"
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
check "4.10 test.skip( en e2e/ (gate directo) → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "skip en E2E de gate — e2e/a.spec.ts"'
echo "test.fixme('x', async () => {});" > "$R/e2e-platform/b.spec.ts"; rm "$R/e2e/a.spec.ts"
check "4.11 test.fixme( en e2e-platform/ → rojo" 'O=$(PF check); [ $? = 1 ] && printf "%s" "$O" | grep -q "e2e-platform/b.spec.ts"'
rm "$R/e2e-platform/b.spec.ts"
check "4.12 limpio otra vez → OK" 'PF check | grep -q "^politica-fallas: OK"'
check "4.13 el repo real cumple la política (retries 0, foto al día, sin .only)" 'bash "$AQUI/politica-fallas.sh" check | grep -q "^politica-fallas: OK"'

echo "5. gates.yml (estático)"
G=$RAIZ/.github/workflows/gates.yml
JOBS=$(sed -nE '/^jobs:/,$ s/^  ([a-z0-9-]+):$/\1/p' "$G")
bloque() { awk -v j="$1" '/^  [a-z0-9-]+:$/{en=($0=="  "j":")} en' "$G"; }
check "5.1 siete jobs" '[ "$(printf "%s\n" $JOBS | wc -l)" = 7 ]'
for j in $JOBS; do
  B=$(bloque "$j")
  check "5.2 $j: paso 'Entorno (falla fuera de un gate)' con if: failure() y la marca p04-anotado" 'printf "%s" "$B" | grep -A2 "name: Entorno (falla fuera de un gate)" | grep -q "if: failure()" && printf "%s" "$B" | grep -q "p04-anotado.*entorno.sh --error \"$j: falló fuera de un gate"'
  check "5.3 $j: upload-artifact if: failure() con test-results/ y retención" 'printf "%s" "$B" | grep -B1 -A6 "uses: actions/upload-artifact@v4" | grep -q "if: failure()" && printf "%s" "$B" | grep -A8 "if: failure()" | grep -qE "^\s+(- )?(path: test-results/|test-results/ci/)$" && printf "%s" "$B" | grep -q "retention-days:"'
  check "5.4 $j: al menos un gate pasa por scripts/ci/run.sh" 'printf "%s" "$B" | grep -q "scripts/ci/run.sh "'
done
check "5.5 P04_HEAD_SHA en el env del workflow (HEAD auditado, no el merge sintético)" 'grep -q "^  P04_HEAD_SHA: \${{ github.event.pull_request.head.sha || github.sha }}$" "$G"'
check "5.6 gates.yml no usa secrets.* (los artifacts no pueden contener secretos reales)" '! grep -q "secrets\." "$G"'
check "5.7 verify-build corre run.test.sh y politica-fallas.sh check" 'grep -q "scripts/ci/run.sh ci-test bash scripts/ci/run.test.sh" "$G" && grep -q "scripts/ci/run.sh politica-fallas scripts/ci/politica-fallas.sh check" "$G"'
check "5.8 e2e-m2c publica el entorno antes del gate (entorno.sh)" 'bloque e2e-m2c | grep -q "run: scripts/ci/entorno.sh$"'
check "5.9 retries: 0 en los dos playwright configs (acceptación P-04)" '[ "$(grep -h "retries:" "$RAIZ"/playwright.config.ts "$RAIZ"/playwright.platform.config.ts | grep -vc "retries: 0")" = 0 ] && [ "$(grep -hc "retries:" "$RAIZ"/playwright.config.ts "$RAIZ"/playwright.platform.config.ts | paste -sd+ | bc)" = 2 ]'

echo
echo "run.test: $ok OK, $fallos fallos"
[ "$fallos" = 0 ]
