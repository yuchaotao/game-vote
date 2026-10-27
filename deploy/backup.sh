#!/usr/bin/env bash
# Dumps the production database to $BACKUP_DIR and prunes old dumps.
# Run by deploy.sh before each deploy and daily by the systemd timer
# (deploy/game-vote-backup.timer).
set -euo pipefail
umask 077  # dumps contain password hashes and emails

cd "$(dirname "$0")/.."
BACKUP_DIR=${BACKUP_DIR:-/var/backups/game-vote}
KEEP_DAYS=${KEEP_DAYS:-14}

mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/gamevote-$(date +%Y%m%d-%H%M%S).sql.gz"

docker compose -p game-vote-prod --env-file deploy/.env.prod \
  -f docker-compose.yml -f deploy/docker-compose.prod.yml \
  exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' \
  | gzip > "$file.tmp"
mv "$file.tmp" "$file"

find "$BACKUP_DIR" -name 'gamevote-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "Backup written: $file ($(du -h "$file" | cut -f1))"
