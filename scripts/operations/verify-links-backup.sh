#!/bin/sh
set -eu
umask 077

# shellcheck source=lib.sh
. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)/lib.sh"

backup=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup) [ "$#" -ge 2 ] || operations_fail '--backup requires a value.'; backup=$2; shift 2 ;;
    *) operations_fail "unknown argument: $1" ;;
  esac
done

[ -n "$backup" ] || operations_fail '--backup is required.'
require_absolute_regular_file "$backup" 'backup'
[ "$(head -c 16 "$backup" 2>/dev/null || true)" = 'SQLite format 3' ] \
  || operations_fail 'backup is not a SQLite short-link database.'
require_docker

cd "$operations_project_root"
compose run --rm --no-deps \
  -v "$backup":/backup/input:ro \
  gateway --verify-links \
  -db /backup/input >/dev/null \
  || operations_fail 'short-link database integrity verification failed.'

printf 'Short-link backup verified.\n'
