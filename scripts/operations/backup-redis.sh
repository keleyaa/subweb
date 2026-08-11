#!/bin/sh
set -eu
umask 077

# shellcheck source=lib.sh
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/lib.sh"

output=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) [ "$#" -ge 2 ] || operations_fail '--output requires a value.'; output=$2; shift 2 ;;
    *) operations_fail "unknown argument: $1" ;;
  esac
done

[ -n "$output" ] || operations_fail '--output is required.'
case "$output" in /*) ;; *) operations_fail '--output must be an absolute path.' ;; esac
[ ! -e "$output" ] && [ ! -L "$output" ] || operations_fail 'output already exists.'
output_directory=${output%/*}
[ -n "$output_directory" ] || output_directory=/
require_private_directory "$output_directory"
require_docker

cd "$operations_project_root"
redis_id=$(docker compose ps -q redis) || operations_fail 'unable to resolve the Redis container.'
[ -n "$redis_id" ] || operations_fail 'Redis is not running.'
health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$redis_id") \
  || operations_fail 'unable to inspect Redis health.'
[ "$health" = healthy ] || operations_fail 'Redis must be healthy before backup.'

temporary="$output.tmp.$$"
trap 'rm -f "$temporary"' EXIT HUP INT TERM
save_result=$(docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning --raw SAVE') \
  || operations_fail 'Redis SAVE failed.'
[ "$save_result" = OK ] || operations_fail 'Redis SAVE did not return OK.'
docker compose cp redis:/data/dump.rdb "$temporary" >/dev/null \
  || operations_fail 'unable to copy Redis snapshot.'
[ -s "$temporary" ] || operations_fail 'Redis snapshot is empty.'
chmod 0600 "$temporary"
mv "$temporary" "$output"
trap - EXIT HUP INT TERM

printf 'Redis backup created: %s sha256=%s\n' "$output" "$(sha256_file "$output")"
