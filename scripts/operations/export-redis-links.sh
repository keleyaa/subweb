#!/bin/sh
set -eu
umask 077

# shellcheck source=lib.sh
. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)/lib.sh"

# Export short links from a still-running pre-upgrade Redis service.
# Output is tab-separated: code, url, expiresAt (unix seconds, 0 = never).
container=$(docker ps --quiet --filter 'label=com.docker.compose.service=redis' | head -n 1)
[ -n "$container" ] || operations_fail 'no running Redis service was found; run this before removing the legacy stack.'

docker exec -i "$container" sh -eu -c '
  export REDISCLI_AUTH="$REDIS_PASSWORD"
  redis-cli --scan --pattern "myurl:link:*" | while IFS= read -r key; do
    [ -n "$key" ] || continue
    code=${key#myurl:link:}
    url=$(redis-cli --raw GET "$key") || continue
    ttl=$(redis-cli --raw TTL "$key") || continue
    case "$ttl" in
      -1) expires=0 ;;
      -2) continue ;;
      *) expires=$(( $(date +%s) + ttl )) ;;
    esac
    printf "%s\t%s\t%s\n" "$code" "$url" "$expires"
  done
'
