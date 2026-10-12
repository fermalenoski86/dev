#!/usr/bin/env bash
# P-01 · Prueba del script con dos escritores sobre un remoto bare local.
# Criterio (ChatGPT, #53): el segundo escritor falla, el remoto queda intacto,
# y solo tras releer puede continuar. Nunca se reescribe historia.
set -euo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
# aislar de la config global del entorno (proxy, push negotiation, etc.)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=t@t
ok=0; fallos=0
check() { if eval "$2"; then echo "  ✓ $1"; ok=$((ok+1)); else echo "  ✗ $1"; fallos=$((fallos+1)); fi; }
SHA40=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
# P-05: con la pelota en ChatGPT el HANDOFF tiene que decir qué PR está en auditoría
handoff_valido() { printf '# HANDOFF\n\n**Pelota en:** %s — %s\n' "$1" "$2"; [ "$1" = ChatGPT ] && printf '**En auditoría:** #1 @ %s\n' "$SHA40"; true; }

# remoto bare + estado inicial
git init -q --bare -b main "$T/remoto.git"
git init -q -b main "$T/semilla" && cd "$T/semilla"
mkdir -p docs/collab scripts/collab && cp "$AQUI/handoff.sh" scripts/collab/
handoff_valido Claude "inicio" > docs/collab/HANDOFF.md; echo "# HISTORIAL" > docs/collab/HISTORIAL.md; echo "# D" > docs/collab/DECISIONES.md
git add -A && git commit -qm init && git remote add origin "$T/remoto.git" && git push -q origin main
# dos clones = dos agentes
git clone -q "$T/remoto.git" "$T/A"; git clone -q "$T/remoto.git" "$T/B"
H=scripts/collab/handoff.sh

echo "1) ambos leen el mismo SHA"
SA=$(cd "$T/A" && $H leer | sed -n 's/^HANDOFF_BASE_SHA=//p'); SB=$(cd "$T/B" && $H leer | sed -n 's/^HANDOFF_BASE_SHA=//p')
check "misma base" '[ "$SA" = "$SB" ]'

echo "2) A escribe primero: fast-forward OK"
handoff_valido ChatGPT "A entregó" > "$T/nuevoA.md"
check "A escribe" '(cd "$T/A" && HANDOFF_BASE_SHA=$SA $H escribir "$T/nuevoA.md" "A: pelota a ChatGPT" --historial "- A escribió" >/dev/null)'
REM1=$(git -C "$T/remoto.git" rev-parse main)
check "remoto avanzó" '[ "$REM1" != "$SA" ]'
check "historial recibió la línea" 'git -C "$T/remoto.git" show main:docs/collab/HISTORIAL.md | grep -q "A escribió"'

echo "3) B escribe con base vieja: debe ABORTAR y no tocar el remoto"
handoff_valido Claude "B cree que sigue" > "$T/nuevoB.md"
set +e; (cd "$T/B" && HANDOFF_BASE_SHA=$SB $H escribir "$T/nuevoB.md" "B: pisa" 2>"$T/errB"); RC=$?; set -e
check "B aborta con exit 3" '[ "$RC" = 3 ]'
check "mensaje explica el avance" 'grep -q "avanzó" "$T/errB"'
check "remoto intacto" '[ "$(git -C "$T/remoto.git" rev-parse main)" = "$REM1" ]'
check "remoto conserva la versión de A" 'git -C "$T/remoto.git" show main:docs/collab/HANDOFF.md | grep -q "A entregó"'

echo "4) B relee y entonces sí puede escribir, sobre la versión de A"
SB2=$(cd "$T/B" && $H leer | sed -n 's/^HANDOFF_BASE_SHA=//p')
check "B leyó la nueva base" '[ "$SB2" = "$REM1" ]'
check "B escribe tras releer" '(cd "$T/B" && HANDOFF_BASE_SHA=$SB2 $H escribir "$T/nuevoB.md" "B: tras releer" >/dev/null)'
check "historia lineal: A es padre de B" '[ "$(git -C "$T/remoto.git" rev-parse main^)" = "$REM1" ]'

echo "5) carrera entre fetch y push: el push no fast-forward se rechaza"
# Simula: B pasa el CAS, pero antes de su push alguien empuja. Reproducimos empujando
# directo al remoto un commit y luego intentando el push de un commit con padre viejo.
BASE=$(git -C "$T/remoto.git" rev-parse main)
(cd "$T/A" && git pull -q && handoff_valido ChatGPT "A otra vez" > docs/collab/HANDOFF.md && git commit -qam "A directo" && git push -q origin main)
(cd "$T/B" && git fetch -q && git checkout -q --detach "$BASE" && handoff_valido Claude "B viejo" > docs/collab/HANDOFF.md && git commit -qam "B viejo")
set +e; (cd "$T/B" && git push -q origin HEAD:refs/heads/main 2>/dev/null); RC=$?; set -e
check "push non-fast-forward rechazado por git" '[ "$RC" != 0 ]'
check "remoto conserva 'A otra vez'" 'git -C "$T/remoto.git" show main:docs/collab/HANDOFF.md | grep -q "A otra vez"'

echo "5b) el script clasifica el fallo del push (#58, AUDIT: CAMBIOS)"
# Carrera real DENTRO del script: un `git` de prueba en el PATH (solo en este test)
# empuja un commit de A justo antes del push de B; el CAS de B ya pasó.
(cd "$T/B" && git checkout -q main 2>/dev/null || true)
mkdir -p "$T/shim"; REAL_GIT=$(command -v git)
cat > "$T/shim/git" <<SHIM
#!/usr/bin/env bash
if [ "\$1" = push ] && [ ! -e "$T/shim/usado" ]; then
  touch "$T/shim/usado"
  ( cd "$T/A" && "$REAL_GIT" pull -q && printf '# HANDOFF\n\n**Pelota en:** ChatGPT — A en carrera\n' > docs/collab/HANDOFF.md && "$REAL_GIT" commit -qam "A en carrera" && "$REAL_GIT" push -q origin main )
fi
exec "$REAL_GIT" "\$@"
SHIM
chmod +x "$T/shim/git"
SR=$(cd "$T/B" && $H leer | sed -n 's/^HANDOFF_BASE_SHA=//p')
handoff_valido Claude "B en carrera" > "$T/nuevoBr.md"
set +e; (cd "$T/B" && PATH="$T/shim:$PATH" HANDOFF_BASE_SHA=$SR $H escribir "$T/nuevoBr.md" "B: carrera" 2>"$T/errR" >/dev/null); RC=$?; set -e
check "carrera real entre CAS y push → exit 3" '[ "$RC" = 3 ]'
check "carrera: el mensaje dice que main avanzó" 'grep -q "entre tu fetch y tu push (carrera)" "$T/errR"'
check "carrera: el remoto conserva la versión de A" 'git -C "$T/remoto.git" show main:docs/collab/HANDOFF.md | grep -q "A en carrera"'

# pushurl inválido: el fetch funciona (CAS OK) y el push falla por otra causa
SP=$(cd "$T/B" && $H leer | sed -n 's/^HANDOFF_BASE_SHA=//p')
git -C "$T/B" remote set-url --push origin "$T/no-existe.git"
handoff_valido Claude "B sin permiso" > "$T/nuevoBp.md"
set +e; (cd "$T/B" && HANDOFF_BASE_SHA=$SP $H escribir "$T/nuevoBp.md" "B: pushurl" 2>"$T/errP" >/dev/null); RC=$?; set -e
git -C "$T/B" remote set-url --push origin "$T/remoto.git"
check "pushurl inválido → exit 4 (no 3)" '[ "$RC" = 4 ]'
check "pushurl inválido: muestra el error real de git" 'grep -qi "no-existe.git" "$T/errP"'
check "pushurl inválido: NO dice carrera" '! grep -qE "carrera\)|otro escribió|no fast-forward" "$T/errP"'
check "pushurl inválido: remoto sin cambios" '[ "$(git -C "$T/remoto.git" rev-parse main)" = "$SP" ]'

# el servidor rechaza (hook, como una protección de rama)
printf '#!/bin/sh\necho "rama protegida: requiere PR" >&2\nexit 1\n' > "$T/remoto.git/hooks/pre-receive"; chmod +x "$T/remoto.git/hooks/pre-receive"
handoff_valido Claude "B contra hook" > "$T/nuevoBh.md"
set +e; (cd "$T/B" && HANDOFF_BASE_SHA=$SP $H escribir "$T/nuevoBh.md" "B: hook" 2>"$T/errH" >/dev/null); RC=$?; set -e
rm -f "$T/remoto.git/hooks/pre-receive"
check "hook del servidor rechaza → exit 4" '[ "$RC" = 4 ]'
check "hook: se ve el motivo del servidor" 'grep -q "rama protegida: requiere PR" "$T/errH"'
check "hook: NO dice carrera" '! grep -qE "carrera\)|otro escribió|no fast-forward" "$T/errH"'

echo "6) validaciones de formato"
printf '**Pelota en:** Claude\n**Pelota en:** ChatGPT\n' > "$T/dos.md"
check "dos pelotas → rechazo" '! (cd "$T/A" && $H validar "$T/dos.md" 2>/dev/null)'
printf '**Pelota en:** Fer\n' > "$T/fer.md"
check "pelota inválida → rechazo" '! (cd "$T/A" && $H validar "$T/fer.md" 2>/dev/null)'
{ handoff_valido Claude x; printf '=======\n'; } > "$T/conf.md"
check "marcador ======= → rechazo" '! (cd "$T/A" && $H validar "$T/conf.md" 2>/dev/null)'
{ handoff_valido Claude x; seq 1 60; } > "$T/largo.md"
check "61+ líneas → rechazo" '! (cd "$T/A" && $H validar "$T/largo.md" 2>/dev/null)'
# Reproducción del auditor (#58): 61 líneas lógicas con solo 60 "\n" (la última sin terminador)
{ printf '**Pelota en:** Claude — x\n'; seq 1 59; printf 'linea-sin-newline'; } > "$T/sin-nl-61.md"
check "61 líneas con la última sin newline → rechazo" '! (cd "$T/A" && $H validar "$T/sin-nl-61.md" 2>/dev/null)'
{ printf '**Pelota en:** Claude — x\n'; seq 1 58; printf 'linea-sin-newline'; } > "$T/sin-nl-60.md"
check "exactamente 60 con la última sin newline → OK (borde)" '(cd "$T/A" && $H validar "$T/sin-nl-60.md" >/dev/null 2>&1)'
# P-05: línea "En auditoría"
printf '**Pelota en:** ChatGPT — x\n' > "$T/aud-falta.md"
check "pelota en ChatGPT sin 'En auditoría' → rechazo (P-05)" '! (cd "$T/A" && $H validar "$T/aud-falta.md" 2>/dev/null)'
printf '**Pelota en:** ChatGPT — x\n**En auditoría:** #7 @ abc1234\n' > "$T/aud-corto.md"
check "'En auditoría' con sha corto → rechazo" '! (cd "$T/A" && $H validar "$T/aud-corto.md" 2>/dev/null)'
printf '**Pelota en:** ChatGPT — x\n**En auditoría:** ninguno\n' > "$T/aud-ninguno-cg.md"
check "pelota en ChatGPT con 'En auditoría: ninguno' → rechazo" '! (cd "$T/A" && $H validar "$T/aud-ninguno-cg.md" 2>/dev/null)'
printf '**Pelota en:** ChatGPT — x\n**En auditoría:** #7 @ %s\n**En auditoría:** #8 @ %s\n' "$SHA40" "$SHA40" > "$T/aud-dos.md"
check "dos líneas 'En auditoría' → rechazo" '! (cd "$T/A" && $H validar "$T/aud-dos.md" 2>/dev/null)'
printf '**Pelota en:** Claude — x\n**En auditoría:** #7 @ %s\n' "$SHA40" > "$T/aud-claude.md"
check "pelota en Claude con 'En auditoría: #7 @ sha' → OK" '(cd "$T/A" && $H validar "$T/aud-claude.md" >/dev/null 2>&1)'
printf '**Pelota en:** Claude — x\n**En auditoría:** ninguno\n' > "$T/aud-claude-n.md"
check "pelota en Claude con 'En auditoría: ninguno' → OK" '(cd "$T/A" && $H validar "$T/aud-claude-n.md" >/dev/null 2>&1)'
printf '**Pelota en:** Claude — x\n' > "$T/aud-claude-sin.md"
check "pelota en Claude sin la línea → OK (compatible con HANDOFFs anteriores)" '(cd "$T/A" && $H validar "$T/aud-claude-sin.md" >/dev/null 2>&1)'
printf '**Pelota en:** Claude — x\n**En auditoría:** #7\n' > "$T/aud-mal.md"
check "'En auditoría' sin sha → rechazo" '! (cd "$T/A" && $H validar "$T/aud-mal.md" 2>/dev/null)'
check "sin HANDOFF_BASE_SHA → rechazo" '! (cd "$T/A" && env -u HANDOFF_BASE_SHA $H escribir "$T/nuevoA.md" m 2>/dev/null)'
check "ningún git push lleva --force / --force-with-lease / -f" '! grep -E "git push.*(--force|-f\b)" "$AQUI/handoff.sh" | grep -v "^\s*#" | grep -q .'

echo; echo "handoff.test: $ok ok, $fallos fallos"
[ "$fallos" -eq 0 ]
