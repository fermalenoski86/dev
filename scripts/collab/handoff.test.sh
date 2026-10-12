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
handoff_valido() { printf '# HANDOFF\n\n**Pelota en:** %s — %s\n' "$1" "$2"; }

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
check "sin HANDOFF_BASE_SHA → rechazo" '! (cd "$T/A" && env -u HANDOFF_BASE_SHA $H escribir "$T/nuevoA.md" m 2>/dev/null)'
check "ningún git push lleva --force / --force-with-lease / -f" '! grep -E "git push.*(--force|-f\b)" "$AQUI/handoff.sh" | grep -v "^\s*#" | grep -q .'

echo; echo "handoff.test: $ok ok, $fallos fallos"
[ "$fallos" -eq 0 ]
