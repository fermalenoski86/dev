#!/bin/bash
# Cluster PostgreSQL 16 descartable para desarrollo y tests de plataforma.
# Puerto 5433, socket en /tmp, usuario postgres/postgres. Idempotente.
set -e
BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
DATA=${PG_DATA:-/tmp/pgdata}
if [ ! -s "$DATA/PG_VERSION" ]; then
  rm -rf "$DATA"; mkdir -p "$DATA"; chown postgres:postgres "$DATA"
  echo postgres > /tmp/pgpw && chmod 644 /tmp/pgpw
  su postgres -s /bin/bash -c "$BIN/initdb -D $DATA -A scram-sha-256 --pwfile=/tmp/pgpw -U postgres" > /tmp/pg_init.log 2>&1
fi
su postgres -s /bin/bash -c "$BIN/pg_ctl -D $DATA status" > /dev/null 2>&1 || \
  su postgres -s /bin/bash -c "$BIN/pg_ctl -D $DATA -o '-p 5433 -k /tmp' -l /tmp/pg.log -w start" > /dev/null
su postgres -s /bin/bash -c "$BIN/pg_ctl -D $DATA status" | head -1
