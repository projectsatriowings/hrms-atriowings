#!/bin/bash
# Attenza backup example (review fix B3) — docs + script only; it does not
# change the live dev database setup. For production, prefer managed
# Postgres with automated backups (see README "Backups & restore").
#
# Usage:
#   DATABASE_URL=postgres://... ./scripts/backup.sh
#   BACKUP_DIR=/var/backups/attenza BACKUP_KEEP_DAYS=30 ./scripts/backup.sh
#
# Writes a custom-format dump (pg_restore-compatible) to a dated file and
# prunes backups older than BACKUP_KEEP_DAYS. Restoring is tested by
# restoring into a scratch database — see the README section.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
: "${DATABASE_URL:?Set DATABASE_URL to the Postgres connection string}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/attenza-$STAMP.dump"

pg_dump "$DATABASE_URL" -Fc -f "$FILE"
echo "Backup written: $FILE"

# Keep only the last N days of backups.
find "$BACKUP_DIR" -name 'attenza-*.dump' -type f -mtime "+$BACKUP_KEEP_DAYS" -delete
echo "Pruned backups older than $BACKUP_KEEP_DAYS days in $BACKUP_DIR"
