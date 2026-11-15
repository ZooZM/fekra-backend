#!/usr/bin/env bash
# Deploys one service on the VM and rolls it back if it does not become healthy.
#
#   remote-deploy.sh api <api-image> <migrate-image>
#   remote-deploy.sh dashboard <dashboard-image>
#   remote-deploy.sh preflight        # checks /opt/fekra/.env for the API; changes nothing
#
# Images are pinned by commit (name@sha256 or name:<full-sha>), never "latest".
# The last good image of each service is remembered in /opt/fekra/RELEASE_<service>.
# Runs on the VM, started by the deploy workflow over IAP SSH. Secrets are read from
# /opt/fekra/.env by the containers; this script never prints them.
set -euo pipefail

USAGE="usage: remote-deploy.sh <api|dashboard> <image> [migrate-image] | remote-deploy.sh preflight"
SERVICE="${1:?$USAGE}"

# FEKRA_ROOT exists only to try the script against a copy of the VM files; never set it on the VM.
ROOT="${FEKRA_ROOT:-/opt/fekra}"
ENV_FILE="$ROOT/.env"

# Prints one variable's value from the env file without sourcing it: nothing in the file is run or
# exported, and the caller only tests the value, never echoes it. Accepts "NAME=value",
# "export NAME=value", spaces around "=" and quotes. The last assignment wins, as in compose.
env_value() {
  local name="$1" line value="" assign_re quoted_re
  assign_re="^[[:space:]]*(export[[:space:]]+)?${name}[[:space:]]*=(.*)$"
  quoted_re="^([\"'])(.*)[\"']$"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    if [[ "$line" =~ $assign_re ]]; then value="${BASH_REMATCH[2]}"; fi
  done < "$ENV_FILE"
  value="${value#"${value%%[![:space:]]*}"}" # trim the start
  value="${value%"${value##*[![:space:]]}"}" # trim the end
  if [[ "$value" =~ $quoted_re ]]; then value="${BASH_REMATCH[2]}"; fi
  printf '%s' "$value"
}

# The API refuses to boot without N8N_BASE_URL (feature 003), and a failed boot only shows up after
# the migration and the container swap. Check it first, so a missing value stops the deploy while
# the running release keeps serving. Values are never printed.
preflight() {
  local base url_re='^https?://[^/?#[:space:]]+(/[^?#[:space:]]*)?$'
  if [ ! -r "$ENV_FILE" ]; then
    echo "Preflight failed: $ENV_FILE is missing or not readable by $(id -un). Nothing was changed." >&2
    exit 1
  fi
  base="$(env_value N8N_BASE_URL)"
  if [ -z "$base" ]; then
    {
      echo "Preflight failed: N8N_BASE_URL is missing or empty in $ENV_FILE."
      echo "  The new API does not start without it. Add the base address of the n8n chat"
      echo "  workflows, for example N8N_BASE_URL=https://n8n.example.com/webhook/"
      echo "  (see 'Releasing 003' in specs/003-chat-frontend-comment-analysis/quickstart.md)."
      echo "  Nothing was changed: the running release keeps serving."
    } >&2
    exit 1
  fi
  if [[ ! "$base" =~ $url_re ]]; then
    {
      echo "Preflight failed: N8N_BASE_URL in $ENV_FILE is not an http(s) address without a"
      echo "  query or fragment (the value is not shown). Nothing was changed."
    } >&2
    exit 1
  fi
  echo "Preflight: N8N_BASE_URL is set in $ENV_FILE."
}

if [ "$SERVICE" = preflight ]; then
  preflight
  exit 0
fi

IMAGE="${2:?$USAGE}"
MIGRATE_IMAGE="${3:-}"

DEPLOY="$ROOT/deploy"
COMPOSE="$DEPLOY/compose.yml"
HEALTH_TIMEOUT=60

cd "$DEPLOY"
# DOMAIN (and nothing secret) lives in deploy/.env, which compose also reads for interpolation
if [ -f "$DEPLOY/.env" ]; then set -a; . "$DEPLOY/.env"; set +a; fi
: "${DOMAIN:?set DOMAIN in $DEPLOY/.env}"

release_file() { echo "$ROOT/RELEASE_$1"; }
current() { [ -f "$(release_file "$1")" ] && cat "$(release_file "$1")" || true; }

# compose needs API_IMAGE even when only the dashboard changes
dc() {
  API_IMAGE="${API_IMAGE_OVERRIDE:-$(current api)}" \
  DASHBOARD_IMAGE="${DASHBOARD_IMAGE_OVERRIDE:-$(current dashboard)}" \
  MIGRATE_IMAGE="${MIGRATE_IMAGE_OVERRIDE:-$MIGRATE_IMAGE}" \
  DOMAIN="$DOMAIN" \
    docker compose -f "$COMPOSE" "$@"
}

wait_healthy() {
  local url="$1" waited=0
  until curl -fsS --max-time 5 -o /dev/null "$url"; do
    waited=$((waited + 3))
    if [ "$waited" -ge "$HEALTH_TIMEOUT" ]; then return 1; fi
    sleep 3
  done
}

# The Caddyfile is bind-mounted, so `up -d` does not touch a running Caddy even when the file
# changed. Reload it in place: no downtime, and a bad config is refused while the old one keeps
# serving. A failed reload does not roll the service back (the old Caddy config still works);
# it makes the script exit 1 at the end so the problem is not missed.
CADDY_RELOAD_FAILED=""
reload_caddy() {
  local attempt
  for attempt in 1 2 3; do
    if dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile; then return 0; fi
    sleep 2 # a Caddy that has only just started may not accept the reload yet
  done
  echo "Could not reload Caddy (see the error above); the previous config is still being served." >&2
  CADDY_RELOAD_FAILED=1
}

rollback() {
  local service="$1" previous="$2"
  if [ -z "$previous" ]; then
    echo "No previous $service release to roll back to." >&2
    return 0
  fi
  echo "Rolling $service back to $previous" >&2
  if [ "$service" = api ]; then
    API_IMAGE_OVERRIDE="$previous" dc up -d api
  else
    DASHBOARD_IMAGE_OVERRIDE="$previous" dc up -d dashboard
  fi
}

PREVIOUS="$(current "$SERVICE")"

case "$SERVICE" in
  api)
    : "${MIGRATE_IMAGE:?pass the migrate image as the third argument}"
    # before anything is pulled, migrated or replaced
    preflight
    API_IMAGE_OVERRIDE="$IMAGE" dc pull api migrate
    # Migrations are additive (constitution), so the running API keeps working while they apply.
    # If they fail nothing has been replaced yet: stop here.
    echo "Applying database migrations"
    API_IMAGE_OVERRIDE="$IMAGE" dc run --rm migrate
    API_IMAGE_OVERRIDE="$IMAGE" dc up -d api caddy
    # with the new image: on the first deploy there is no RELEASE_api for compose to fall back on
    API_IMAGE_OVERRIDE="$IMAGE" reload_caddy
    if wait_healthy "https://$DOMAIN/api/health"; then
      echo "$IMAGE" > "$(release_file api)"
      echo "api deployed: $IMAGE"
    else
      echo "api did not become healthy within ${HEALTH_TIMEOUT}s" >&2
      rollback api "$PREVIOUS"
      exit 1
    fi
    ;;
  dashboard)
    [ -n "$(current api)" ] || { echo "Deploy the api first: no RELEASE_api yet." >&2; exit 1; }
    DASHBOARD_IMAGE_OVERRIDE="$IMAGE" dc pull dashboard
    DASHBOARD_IMAGE_OVERRIDE="$IMAGE" dc up -d dashboard caddy
    DASHBOARD_IMAGE_OVERRIDE="$IMAGE" reload_caddy
    if wait_healthy "https://$DOMAIN/"; then
      echo "$IMAGE" > "$(release_file dashboard)"
      echo "dashboard deployed: $IMAGE"
    else
      echo "dashboard did not become healthy within ${HEALTH_TIMEOUT}s" >&2
      rollback dashboard "$PREVIOUS"
      exit 1
    fi
    ;;
  *)
    echo "unknown service: $SERVICE (use api or dashboard)" >&2
    exit 2
    ;;
esac

[ -z "$CADDY_RELOAD_FAILED" ] || exit 1