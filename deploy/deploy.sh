#!/usr/bin/env bash
# Deploys the latest main to production.
#
# Run on the server from the production checkout (default /opt/game-vote):
#   deploy/deploy.sh            # pull main, back up the database, rebuild, restart
#   deploy/deploy.sh --no-pull  # rebuild what is checked out
#
# Requires deploy/.env.prod (see deploy/README.md).
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=deploy/.env.prod
COMPOSE=(docker compose -p game-vote-prod --env-file "$ENV_FILE"
  -f docker-compose.yml -f deploy/docker-compose.prod.yml --profile app)

[[ -f $ENV_FILE ]] || { echo "Missing $ENV_FILE (see deploy/README.md)" >&2; exit 1; }
# compose's env_file for web/worker points at ./.env; keep it in sync with the prod env.
ln -sf "$ENV_FILE" .env

if [[ ${1:-} != --no-pull ]]; then
  git fetch --quiet origin main
  git checkout --quiet main
  git reset --quiet --hard origin/main
fi
echo "Deploying $(git log -1 --format='%h %s')"

# Back up before migrations run (skipped on the very first deploy).
if "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx postgres; then
  deploy/backup.sh
fi

"${COMPOSE[@]}" build web
"${COMPOSE[@]}" up -d --remove-orphans

echo "Waiting for the web app to become healthy..."
for _ in $(seq 1 40); do
  status=$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | awk '$1=="web"{print $2}')
  if [[ $status == healthy ]]; then
    echo "Deployed. $("${COMPOSE[@]}" ps --format '{{.Service}}: {{.Status}}' | paste -sd ';' | sed 's/;/; /g')"
    exit 0
  fi
  sleep 5
done
echo "Web app did not become healthy; recent logs:" >&2
"${COMPOSE[@]}" logs --tail 50 web >&2
exit 1
