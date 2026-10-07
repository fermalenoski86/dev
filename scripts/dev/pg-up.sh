#!/bin/bash
# Cluster PostgreSQL 16 descartable para desarrollo y tests de plataforma.
# Puerto 5433 (PG_PORT), socket en /tmp, superusuario de la DB postgres/postgres. Idempotente.
#
# Corre de dos maneras:
#   - como usuario normal (CI de GitHub, Codex, devs): initdb/pg_ctl directo;
#   - como root: vía `su postgres` (PostgreSQL no arranca como root).
set -e
BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
DATA=${PG_DATA:-/tmp/pgdata}
PORT=${PG_PORT:-5433}
if [ ! -x "$BIN/initdb" ]; then
  echo "pg-up: no encuentro PostgreSQL 16 en $BIN." >&2
  echo "  Ubuntu/Debian: apt-get install -y postgresql-16" >&2
  echo "  Otra ruta: PG_BIN=/ruta/a/bin bash scripts/dev/pg-up.sh" >&2
  exit 2
fi
if [ "$(id -u)" = 0 ]; then
  if ! id postgres > /dev/null 2>&1; then
    echo "pg-up: como root hace falta el usuario del sistema 'postgres'." >&2
    echo "  Alternativa: correr este script como un usuario normal (no root)." >&2
    exit 2
  fi
  corre() { su postgres -s /bin/bash -c "$*"; }
else
  corre() { bash -c "$*"; }
fi
if [ ! -s "$DATA/PG_VERSION" ]; then
  rm -rf "$DATA"; mkdir -p "$DATA"
  [ "$(id -u)" = 0 ] && chown postgres:postgres "$DATA"
  PW=$(mktemp); echo postgres > "$PW"; chmod 644 "$PW"
  corre "$BIN/initdb -D $DATA -A scram-sha-256 --pwfile=$PW -U postgres" > "${DATA}.init.log" 2>&1
  rm -f "$PW"
fi
corre "$BIN/pg_ctl -D $DATA status" > /dev/null 2>&1 || \
  corre "$BIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp' -l ${DATA}.log -w start" > /dev/null
corre "$BIN/pg_ctl -D $DATA status" | head -1
