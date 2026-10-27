#!/bin/sh
set -eu

# shellcheck source=common.sh
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/common.sh"

[ "$#" -eq 1 ] || local_fail 'usage: deps.sh up|status|down|remove|remove-volumes'
prepare_local_environment
cd "$local_project_root"

case "$1" in
  up)
    docker compose --env-file "$local_env_file" up -d --build --remove-orphans --wait gateway subconverter
    ;;
  remove)
    docker compose --env-file "$local_env_file" down --remove-orphans
    ;;
  remove-volumes)
    case "$local_project_name" in
      subweb-local-verify-*) ;;
      *) local_fail 'remove-volumes is restricted to verifier-owned projects.' ;;
    esac
    docker compose --env-file "$local_env_file" down --volumes --remove-orphans
    ;;
  status)
    docker compose --env-file "$local_env_file" ps gateway subconverter
    curl --connect-timeout 5 --max-time 15 --fail --silent --show-error \
      --header 'Host: app.local.test' "http://127.0.0.1:$local_subweb_port/healthz" >/dev/null \
      || local_fail 'Gateway is not ready.'
    printf '%s\n' 'Local dependencies are ready.'
    ;;
  down)
    docker compose --env-file "$local_env_file" stop gateway subconverter
    ;;
  *) local_fail 'usage: deps.sh up|status|down|remove|remove-volumes' ;;
esac
