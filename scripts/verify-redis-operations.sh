#!/bin/sh
set -eu
umask 077

for command in docker curl node openssl; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Missing command: %s\n' "$command" >&2
    exit 1
  }
done

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_directory/.." && pwd -P)

# This verifier owns every variable in its temporary Compose environment.
unset \
  APP_DOMAIN API_DOMAIN API_URL SHORT_DOMAIN \
  SHORT_LINKS_ENABLED CUSTOM_BACKEND_ENABLED \
  CONVERSION_RATE_LIMIT CONVERSION_RATE_WINDOW_SECONDS \
  SUBWEB_PORT MYURLS_NETWORK_SUBNET MYURLS_GATEWAY_IP MYURLS_APP_IP MYURLS_SHORT_IP MYURLS_TRUST_PROXY_CIDR \
  REDIS_PASSWORD IP_HASH_SECRET TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY \
  MYURLS_IMAGE REDIS_IMAGE SUBCONVERTER_IMAGE

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/subweb-unified-operations.XXXXXX")
project_name=subweb-unified-operations-$(openssl rand -hex 6)
compose_files=$project_root/compose.yaml:$project_root/compose.test.yaml
env_file=$temporary_directory/stack.env
backup_file=$temporary_directory/short-links.rdb
short_key=ops$(openssl rand -hex 6)
short_url=https://example.com/unified-recovery
host_port=$(node -e 'const n=require("node:net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')
password=$(openssl rand -hex 32)
ip_hash_secret=$(openssl rand -hex 32)
test_network_subnet=$("$script_directory/select-test-network.sh")
test_network_prefix=${test_network_subnet%.*}
test_gateway_ip=$test_network_prefix.2
test_app_ip=$test_network_prefix.3
test_short_ip=$test_network_prefix.4

node "$project_root/scripts/verify-version-locks.mjs" >/dev/null
myurls_image=$(node - "$project_root/deploy/versions.lock.json" <<'NODE'
const fs = require('node:fs');
const lock = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const service of ['myurls', 'redis', 'subconverter']) {
  const image = lock.services[service]?.image;
  if (!image?.reference || !/^sha256:[0-9a-f]{64}$/u.test(image.digest ?? '')) process.exit(1);
  process.stdout.write(`${service.toUpperCase()}_IMAGE=${image.reference}@${image.digest}\n`);
}
NODE
) || {
  printf '%s\n' 'Unable to read locked operation images.' >&2
  exit 1
}

cleanup() {
  COMPOSE_FILE=$compose_files COMPOSE_ENV_FILES=$env_file COMPOSE_PROJECT_NAME=$project_name \
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
    'SHORT_LINKS_ENABLED=true' \
    'CUSTOM_BACKEND_ENABLED=true' \
    "SUBWEB_PORT=$host_port" \
    "MYURLS_NETWORK_SUBNET=$test_network_subnet" \
    "MYURLS_GATEWAY_IP=$test_gateway_ip" \
    "MYURLS_APP_IP=$test_app_ip" \
    "MYURLS_SHORT_IP=$test_short_ip" \
    "MYURLS_TRUST_PROXY_CIDR=$test_gateway_ip/32" \
    "REDIS_PASSWORD=$password" \
    "IP_HASH_SECRET=$ip_hash_secret" \
    'TURNSTILE_SITE_KEY=test-site-key' \
    'TURNSTILE_SECRET_KEY=test-secret-key'
  printf '%s\n' "$myurls_image"
} > "$env_file"
chmod 0600 "$env_file"

export COMPOSE_FILE=$compose_files
export COMPOSE_ENV_FILES=$env_file
export COMPOSE_PROJECT_NAME=$project_name
export SUBWEB_OPERATIONS_RUNTIME_DIR=$temporary_directory/rollback

cd "$project_root"
docker compose up -d --build --wait >/dev/null

gateway_ready() {
  curl --noproxy '*' --fail --silent --show-error \
    -H 'Host: api.app.test' "http://127.0.0.1:$host_port/readyz" >/dev/null
}

short_resolves() {
  headers=$temporary_directory/headers
  curl --noproxy '*' --fail --silent --show-error -D "$headers" -o /dev/null \
    -H 'Host: short.test' "http://127.0.0.1:$host_port/$short_key"
  grep -Fqi "Location: $short_url" "$headers"
}

subconverter_runs_as_101() {
  docker compose exec -T subconverter sh -eu -c \
    'awk '\''$1 == "Uid:" && $2 == 101 { uid = 1 } $1 == "CapEff:" && $2 == "0000000000000000" { caps = 1 } END { exit uid && caps ? 0 : 1 }'\'' /proc/1/status'
}

wait_for_stack() {
  docker compose up -d --wait >/dev/null
  gateway_ready
  short_resolves
  subconverter_runs_as_101
}

docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning SET "myurl:link:$1" "$2" EX 7200 >/dev/null' \
  sh "$short_key" "$short_url"
short_resolves
"$script_directory/operations/backup-redis.sh" --output "$backup_file" >/dev/null
"$script_directory/operations/verify-redis-backup.sh" --backup "$backup_file" >/dev/null

docker compose stop gateway myurls-app myurls-short >/dev/null
docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning FLUSHDB >/dev/null'
"$script_directory/operations/restore-redis.sh" --backup "$backup_file" --confirm-stop-writes >/dev/null
short_resolves

docker compose restart redis >/dev/null
wait_for_stack

docker compose restart gateway >/dev/null
wait_for_stack

docker compose restart subconverter >/dev/null
wait_for_stack
docker compose ps --services --filter status=running | grep -qx subconverter

printf '%s\n' 'Unified Redis backup, restore, and service recovery verification passed.'
