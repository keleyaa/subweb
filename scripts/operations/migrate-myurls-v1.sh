#!/bin/sh
set -eu
umask 077

# shellcheck source=lib.sh
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/lib.sh"

apply=0
confirmed=0
backup=
ttl_policy=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) apply=1; shift ;;
    --confirm-stop-writes) confirmed=1; shift ;;
    --backup) [ "$#" -ge 2 ] || operations_fail '--backup requires a value.'; backup=$2; shift 2 ;;
    --ttl-policy) [ "$#" -ge 2 ] || operations_fail '--ttl-policy requires a value.'; ttl_policy=$2; shift 2 ;;
    *) operations_fail "unknown argument: $1" ;;
  esac
done

case "$ttl_policy" in
  preserve|cap-90d) ;;
  *) operations_fail '--ttl-policy must be preserve or cap-90d.' ;;
esac
require_docker

if [ "$apply" -eq 0 ]; then
  printf 'migration_mode=dry-run ttl_policy=%s\n' "$ttl_policy"
  "$operations_script_directory/inventory-myurls-v1.sh"
  exit 0
fi

[ "$confirmed" -eq 1 ] || operations_fail '--confirm-stop-writes is required with --apply.'
[ -n "$backup" ] || operations_fail '--backup is required with --apply.'
case "$backup" in /*) ;; *) operations_fail '--backup must be an absolute path.' ;; esac
[ ! -e "$backup" ] && [ ! -L "$backup" ] || operations_fail 'backup output already exists.'
backup_directory=${backup%/*}
[ -n "$backup_directory" ] || backup_directory=/
require_private_directory "$backup_directory"

cd "$operations_project_root"
docker compose stop gateway myurls-app myurls-short >/dev/null \
  || operations_fail 'unable to stop short-link write entrypoints.'
writes_stopped=1
report_stopped() {
  if [ "$writes_stopped" -eq 1 ]; then
    printf '%s\n' 'Gateway and MyUrls remain stopped; inspect and recover before accepting writes.' >&2
  fi
}
trap report_stopped EXIT HUP INT TERM

"$operations_script_directory/backup-redis.sh" --output "$backup"
"$operations_script_directory/verify-redis-backup.sh" --backup "$backup"

metrics=$(docker compose exec -T -e TTL_POLICY="$ttl_policy" redis sh -eu -c '
  lua=$(cat)
  REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning --raw EVAL "$lua" 0 "$TTL_POLICY"
' <<'LUA'
local policy = ARGV[1]
local cursor = '0'
local scanned = 0
local candidates = 0
local migrated = 0
local conflicts = 0
local alreadyMigrated = 0
local invalidValues = 0
local missingExpiry = 0
local writeFailures = 0
local maxTtlMs = 7776000000

repeat
  local page = redis.call('SCAN', cursor, 'COUNT', 250)
  cursor = page[1]
  for _, key in ipairs(page[2]) do
    scanned = scanned + 1
    if string.sub(key, 1, 6) ~= 'myurl:' and #key >= 1 and #key <= 64
      and string.match(key, '^[A-Za-z0-9_-]+$') and redis.call('TYPE', key).ok == 'string' then
      candidates = candidates + 1
      local value = redis.call('GET', key)
      local prefix = string.lower(string.sub(value or '', 1, 8))
      local validScheme = string.sub(prefix, 1, 7) == 'http://' or prefix == 'https://'
      local hasUnsafeCharacter = value == false or string.find(value, '[%z\1-\31\127%s]') ~= nil
      if not validScheme or hasUnsafeCharacter then
        invalidValues = invalidValues + 1
      else
        local pttl = redis.call('PTTL', key)
        if pttl <= 0 then
          missingExpiry = missingExpiry + 1
        else
          local destination = 'myurl:link:' .. key
          if redis.call('EXISTS', destination) == 1 then
            if redis.call('GET', destination) == value then
              alreadyMigrated = alreadyMigrated + 1
            else
              conflicts = conflicts + 1
            end
          else
            if policy == 'cap-90d' and pttl > maxTtlMs then
              pttl = maxTtlMs
            end
            local result = redis.call('SET', destination, value, 'PX', pttl, 'NX')
            if result then
              migrated = migrated + 1
            else
              writeFailures = writeFailures + 1
            end
          end
        end
      end
    end
  end
until cursor == '0'

return { scanned, candidates, migrated, alreadyMigrated, conflicts, invalidValues, missingExpiry, writeFailures }
LUA
) || operations_fail 'Redis migration failed; writes remain stopped.'

set -- $metrics
[ "$#" -eq 8 ] || operations_fail 'migration returned an unexpected result; writes remain stopped.'
for metric in "$@"; do
  case "$metric" in ''|*[!0-9]*) operations_fail 'migration returned a non-numeric metric; writes remain stopped.' ;; esac
done
[ "$8" -eq 0 ] || operations_fail 'migration reported write failures; writes remain stopped.'

printf '%s\n' \
  "migration_mode=applied" \
  "ttl_policy=$ttl_policy" \
  "scanned_keys=$1" \
  "v1_candidate_keys=$2" \
  "migrated_keys=$3" \
  "already_migrated_keys=$4" \
  "destination_conflicts=$5" \
  "invalid_values_skipped=$6" \
  "missing_expiry_skipped=$7" \
  "write_failures=$8" \
  "backup=$backup" \
  'Gateway and MyUrls remain stopped. Validate the migration before running docker compose up -d --wait.'

[ "$5" -eq 0 ] || operations_fail 'migration found destination conflicts; writes remain stopped.'

writes_stopped=0
trap - EXIT HUP INT TERM
