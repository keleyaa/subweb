#!/bin/sh
set -eu

# shellcheck source=common.sh
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/common.sh"

[ "$#" -eq 1 ] || local_fail 'usage: deps.sh up|status|down'
prepare_local_environment
cd "$local_project_root"

case "$1" in
  up)
    docker compose up -d --build --remove-orphans --wait gateway subconverter myurls-app myurls-short redis
    ;;
  status)
    docker compose ps gateway subconverter myurls-app myurls-short redis
    curl --connect-timeout 5 --max-time 15 --fail --silent --show-error "http://127.0.0.1:$local_myurls_port/health/live" >/dev/null \
      || local_fail 'MyUrls short-link service is not ready.'
    curl --connect-timeout 5 --max-time 15 --fail --silent --show-error \
      --header 'Host: app.local.test' "http://127.0.0.1:$local_subweb_port/healthz" >/dev/null \
      || local_fail 'Gateway is not ready.'
    printf '%s\n' 'Local dependencies are ready.'
    ;;
  down)
    docker compose stop gateway subconverter myurls-app myurls-short redis
    ;;
  *) local_fail 'usage: deps.sh up|status|down' ;;
esac
