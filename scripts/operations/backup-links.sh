#!/bin/sh
set -eu
umask 077

# shellcheck source=lib.sh
. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)/lib.sh"

output=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) [ "$#" -ge 2 ] || operations_fail '--output requires a value.'; output=$2; shift 2 ;;
    *) operations_fail "unknown argument: $1" ;;
  esac
done

[ -n "$output" ] || operations_fail '--output is required.'
case "$output" in /*) ;; *) operations_fail 'output must be an absolute path.' ;; esac
output_directory=$(dirname -- "$output")
[ -d "$output_directory" ] && [ ! -L "$output_directory" ] \
  || operations_fail 'output directory must exist and not be a symlink.'
require_docker

snapshot_name=$(basename -- "$output")
cd "$operations_project_root"
compose run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  -v "$output_directory":/backup \
  gateway --backup-links \
  -db /data/links.db \
  -out "/backup/$snapshot_name" >/dev/null

[ -s "$output" ] || operations_fail 'backup snapshot was not written.'
[ "$(head -c 16 "$output" 2>/dev/null || true)" = 'SQLite format 3' ] \
  || operations_fail 'backup snapshot is not a SQLite database.'

printf 'Short-link backup written to %s.\n' "$output"
