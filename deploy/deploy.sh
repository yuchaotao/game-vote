#!/usr/bin/env bash
# Deploys the latest main to production.
#
# Run on the server from the production checkout (default /opt/game-vote):
#   deploy/deploy.sh            # pull main, fetch its CI-built image, back up the database, restart
#   deploy/deploy.sh --no-pull  # deploy what is checked out (e.g. an older commit, to roll back)
#   deploy/deploy.sh --build    # build the image here instead of pulling it from GHCR
#
# Requires deploy/.env.prod and a one-time `docker login ghcr.io` (see deploy/README.md).
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=deploy/.env.prod
IMAGE_REPO=${GAME_VOTE_IMAGE_REPO:-ghcr.io/yuchaotao/game-vote}
COMPOSE=(docker compose -p game-vote-prod --env-file "$ENV_FILE"
  -f docker-compose.yml -f deploy/docker-compose.prod.yml --profile app)

pull=1 build=0
for arg in "$@"; do
  case $arg in
    --no-pull) pull=0 ;;
    --build) build=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

[[ -f $ENV_FILE ]] || { echo "Missing $ENV_FILE (see deploy/README.md)" >&2; exit 1; }
# compose's env_file for web/worker points at ./.env; keep it in sync with the prod env.
ln -sf "$ENV_FILE" .env

if ((pull)); then
  before=$(git rev-parse HEAD:deploy/deploy.sh)
  git fetch --quiet origin main
  git checkout --quiet main
  git reset --quiet --hard origin/main
  # bash keeps running the copy it started with; switch to the updated script.
  if [[ $(git rev-parse HEAD:deploy/deploy.sh) != "$before" ]]; then
    echo "deploy.sh changed; re-running the new version"
    exec deploy/deploy.sh --no-pull "${@}"
  fi
fi
echo "Deploying $(git log -1 --format='%h %s')"

if ((build)); then
  export GAME_VOTE_IMAGE=game-vote:prod
  "${COMPOSE[@]}" build web
else
  # CI builds and pushes this tag once every check on main has passed.
  export GAME_VOTE_IMAGE=$IMAGE_REPO:sha-$(git rev-parse HEAD)
  echo "Pulling $GAME_VOTE_IMAGE (waits while CI is still building it)..."
  for i in $(seq 1 60); do
    if out=$(docker pull --quiet "$GAME_VOTE_IMAGE" 2>&1); then break; fi
    if grep -qiE 'unauthorized|denied|no basic auth' <<<"$out"; then
      echo "$out" >&2
      echo "Not logged in to ghcr.io; see deploy/README.md, or use --build." >&2
      exit 1
    fi
    if ((i == 60)); then
      echo "$out" >&2
      echo "Image not available after 30 minutes. Did CI on main pass? Or use --build." >&2
      exit 1
    fi
    sleep 30
  done
fi

# BASE_PATH is baked into the build; refuse an image built for another path.
want=$(sed -n 's/^BASE_PATH=//p' "$ENV_FILE")
have=$(docker image inspect "$GAME_VOTE_IMAGE" --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BASE_PATH=//p')
if [[ $want != "$have" ]]; then
  echo "Image was built with BASE_PATH='$have' but $ENV_FILE has '$want'; use --build." >&2
  exit 1
fi

# Back up before migrations run (skipped on the very first deploy).
if "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx postgres; then
  deploy/backup.sh
fi

"${COMPOSE[@]}" up -d --remove-orphans

echo "Waiting for the web app to become healthy..."
healthy=0
for _ in $(seq 1 40); do
  status=$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | awk '$1=="web"{print $2}')
  if [[ $status == healthy ]]; then healthy=1; break; fi
  sleep 5
done
if ((!healthy)); then
  echo "Web app did not become healthy; recent logs:" >&2
  "${COMPOSE[@]}" logs --tail 50 web >&2
  exit 1
fi
echo "Deployed. $("${COMPOSE[@]}" ps --format '{{.Service}}: {{.Status}}' | paste -sd ';' | sed 's/;/; /g')"

# Keep the running image and the two before it (for a quick rollback); drop older ones.
docker images "$IMAGE_REPO" --format '{{.Repository}}:{{.Tag}}' | grep -v ':main$' |
  grep -vxF "$GAME_VOTE_IMAGE" | tail -n +3 | xargs -r docker rmi --force >/dev/null || true
