#!/bin/sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIRECTORY=$(CDPATH='' cd -- "$SCRIPT_DIRECTORY/.." && pwd)
DEFAULT_ENV_FILE=$PROJECT_DIRECTORY/.env
ENV_FILE=${SUBWEB_ENV_FILE:-$DEFAULT_ENV_FILE}
. "$SCRIPT_DIRECTORY/lib/path-lock.sh"
. "$SCRIPT_DIRECTORY/lib/docker-environment.sh"

SUBWEB_ENV_LOCK_DIRECTORY=
SUBWEB_ENV_LOCK_TOKEN=
SUBWEB_VERSION_LOCK_DIRECTORY=
SUBWEB_VERSION_LOCK_TOKEN=
validated_env_file=
upgrade_env_file=
cleanup_complete=0
cleanup() {
  [ "$cleanup_complete" -eq 0 ] || return 0
  cleanup_complete=1
  [ -z "$validated_env_file" ] || rm -f "$validated_env_file"
  [ -z "$upgrade_env_file" ] || rm -f "$upgrade_env_file"
  release_path_lock "$SUBWEB_VERSION_LOCK_DIRECTORY" || true
  release_path_lock "$SUBWEB_ENV_LOCK_DIRECTORY" || true
}
trap cleanup 0
trap 'cleanup; exit 1' HUP INT TERM

fail() {
  printf 'Subweb error: %s\n' "$1" >&2
  exit 1
}

case "$ENV_FILE" in
  /*) ;;
  *)
    env_directory=$(CDPATH='' cd -- "$(dirname -- "$ENV_FILE")" && pwd -P) \
      || fail 'production .env parent directory is unavailable.'
    ENV_FILE=$env_directory/$(basename -- "$ENV_FILE")
    ;;
esac
export SUBWEB_ENV_FILE="$ENV_FILE"
SUBWEB_ENV_LOCK_TARGET=$ENV_FILE
export SUBWEB_ENV_LOCK_TARGET
# Compose project selection is owned by each controlled verifier, never by the caller.
unset COMPOSE_PROJECT_NAME
read_env_value() {
  key=$1
  [ -f "$ENV_FILE" ] || return 1
  awk -v key="$key" 'index($0, key "=") == 1 { count += 1; value = substr($0, length(key) + 2) } END { if (count == 1) print value; else exit (count > 1 ? 2 : 1) }' "$ENV_FILE"
}

command_name=${1-}
[ -n "$command_name" ] || fail 'usage: subweb.sh install|up|down|status|logs|verify|backup|restore|upgrade ...'
shift

if [ "$command_name" = install ]; then
  [ "$ENV_FILE" = "$DEFAULT_ENV_FILE" ] \
    || fail 'install requires the repository .env; unset SUBWEB_ENV_FILE before provisioning.'
  if [ "$#" -eq 0 ]; then
    [ -t 0 ] && [ -t 2 ] \
      || fail 'interactive install requires an interactive terminal; arguments are required for automation.'
    exec "$SCRIPT_DIRECTORY/install-wizard.sh"
  fi
  exec "$SCRIPT_DIRECTORY/docker-deploy.sh" "$@"
fi

environment_file_identity() {
  if identity=$(stat -Lc '%d:%i' "$1" 2>/dev/null); then
    case "$identity" in
      *[!0-9:]*|*::*|:*) return 1 ;;
    esac
  else
    # macOS fdesc reports a synthetic device for /dev/fd/N but preserves inode.
    identity=$(stat -Lf '%i' "$1") || return 1
    case "$identity" in
      *[!0-9]*|'') return 1 ;;
    esac
  fi
  printf '%s\n' "$identity"
}

require_production_env() {
  [ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] \
    || fail 'production .env is required and must be a regular, non-symlink file.'

  if permissions=$(stat -c '%a' "$ENV_FILE" 2>/dev/null); then
    :
  else
    permissions=$(stat -f '%Lp' "$ENV_FILE") \
      || fail 'unable to inspect production .env permissions.'
  fi
  [ "$permissions" = 600 ] || fail 'production .env must be mode 0600.'
  production_env_identity=$(environment_file_identity "$ENV_FILE") \
    || fail 'unable to identify the production .env file.'
}

acquire_path_lock "$ENV_FILE" || fail 'could not lock the production environment.'
SUBWEB_ENV_LOCK_DIRECTORY=$PATH_LOCK_DIRECTORY
SUBWEB_ENV_LOCK_TOKEN=$PATH_LOCK_TOKEN
require_production_env

validated_env_file=$(mktemp "${TMPDIR:-/tmp}/subweb-env.XXXXXX") \
  || fail 'unable to create a private production environment snapshot.'
chmod 0600 "$validated_env_file" \
  || fail 'unable to protect the production environment snapshot.'
exec 9< "$ENV_FILE" || fail 'unable to open the production environment.'
opened_env_identity=$(environment_file_identity /dev/fd/9) \
  || fail 'unable to identify the opened production environment.'
[ "$opened_env_identity" = "$production_env_identity" ] \
  || fail 'production .env changed before it could be opened.'
cat <&9 > "$validated_env_file" \
  || fail 'unable to snapshot the production environment.'
cmp -s "$validated_env_file" "$ENV_FILE" \
  || fail 'production .env changed while it was being snapshotted.'
exec 9<&-
current_env_identity=$(environment_file_identity "$ENV_FILE") \
  || fail 'unable to identify the production .env file after snapshotting.'
[ "$current_env_identity" = "$production_env_identity" ] \
  || fail 'production .env changed while it was being snapshotted.'
[ -f "$validated_env_file" ] && [ ! -L "$validated_env_file" ] \
  || fail 'production environment snapshot is invalid.'
chmod 0600 "$validated_env_file" \
  || fail 'unable to protect the production environment snapshot.'
ENV_FILE=$validated_env_file
export SUBWEB_ENV_FILE="$ENV_FILE"

command -v docker >/dev/null 2>&1 || fail 'Docker is not installed or not available in PATH.'
run_docker_environment docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required.'

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
compose() (
  COMPOSE_FILE=$compose_file
  SUBWEB_ENV_FILE=$ENV_FILE
  export COMPOSE_FILE SUBWEB_ENV_FILE
  run_docker_environment docker compose --env-file "$ENV_FILE" -f "$compose_file" "$@"
)

run_operation() (
  COMPOSE_FILE=$compose_file
  SUBWEB_ENV_FILE=$ENV_FILE
  export COMPOSE_FILE SUBWEB_ENV_FILE
  run_docker_environment "$@"
)

validate_compose() (
  SUBWEB_ENV_LOCK_HELD=1
  SUBWEB_ENV_LOCK_DIRECTORY=$SUBWEB_ENV_LOCK_DIRECTORY
  SUBWEB_ENV_LOCK_TOKEN=$SUBWEB_ENV_LOCK_TOKEN
  SUBWEB_ENV_FILE=$ENV_FILE
  SHORT_LINKS_ENABLED=$short_links_enabled
  COMPOSE_VALIDATION_FILE=$compose_file
  export SUBWEB_ENV_LOCK_HELD SUBWEB_ENV_LOCK_DIRECTORY SUBWEB_ENV_LOCK_TOKEN
  export SUBWEB_ENV_FILE SHORT_LINKS_ENABLED COMPOSE_VALIDATION_FILE
  if [ -n "$SUBWEB_VERSION_LOCK_DIRECTORY" ]; then
    SUBWEB_VERSION_LOCK_HELD=1
    export SUBWEB_VERSION_LOCK_HELD SUBWEB_VERSION_LOCK_DIRECTORY SUBWEB_VERSION_LOCK_TOKEN
  fi
  "$SCRIPT_DIRECTORY/validate-compose.sh"
)

case "$command_name" in
  up)
    [ "$#" -eq 0 ] || fail 'up does not accept extra arguments.'
    validate_compose
    if gateway_image=$(read_env_value SUBWEB_IMAGE); then
      :
    else
      status=$?
      [ "$status" -eq 1 ] || fail 'SUBWEB_IMAGE is duplicated in .env.'
      gateway_image=subweb:local
    fi
    if [ -z "$gateway_image" ] || [ "$gateway_image" = 'subweb:local' ]; then
      compose up -d --build --pull missing --remove-orphans --wait
    else
      compose up -d --no-build --pull never --remove-orphans --wait
    fi
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
    validate_compose
    compose ps
    ;;
  backup)
    [ "$short_links_enabled" = true ] || fail 'backup requires SHORT_LINKS_ENABLED=true.'
    compose ps --services --filter status=running | grep -qx redis \
      || fail 'Redis must be running before backup.'
    run_operation "$SCRIPT_DIRECTORY/operations/backup-redis.sh" "$@"
    ;;
  restore)
    [ "$short_links_enabled" = true ] || fail 'restore requires SHORT_LINKS_ENABLED=true.'
    [ "$#" -eq 3 ] && [ "$1" = --backup ] && [ "$3" = --confirm-stop-writes ] \
      || fail 'usage: subweb.sh restore --backup /absolute/path.rdb --confirm-stop-writes'
    case "$2" in
      /*) ;;
      *) fail 'restore backup must be an absolute path.' ;;
    esac
    [ -f "$2" ] && [ ! -L "$2" ] || fail 'restore backup must be a regular file and not a symlink.'
    run_operation "$SCRIPT_DIRECTORY/operations/restore-redis.sh" --backup "$2" --confirm-stop-writes
    ;;
  upgrade)
     [ "$#" -eq 0 ] || fail 'upgrade does not accept extra arguments.'
      version_lock_file=${VERSION_LOCK_FILE:-$PROJECT_DIRECTORY/deploy/versions.lock.json}
      acquire_path_lock "$version_lock_file" \
        || fail 'could not lock deploy/versions.lock.json for upgrade.'
     SUBWEB_VERSION_LOCK_DIRECTORY=$PATH_LOCK_DIRECTORY
     SUBWEB_VERSION_LOCK_TOKEN=$PATH_LOCK_TOKEN
     upgrade_env_file=$(mktemp "${TMPDIR:-/tmp}/subweb-upgrade-env.XXXXXX") \
       || fail 'unable to create an upgrade environment snapshot.'
     chmod 0600 "$upgrade_env_file" \
       || fail 'unable to protect the upgrade environment snapshot.'
     runtime_image_env=$(node "$SCRIPT_DIRECTORY/runtime-image-contract.mjs" env \
        --lock "$version_lock_file") \
       || fail 'unable to derive locked runtime images for upgrade.'
     awk '
       /^[[:space:]]*(export[[:space:]]+)?(REDIS_IMAGE|SUBCONVERTER_IMAGE|MYURLS_IMAGE)[[:space:]]*=/ { next }
       { print }
     ' "$ENV_FILE" > "$upgrade_env_file" \
       || fail 'unable to prepare the upgrade environment snapshot.'
     printf '%s\\n' "$runtime_image_env" >> "$upgrade_env_file" \
       || fail 'unable to write locked runtime images to the upgrade environment.'
     ENV_FILE=$upgrade_env_file
     export SUBWEB_ENV_FILE="$ENV_FILE"
      validate_compose
    if [ "$short_links_enabled" = true ]; then
      compose pull gateway subconverter myurls redis
    else
      compose pull gateway subconverter
    fi
    compose up -d --no-build --pull never --remove-orphans --wait
    # Docker seeds a named volume from the image only while that volume is
    # empty, so an upgraded SubConverter keeps the previous image's /base tree
    # unless the operator removes the volume. Fail the upgrade instead of
    # leaving a running container that silently uses stale preferences.
    if ! run_operation "$SCRIPT_DIRECTORY/verify-subconverter-runtime.sh"; then
      printf '\n%s\n' \
        'SubConverter upgrade is incomplete: the running container still serves the previous image /base content.' \
        'Stop the stack, remove the stale runtime volume, then start it again:' \
        "  docker compose -f $compose_file down" \
        '  docker volume rm subweb_subconverter-runtime   # <compose project>_subconverter-runtime' \
        '  ./scripts/subweb.sh up' >&2
      exit 1
    fi
    ;;
  *)
    fail "unknown command: $command_name"
    ;;
esac
