#!/bin/sh

operations_script_directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
operations_project_root=$(CDPATH='' cd -- "$operations_script_directory/../.." && pwd -P)
. "$operations_project_root/scripts/lib/docker-environment.sh"

operations_fail() {
  printf 'Operation error: %s\n' "$1" >&2
  exit 1
}

require_docker() {
  command -v docker >/dev/null 2>&1 || operations_fail 'docker is required.'
}

compose() {
  if [ -n "${SUBWEB_ENV_FILE:-}" ]; then
    run_docker_environment docker compose --env-file "$SUBWEB_ENV_FILE" "$@"
  else
    run_docker_environment docker compose "$@"
  fi
}

require_absolute_regular_file() {
  case "$1" in /*) ;; *) operations_fail "$2 must be an absolute path." ;; esac
  [ -f "$1" ] && [ ! -L "$1" ] || operations_fail "$2 must be a regular file and not a symlink."
}

directory_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

require_private_directory() {
  [ -d "$1" ] && [ ! -L "$1" ] || operations_fail 'output directory must exist and not be a symlink.'
  mode=$(directory_mode "$1") || operations_fail 'unable to inspect output directory permissions.'
  mode_value=$((0$mode))
  [ $((mode_value & 077)) -eq 0 ] || operations_fail 'output directory must not grant group or other permissions.'
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}
