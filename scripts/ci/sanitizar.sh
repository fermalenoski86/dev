#!/bin/bash
# P-04 · Filtro de salida antes de publicarla (anotaciones, logs en test-results/ci/).
# Oculta lo que no puede quedar en un repo público ni en un artifact: cabeceras de
# autenticación y cookies, variables/claves *token*/*secret*/*password*/*key*
# (cualquier nombre que contenga `key`: SSH_KEY, SIGNING_KEY, apiKey, `key=`; prefiere
# ocultar de más: `token: expirado` y `monkey=1` también se tapan), tokens de GitHub/AWS/JWT,
# credenciales en URLs y claves privadas. Valores entre comillas se tapan enteros (escapes incluidos). No detecta datos comerciales: en CI no hay
# datos de clientes (fixtures sintéticos; gates.yml no usa `secrets.*`).
#   uso: ... | scripts/ci/sanitizar.sh
set -o pipefail
# Nombre de la variable/clave (contiene token|secret|password|…) y separador. El separador admite
# la comilla de cierre de la clave (JSON o dict con comillas simples), también escapada (`\"password\":`: JSON dentro de un string).
K='([A-Za-z0-9_.-]*(token|secret|password|passwd|credential|key)[A-Za-z0-9_.-]*)'
SEP="(\\\\*[\"']?[[:space:]]*[=:][[:space:]]*)"
Q="'"
# Valores entre comillas: se reconocen los escapes (`\"`, `\\`, `\'`), así una comilla escapada no
# cierra el valor antes de tiempo (P-04, AUDIT #75: `"abc\\\"DEF"` dejaba ver `DEF`). Sin cierre real
# (o con una barra suelta al final) se tapa hasta el fin de línea. Un valor que abre con comilla
# escapada (`\"…`, JSON dentro de un string) se tapa hasta el fin de línea: tapar de más es el criterio.
sed -E \
  -e '/-----BEGIN [A-Z ]*PRIVATE KEY-----/,/-----END [A-Z ]*PRIVATE KEY-----/c\[clave privada oculta]' \
  -e 's/((authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)[[:space:]]*[:=][[:space:]]*).*/\1[oculto]/I' \
  -e "s/$K$SEP\\\\+[\"$Q].*\$/\\1\\3[oculto]/I" \
  -e "s/$K$SEP\"([^\"\\\\]|\\\\.)*\"/\\1\\3\"[oculto]\"/Ig" \
  -e "s/$K$SEP$Q([^$Q\\\\]|\\\\.)*$Q/\\1\\3$Q[oculto]$Q/Ig" \
  -e "s/$K$SEP\"([^\"\\\\]|\\\\.)*\\\\?\$/\\1\\3\"[oculto]/I" \
  -e "s/$K$SEP$Q([^$Q\\\\]|\\\\.)*\\\\?\$/\\1\\3$Q[oculto]/I" \
  -e "s/$K$SEP([\"$Q]?)([^\"$Q[:space:],;\\\\]|\\\\.)+/\\1\\3\\4[oculto]/Ig" \
  -e 's/(__Host-[A-Za-z0-9_-]+=)[^;[:space:]]+/\1[oculto]/g' \
  -e 's/\<Bearer[[:space:]]+[A-Za-z0-9._~+\/=-]+/Bearer [oculto]/g' \
  -e 's/\<eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/[jwt oculto]/g' \
  -e 's/\<(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\>/[token oculto]/g' \
  -e 's/\<AKIA[0-9A-Z]{16}\>/[aws oculto]/g' \
  -e 's#://[^/@[:space:]]+:[^/@[:space:]]+@#://[oculto]@#g'
