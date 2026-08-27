#!/bin/sh
set -eu

# shellcheck source=lib.sh
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/lib.sh"

[ "$#" -eq 0 ] || operations_fail 'inventory-myurls-v1.sh does not accept arguments.'
require_docker
cd "$operations_project_root"

metrics=$(docker compose exec -T redis sh -eu -c '
  lua=$(cat)
  REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning --raw EVAL "$lua" 0
' <<'LUA'
local cursor = '0'
local total = 0
local oldCandidates = 0
local oldNoExpiry = 0
local oldUpTo90Days = 0
local oldOver90Days = 0
local destinationConflicts = 0
local v2Links = 0
local otherNamespaced = 0

repeat
  local page = redis.call('SCAN', cursor, 'COUNT', 500)
  cursor = page[1]
  for _, key in ipairs(page[2]) do
    total = total + 1
    if string.sub(key, 1, 11) == 'myurl:link:' then
      v2Links = v2Links + 1
    elseif string.sub(key, 1, 6) == 'myurl:' then
      otherNamespaced = otherNamespaced + 1
    elseif #key >= 1 and #key <= 64 and string.match(key, '^[A-Za-z0-9_-]+$') then
      local keyType = redis.call('TYPE', key).ok
      if keyType == 'string' then
        oldCandidates = oldCandidates + 1
        local pttl = redis.call('PTTL', key)
        if pttl == -1 then
          oldNoExpiry = oldNoExpiry + 1
        elseif pttl > 7776000000 then
          oldOver90Days = oldOver90Days + 1
        elseif pttl > 0 then
          oldUpTo90Days = oldUpTo90Days + 1
        end
        if redis.call('EXISTS', 'myurl:link:' .. key) == 1 then
          destinationConflicts = destinationConflicts + 1
        end
      end
    end
  end
until cursor == '0'

return {
  total,
  oldCandidates,
  oldNoExpiry,
  oldUpTo90Days,
  oldOver90Days,
  destinationConflicts,
  v2Links,
  otherNamespaced
}
LUA
) || operations_fail 'unable to inventory Redis.'

set -- $metrics
[ "$#" -eq 8 ] || operations_fail 'inventory returned an unexpected result.'
for metric in "$@"; do
  case "$metric" in ''|*[!0-9]*) operations_fail 'inventory returned a non-numeric metric.' ;; esac
done

printf '%s\n' \
  "redis_total_keys=$1" \
  "v1_candidate_keys=$2" \
  "v1_without_expiry=$3" \
  "v1_ttl_up_to_90_days=$4" \
  "v1_ttl_over_90_days=$5" \
  "destination_conflicts=$6" \
  "v2_link_keys=$7" \
  "other_myurl_namespaced_keys=$8"
