#!/usr/bin/env bash
# Sobe um Postgres 16 descartável para testes locais (sem Docker). Uso: scripts/pg-local.sh
set -euo pipefail
BIN=/usr/lib/postgresql/16/bin
DATA=${PGDATA_DIR:-/tmp/jc-pgdata}
if [ ! -d "$DATA" ]; then
  install -d -o postgres "$DATA"
  su postgres -c "$BIN/initdb -D $DATA -A trust -U postgres >/dev/null"
fi
su postgres -c "$BIN/pg_ctl -D $DATA -o '-p 5432 -c listen_addresses=localhost' -l $DATA/log -w start" || true
echo "TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres"
