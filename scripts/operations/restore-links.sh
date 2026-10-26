#!/bin/sh
set -eu
umask 077

# shellcheck source=lib.sh
. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)/lib.sh"

backup=
confirmed=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup) [ "$#" -ge 2 ] || operations_fail '--backup requires a value.'; backup=$2; shift 2 ;;
    --confirm-stop-writes) confirmed=1; shift ;;
    *) operations_fail "unknown argument: $1" ;;
  esac
done

[ "$confirmed" -eq 1 ] || operations_fail '--confirm-stop-writes is required.'
[ -n "$backup" ] || operations_fail '--backup is required.'
require_absolute_regular_file "$backup" 'backup'
[ "$(head -c 16 "$backup" 2>/dev/null || true)" = 'SQLite format 3' ] \
  || operations_fail 'backup is not a SQLite database.'
require_docker

cd "$operations_project_root"
compose stop gateway >/dev/null 2>&1 || true

restore_status=0
compose run --rm --no-deps \
  -v "$backup":/backup/input:ro \
  gateway --restore-links \
  -db /data/links.db \
  -in /backup/input \
  --confirm-stop-writes || restore_status=$?

compose up -d --no-build --pull never --wait gateway >/dev/null \
  || operations_fail 'gateway did not become healthy after restore.'

[ "$restore_status" -eq 0 ] || operations_fail 'short-link restore failed; the previous database is still in place.'

printf 'Short-link database restored from %s.\n' "$backup"
