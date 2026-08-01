#!/bin/sh
set -eu

# shellcheck source=lib.sh
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/lib.sh"

backup=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup) [ "$#" -ge 2 ] || operations_fail '--backup requires a value.'; backup=$2; shift 2 ;;
    *) operations_fail "unknown argument: $1" ;;
  esac
done

[ -n "$backup" ] || operations_fail '--backup is required.'
require_absolute_regular_file "$backup" 'backup'
require_docker
image=$(redis_image_reference)

docker run --rm --read-only --network none \
  --mount "type=bind,src=$backup,dst=/backup.rdb,readonly" \
  --entrypoint redis-check-rdb "$image" /backup.rdb >/dev/null \
  || operations_fail 'Redis backup validation failed.'

key_count=$(docker run --rm --read-only --network none \
  --tmpfs /data:uid=999,gid=1000,mode=0700 \
  --tmpfs /tmp:uid=999,gid=1000,mode=0700 \
  --mount "type=bind,src=$backup,dst=/backup.rdb,readonly" \
  --entrypoint sh "$image" -eu -c '
    cp /backup.rdb /data/dump.rdb
    redis-server --daemonize yes --port 0 --unixsocket /tmp/redis.sock \
      --dir /data --dbfilename dump.rdb --appendonly no --protected-mode no
    attempts=0
    until redis-cli -s /tmp/redis.sock ping >/dev/null 2>&1; do
      attempts=$((attempts + 1))
      [ "$attempts" -lt 50 ] || exit 1
    done
    redis-cli -s /tmp/redis.sock --raw DBSIZE
  ') || operations_fail 'Redis backup could not be loaded in an isolated process.'
case "$key_count" in ''|*[!0-9]*) operations_fail 'Redis backup returned an invalid key count.' ;; esac

printf 'Redis backup verified: %s keys=%s sha256=%s\n' "$backup" "$key_count" "$(sha256_file "$backup")"
