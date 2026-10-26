#!/bin/bash
# Recover the local HRMS dev environment after a VM/runtime restart.
# Re-creates the postgres cluster (/tmp is ephemeral), migrates, seeds, and boots API + web.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"
PGDIR="$HOME/pgbin/@embedded-postgres/linux-x64/native/bin"

if ! id postgres >/dev/null 2>&1; then useradd -m postgres; fi
chmod a+x "$HOME" "$HOME/pgbin" 2>/dev/null || true

if [ ! -f /tmp/pgdata/PG_VERSION ]; then
  echo "== initdb =="
  su postgres -s /bin/bash -c "$PGDIR/initdb -D /tmp/pgdata -E UTF8" >/dev/null 2>&1
  FRESH_DB=1
else
  FRESH_DB=0
fi

if ! su postgres -s /bin/bash -c "$PGDIR/pg_ctl -D /tmp/pgdata status" >/dev/null 2>&1; then
  echo "== starting postgres =="
  su postgres -s /bin/bash -c "$PGDIR/pg_ctl -D /tmp/pgdata -o '-c listen_addresses=127.0.0.1 -p 5433 -k /tmp' -l /tmp/pg.log start"
fi

# /tmp is ephemeral: PG_VERSION can exist while the hrms db/role were never
# created (interrupted recovery). Verify connectivity as the app user and
# repair when it fails.
if [ "${FRESH_DB:-0}" = "0" ]; then
  echo "== verifying hrms database =="
  DB_OK=$(cd "$SCRIPT_DIR/apps/api" && (set -a && . ./.env && set +a && node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => { await p.\$queryRawUnsafe('SELECT 1'); console.log('ok'); await p.\$disconnect(); })().catch(() => process.exit(1));
" 2>/dev/null)) || DB_OK=""
  if [ "$DB_OK" != "ok" ]; then
    echo "== hrms database unreachable, recreating =="
    FRESH_DB=1
  fi
fi

if [ "${FRESH_DB:-0}" = "1" ]; then
  echo "== creating database objects =="
  cd "$SCRIPT_DIR/apps/api"
  node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres@localhost:5433/postgres?schema=public' } } });
(async () => {
  await p.\$executeRawUnsafe('CREATE DATABASE hrms');
  await p.\$executeRawUnsafe(\"CREATE ROLE hrms WITH LOGIN PASSWORD 'hrms'\");
  await p.\$executeRawUnsafe('GRANT ALL PRIVILEGES ON DATABASE hrms TO hrms');
  await p.\$disconnect();
  const q = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres@localhost:5433/hrms?schema=public' } } });
  await q.\$executeRawUnsafe('GRANT ALL ON SCHEMA public TO hrms');
  await q.\$executeRawUnsafe('ALTER SCHEMA public OWNER TO hrms');
  await q.\$disconnect();
  console.log('db objects ok');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
"
  set -a && . ./.env && set +a
  ./node_modules/.bin/prisma migrate deploy 2>&1 | tail -1
  pnpm seed 2>&1 | tail -2
fi

echo "== starting servers =="
pkill -f "node dist/main" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 1
cd "$SCRIPT_DIR/apps/api"
(set -a && . ./.env && set +a && exec node dist/main) >/tmp/hrms-api.log 2>&1 &
cd "$SCRIPT_DIR/apps/web"
(exec ./node_modules/.bin/next start -p 3000) >/tmp/hrms-web.log 2>&1 &
sleep 12
curl -s http://localhost:4000/api/v1/auth/login -X POST -H "Content-Type: application/json" -d '{"email":"admin@atriowings.in","password":"Atriowings@123"}' -o /dev/null -w "API:%{http_code} "
curl -s -o /dev/null -w "WEB:%{http_code}\n" http://localhost:3000/login --max-time 10
