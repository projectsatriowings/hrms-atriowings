#!/bin/bash
# Local PostgreSQL for HRMS Pro dev (this VM).
# Binaries: ~/pgbin (PostgreSQL 18.4, no sudo needed). Data: /tmp/pgdata (ephemeral).
# Usage: ./scripts/db-local.sh start|stop|restart|init
set -e
BIN=/home/hatch/pgbin/@embedded-postgres/linux-x64/native/bin
DATA=/tmp/pgdata
PORT=5433

case "${1:-start}" in
  init)
    chmod a+x /home/hatch /home/hatch/pgbin
    su postgres -c "mkdir -p $DATA && $BIN/initdb -D $DATA -U hrms --auth=trust"
    ;;
  start)
    chmod a+x /home/hatch /home/hatch/pgbin 2>/dev/null || true
    if [ ! -d "$DATA" ]; then
      su postgres -c "mkdir -p $DATA && $BIN/initdb -D $DATA -U hrms --auth=trust"
    fi
    su postgres -c "$BIN/pg_ctl -D $DATA -l /tmp/pg.log -o '-p $PORT -k /tmp' start"
    ;;
  stop)
    su postgres -c "$BIN/pg_ctl -D $DATA stop" || true
    ;;
  restart)
    "$0" stop; sleep 1; "$0" start
    ;;
esac
