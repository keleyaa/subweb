#!/bin/sh
set -eu
umask 077

for command in docker curl node openssl; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Missing command: %s\n' "$command" >&2; exit 1; }
done

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_directory/.." && pwd -P)
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/subweb-redis-operations.XXXXXX")
project_name=subweb-redis-operations-$(openssl rand -hex 6)
env_file=$temporary_directory/stack.env
backup_file=$temporary_directory/pre-migration.rdb
short_key=ops$(openssl rand -hex 6)
long_key=ops$(openssl rand -hex 6)
long_url=https://example.com/redis-migration-verification
host_port=$(node -e 'const n=require("node:net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')
password=$(openssl rand -hex 32)
ip_hash_secret=$(openssl rand -hex 32)

myurls_test_image=${MYURLS_IMAGE:-}
if [ -z "$myurls_test_image" ]; then
  node "$project_root/scripts/verify-version-locks.mjs" >/dev/null
  myurls_test_image=$(node - "$project_root/deploy/versions.lock.json" <<'NODE'
const fs = require('node:fs');
const image = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).services.myurls.image;
process.stdout.write(`${image.reference}@${image.digest}`);
NODE
  )
fi

cleanup() {
  COMPOSE_FILE=$project_root/compose.yaml:$project_root/compose.test.yaml \
  COMPOSE_ENV_FILES=$env_file COMPOSE_PROJECT_NAME=$project_name \
    docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$temporary_directory"
}
trap cleanup EXIT HUP INT TERM

{
  printf '%s\n' \
    'APP_DOMAIN=app.test' \
    'API_DOMAIN=api.app.test' \
    'API_URL=https://api.app.test' \
    'SHORT_DOMAIN=short.test' \
    "SUBWEB_PORT=$host_port" \
    "MYURLS_IMAGE=$myurls_test_image" \
    "REDIS_PASSWORD=$password" \
    "IP_HASH_SECRET=$ip_hash_secret" \
    'TURNSTILE_SITE_KEY=test-site-key' \
    'TURNSTILE_SECRET_KEY=test-secret-key'
  [ -z "${REDIS_IMAGE:-}" ] || printf 'REDIS_IMAGE=%s\n' "$REDIS_IMAGE"
  [ -z "${SUBCONVERTER_IMAGE:-}" ] || printf 'SUBCONVERTER_IMAGE=%s\n' "$SUBCONVERTER_IMAGE"
} > "$env_file"
chmod 0600 "$env_file"

export COMPOSE_FILE=$project_root/compose.yaml:$project_root/compose.test.yaml
export COMPOSE_ENV_FILES=$env_file
export COMPOSE_PROJECT_NAME=$project_name
export SUBWEB_OPERATIONS_RUNTIME_DIR=$temporary_directory/rollback

cd "$project_root"
docker compose up -d --build --wait >/dev/null
docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning SET "$1" "$2" EX 7200 >/dev/null' \
  sh "$short_key" "$long_url"
docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning SET "$1" "$2" PX 7779600000 >/dev/null' \
  sh "$long_key" "$long_url"

inventory=$("$script_directory/operations/inventory-myurls-v1.sh")
printf '%s\n' "$inventory" | grep -qx 'v1_candidate_keys=2'
printf '%s\n' "$inventory" | grep -qx 'destination_conflicts=0'
printf '%s\n' "$inventory" | grep -Fq "$short_key" && { printf '%s\n' 'Inventory leaked a key.' >&2; exit 1; }
printf '%s\n' "$inventory" | grep -Fq "$long_url" && { printf '%s\n' 'Inventory leaked a value.' >&2; exit 1; }

migration=$("$script_directory/operations/migrate-myurls-v1.sh" \
  --ttl-policy cap-90d --apply --confirm-stop-writes --backup "$backup_file")
printf '%s\n' "$migration" | grep -qx 'migrated_keys=2'
printf '%s\n' "$migration" | grep -qx 'destination_conflicts=0'
"$script_directory/operations/verify-redis-backup.sh" --backup "$backup_file" >/dev/null

old_exists=$(docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning EXISTS "$1"' sh "$short_key" | awk 'NF{print $1}')
new_ttl=$(docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning TTL "myurl:link:$1"' sh "$short_key" | awk 'NF{print $1}')
long_ttl=$(docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning TTL "myurl:link:$1"' sh "$long_key" | awk 'NF{print $1}')
[ "$old_exists" -eq 1 ] || { printf '%s\n' 'Migration removed the v1 key.' >&2; exit 1; }
[ "$new_ttl" -gt 0 ] && [ "$new_ttl" -le 7200 ] || { printf 'Unexpected migrated TTL: %s\n' "$new_ttl" >&2; exit 1; }
[ "$long_ttl" -gt 7775000 ] && [ "$long_ttl" -le 7776000 ] \
  || { printf 'cap-90d did not cap the long TTL: %s\n' "$long_ttl" >&2; exit 1; }

docker compose up -d --wait >/dev/null
headers=$temporary_directory/headers
curl --noproxy '*' --fail --silent --show-error -D "$headers" -o /dev/null \
  -H 'Host: short.test' "http://127.0.0.1:$host_port/$short_key"
grep -Fqi "Location: $long_url" "$headers" || { printf '%s\n' 'Migrated key did not redirect.' >&2; exit 1; }

docker compose stop gateway myurls-app myurls-short >/dev/null
docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning FLUSHDB >/dev/null'
"$script_directory/operations/restore-redis.sh" --backup "$backup_file" --confirm-stop-writes >/dev/null

restored_old=$(docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning EXISTS "$1"' sh "$short_key" | awk 'NF{print $1}')
restored_new=$(docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning EXISTS "myurl:link:$1"' sh "$short_key" | awk 'NF{print $1}')
restored_long=$(docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning EXISTS "$1"' sh "$long_key" | awk 'NF{print $1}')
restored_long_new=$(docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning EXISTS "myurl:link:$1"' sh "$long_key" | awk 'NF{print $1}')
[ "$restored_old" -eq 1 ] && [ "$restored_new" -eq 0 ] \
  && [ "$restored_long" -eq 1 ] && [ "$restored_long_new" -eq 0 ] \
  || { printf '%s\n' 'Restore did not return to the pre-migration snapshot.' >&2; exit 1; }

printf '%s\n' 'Redis inventory, migration, redirect, backup, and restore verification passed.'
