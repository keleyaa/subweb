#!/bin/sh
set -eu

# shellcheck source=common.sh
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/common.sh"

[ "$#" -eq 1 ] || local_fail 'usage: deps.sh up|status|down'
prepare_local_environment
cd "$local_project_root"

case "$1" in
  up)
    docker compose up -d --wait redis myurls-app myurls-short subconverter
    ;;
  status)
    docker compose ps redis myurls-app myurls-short subconverter
    curl --fail --silent --show-error "http://127.0.0.1:$local_myurls_port/health/ready" >/dev/null \
      || local_fail 'APP MyUrls is not ready.'
    curl --fail --silent --show-error "http://127.0.0.1:$local_short_myurls_port/health/ready" >/dev/null \
      || local_fail 'SHORT MyUrls is not ready.'
    curl --fail --silent --show-error "http://127.0.0.1:$local_subconverter_port/healthz" >/dev/null \
      || local_fail 'SubConverter is not ready.'
    printf '%s\n' 'Local dependencies are ready.'
    ;;
  down)
    docker compose stop myurls-app myurls-short subconverter redis
    ;;
  *) local_fail 'usage: deps.sh up|status|down' ;;
esac
