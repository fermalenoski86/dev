#!/bin/bash
# Smoke test REAL del bootstrap — Integrity Gate A.1, punto 7.
#
# Cluster PostgreSQL NUEVO y vacío (sin roles trust_*), bootstrap.sql ejecutado
# con psql (el mismo camino que usa operaciones), migraciones como trust_owner
# y verificación de permisos como trust_app. Ningún paso pasa por el arnés JS.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
PORT=${SMOKE_PORT:-5434}
DATA=$(mktemp -d /tmp/pg-smoke-XXXX)
OWNER_PW="own'er pw"     # comilla adentro A PROPÓSITO: prueba el escape
APP_PW="app\"pw'2"
corre() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
chown postgres:postgres "$DATA" 2>/dev/null || true
echo admin > "$DATA.pw"; chmod 644 "$DATA.pw"
corre "$BIN/initdb -D $DATA -A scram-sha-256 --pwfile=$DATA.pw -U postgres" > /dev/null
corre "$BIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp' -l $DATA.log -w start" > /dev/null
trap 'corre "$BIN/pg_ctl -D $DATA -m immediate stop" >/dev/null 2>&1; rm -rf $DATA $DATA.pw $DATA.log' EXIT

ADMIN="postgres://postgres:admin@127.0.0.1:$PORT/postgres"
echo "== roles antes del bootstrap: $(psql "$ADMIN" -tAc "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'trust_%'")"
psql "$ADMIN" -q -v ON_ERROR_STOP=1 -v owner_password="$OWNER_PW" -v app_password="$APP_PW" -v db_name=trust -f src/bootstrap.sql
psql "$ADMIN" -q -v ON_ERROR_STOP=1 -v owner_password="$OWNER_PW" -v app_password="$APP_PW" -v db_name=trust -f src/bootstrap.sql
echo "== bootstrap corrido dos veces (idempotente)"
echo "== roles después: $(psql "$ADMIN" -tAc "SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles WHERE rolname LIKE 'trust_%'")"

enc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
export TRUST_SMOKE_OWNER_URL="postgres://trust_owner:$(enc "$OWNER_PW")@127.0.0.1:$PORT/trust"
export TRUST_SMOKE_APP_URL="postgres://trust_app:$(enc "$APP_PW")@127.0.0.1:$PORT/trust"
cd ../..
npx vitest run -c vitest.platform.config.ts packages/platform-db/src/bootstrap.smoke.db.test.ts
