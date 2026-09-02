#!/bin/sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIRECTORY=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd)
ENV_FILE=$PROJECT_DIRECTORY/.env

fail() {
  printf 'Subweb error: %s\n' "$1" >&2
  exit 1
}

read_env_value() {
  key=$1
  [ -f "$ENV_FILE" ] || return 1
  awk -v key="$key" 'index($0, key "=") == 1 { count += 1; value = substr($0, length(key) + 2) } END { if (count == 1) print value; else exit (count > 1 ? 2 : 1) }' "$ENV_FILE"
}

command_name=${1-}
[ -n "$command_name" ] || fail 'usage: subweb.sh install|up|down|status|logs|verify|backup|upgrade ...'
shift

if [ "$command_name" = install ]; then
  exec "$SCRIPT_DIRECTORY/docker-deploy.sh" "$@"
fi

command -v docker >/dev/null 2>&1 || fail 'Docker is not installed or not available in PATH.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required.'

short_links_enabled=true
if value=$(read_env_value SHORT_LINKS_ENABLED); then
  short_links_enabled=$value
else
  status=$?
  [ "$status" -eq 1 ] || fail 'SHORT_LINKS_ENABLED is duplicated in .env.'
fi
case "$short_links_enabled" in
  true) compose_file=compose.yaml ;;
  false) compose_file=compose.disabled-short-links.yaml ;;
  *) fail 'SHORT_LINKS_ENABLED must be true or false.' ;;
esac

cd "$PROJECT_DIRECTORY"
compose() {
  docker compose -f "$compose_file" "$@"
}

case "$command_name" in
  up)
    [ "$#" -eq 0 ] || fail 'up does not accept extra arguments.'
    compose up -d --no-build --pull never --wait
    ;;
  down)
    [ "$#" -eq 0 ] || fail 'down does not accept extra arguments.'
    compose down
    ;;
  status)
    [ "$#" -eq 0 ] || fail 'status does not accept extra arguments.'
    compose ps
    ;;
  logs)
    compose logs "$@"
    ;;
  verify)
    [ "$#" -eq 0 ] || fail 'verify does not accept extra arguments.'
    SHORT_LINKS_ENABLED=$short_links_enabled COMPOSE_VALIDATION_FILE=$compose_file \
      "$SCRIPT_DIRECTORY/validate-compose.sh"
    compose ps
    ;;
  backup)
    compose ps --services --filter status=running >/dev/null || fail 'unable to inspect running services.'
    export COMPOSE_FILE=$compose_file
    exec "$SCRIPT_DIRECTORY/operations/backup-redis.sh" "$@"
    ;;
  upgrade)
    [ "$#" -eq 0 ] || fail 'upgrade does not accept extra arguments.'
    if [ "$short_links_enabled" = true ]; then
      compose pull gateway subconverter myurls-app myurls-short redis
    else
      compose pull gateway subconverter
    fi
    compose up -d --no-build --pull never --wait
    ;;
  *)
    fail "unknown command: $command_name"
    ;;
esac
