#!/bin/sh
set -eu

script_directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
project_root=$(CDPATH='' cd -- "$script_directory/../.." && pwd -P)
# shellcheck source=../lib/path-lock.sh
. "$project_root/scripts/lib/path-lock.sh"

project_name=${SUBWEB_LOCAL_PROJECT_NAME:-${COMPOSE_PROJECT_NAME:-}}
case "$project_name" in
  ''|*[!a-z0-9_-]*)
    printf '%s\n' 'test network selection requires a safe Compose project name.' >&2
    exit 1
    ;;
esac

lock_target=${TMPDIR:-/tmp}/subweb-test-network-selection
acquire_path_lock "$lock_target" \
  || { printf '%s\n' 'unable to lock test network selection.' >&2; exit 1; }
selection_lock=$PATH_LOCK_DIRECTORY
cleanup() {
  cleanup_status=$?
  trap - 0 HUP INT TERM
  release_path_lock "$selection_lock" || cleanup_status=1
  exit "$cleanup_status"
}
trap cleanup 0 HUP INT TERM

network_name=${project_name}_myurls-edge
network_suffix=255
while [ "$network_suffix" -ge 240 ]; do
  subnet="172.30.$network_suffix.0/29"
  if docker network create \
    --driver bridge \
    --internal \
    --subnet "$subnet" \
    --label "com.docker.compose.project=$project_name" \
    --label 'com.docker.compose.network=myurls-edge' \
    "$network_name" >/dev/null 2>&1; then
    printf '%s\n' "$subnet"
    exit 0
  fi
  network_suffix=$((network_suffix - 1))
done

printf '%s\n' 'unable to allocate an isolated Docker test subnet.' >&2
exit 1
