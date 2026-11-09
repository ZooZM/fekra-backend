#!/usr/bin/env bash
# Deploys one service on the VM and rolls it back if it does not become healthy.
#
#   remote-deploy.sh api <api-image> <migrate-image>
#   remote-deploy.sh dashboard <dashboard-image>
#
# Images are pinned by commit (name@sha256 or name:<full-sha>), never "latest".
# The last good image of each service is remembered in /opt/fekra/RELEASE_<service>.
# Runs on the VM, started by the deploy workflow over IAP SSH. Secrets are read from
# /opt/fekra/.env by the containers; this script never prints them.
set -euo pipefail

SERVICE="${1:?usage: remote-deploy.sh <api|dashboard> <image> [migrate-image]}"
IMAGE="${2:?usage: remote-deploy.sh <api|dashboard> <image> [migrate-image]}"
MIGRATE_IMAGE="${3:-}"

ROOT=/opt/fekra
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
  echo "Caddy rejected the new Caddyfile; the previous config is still being served." >&2
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
    API_IMAGE_OVERRIDE="$IMAGE" dc pull api migrate
    # Migrations are additive (constitution), so the running API keeps working while they apply.
    # If they fail nothing has been replaced yet: stop here.
    echo "Applying database migrations"
    API_IMAGE_OVERRIDE="$IMAGE" dc run --rm migrate
    API_IMAGE_OVERRIDE="$IMAGE" dc up -d api caddy
    reload_caddy
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
    reload_caddy
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