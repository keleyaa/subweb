#!/bin/sh
set -eu
umask 077

for command in docker curl node openssl grep; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Missing command: %s\n' "$command" >&2
    exit 1
  }
done

script_directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
project_root=$(CDPATH='' cd -- "$script_directory/.." && pwd -P)
version_lock_file=$project_root/deploy/versions.lock.json

# This verifier owns every variable in its temporary Compose environment.
unset \
  APP_DOMAIN API_DOMAIN API_URL SHORT_DOMAIN \
  SHORT_LINKS_ENABLED CUSTOM_BACKEND_ENABLED TURNSTILE_ENABLED \
  CONVERSION_RATE_LIMIT CONVERSION_RATE_WINDOW_SECONDS \
  SUBWEB_PORT IP_HASH_SECRET TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY \
  SHORT_LINK_DB_PATH SHORT_LINK_TTL_SECONDS SUBCONVERTER_IMAGE

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/subweb-unified-smoke.XXXXXX")
project_name=subweb-unified-smoke-$(openssl rand -hex 6)
compose_files=$project_root/compose.yaml:$project_root/compose.test.yaml
env_file=$temporary_directory/stack.env
host_port=$(node -e 'const n=require("node:net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')
ip_hash_secret=$(openssl rand -hex 32)

cleanup() {
  COMPOSE_FILE=$compose_files COMPOSE_ENV_FILES=$env_file COMPOSE_PROJECT_NAME=$project_name \
    docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$temporary_directory"
}
trap cleanup EXIT HUP INT TERM

fail() {
  printf 'Unified stack verification failed: %s\n' "$1" >&2
  exit 1
}

node "$project_root/scripts/verify-version-locks.mjs" "$version_lock_file" >/dev/null
locked_images=$(node "$project_root/scripts/runtime-image-contract.mjs" env --lock "$version_lock_file") \
  || fail 'unable to read locked production images.'

{
  printf '%s\n' \
    'APP_DOMAIN=app.test' \
    'API_DOMAIN=api.app.test' \
    'API_URL=https://api.app.test' \
    'SHORT_DOMAIN=short.test' \
    'SHORT_LINKS_ENABLED=true' \
    'CUSTOM_BACKEND_ENABLED=true' \
    'TURNSTILE_ENABLED=false' \
    'TURNSTILE_SITE_KEY=smoke-site-key' \
    'TURNSTILE_SECRET_KEY=smoke-secret-key' \
    'SHORT_LINK_TTL_SECONDS=60' \
    'CONVERSION_RATE_LIMIT=1' \
    'CONVERSION_RATE_WINDOW_SECONDS=60' \
    "SUBWEB_PORT=$host_port" \
    "IP_HASH_SECRET=$ip_hash_secret"
  printf '%s\n' "$locked_images"
} > "$env_file"
chmod 0600 "$env_file"

export COMPOSE_FILE="$compose_files"
export COMPOSE_ENV_FILES="$env_file"
export COMPOSE_PROJECT_NAME="$project_name"

request() {
  host=$1
  method=$2
  path=$3
  shift 3
  curl --connect-timeout 5 --max-time 20 --silent --output "$temporary_directory/body" \
    --write-out '%{http_code}' \
    --header "Host: $host" \
    --request "$method" \
    "http://127.0.0.1:$host_port$path" "$@"
}

assert_status() {
  actual=$1
  expected=$2
  label=$3
  [ "$actual" = "$expected" ] || fail "$label returned $actual, expected $expected."
}

assert_services_healthy() {
  docker compose ps --status running --services | sort > "$temporary_directory/services"
  printf '%s\n' gateway subconverter | sort > "$temporary_directory/expected-services"
  cmp -s "$temporary_directory/services" "$temporary_directory/expected-services" \
    || fail 'unexpected service inventory or unhealthy service.'
}

printf '%s\n' 'unified stack: starting'
docker compose up -d --build --remove-orphans --wait >/dev/null
assert_services_healthy

printf '%s\n' 'unified stack: routing'
assert_status "$(request app.test GET /healthz)" 200 'gateway health check'
assert_status "$(request app.test GET /)" 200 'application shell'
assert_status "$(request api.app.test GET /healthz)" 200 'API host health check'
assert_status "$(request app.test GET /no-such-route)" 404 'unknown route'

printf '%s\n' 'unified stack: short links'
created=$(request app.test POST /short-api/links \
  --header 'Content-Type: application/json' \
  --data '{"url":"https://example.com/unified-smoke"}')
assert_status "$created" 201 'short-link create'
short_code=$(node -e '
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (typeof payload.code !== "string" || typeof payload.shortUrl !== "string") process.exit(1);
if (payload.shortUrl !== "https://short.test/" + payload.code) process.exit(1);
process.stdout.write(payload.code);
' "$temporary_directory/body") || fail 'short-link create response is invalid.'

assert_status "$(request short.test GET "/$short_code")" 302 'short-link resolve'

printf '%s\n' 'unified stack: restart persistence'
docker compose restart gateway >/dev/null
docker compose up -d --wait >/dev/null
assert_services_healthy
assert_status "$(request short.test GET "/$short_code")" 302 'short-link after gateway restart'

printf '%s\n' 'unified stack: expiry'
sleep 61
assert_status "$(request short.test GET "/$short_code")" 404 'short-link expiry'

printf '%s\n' 'unified stack: secret hygiene'
if docker compose logs --no-log-prefix gateway 2>/dev/null | grep -q "$ip_hash_secret"; then
  fail 'gateway logs exposed the IP hash secret.'
fi

printf '%s\n' 'unified stack: disabled profile'
docker compose down --volumes --remove-orphans >/dev/null
compose_files=$project_root/compose.disabled-short-links.yaml
env_file=$temporary_directory/disabled.env
project_name=subweb-unified-disabled-$(openssl rand -hex 6)
{
  printf '%s\n' \
    'APP_DOMAIN=app.test' \
    'API_DOMAIN=api.app.test' \
    'API_URL=https://api.app.test' \
    "SUBWEB_PORT=$host_port"
  printf '%s\n' "$locked_images"
} > "$env_file"
chmod 0600 "$env_file"
export COMPOSE_FILE="$compose_files"
export COMPOSE_ENV_FILES="$env_file"
export COMPOSE_PROJECT_NAME="$project_name"

docker compose up -d --build --remove-orphans --wait >/dev/null
assert_services_healthy
assert_status "$(request app.test GET /healthz)" 200 'disabled profile health check'
assert_status "$(request app.test GET /short-api/links)" 404 'disabled profile short-link route'

docker compose down --volumes --remove-orphans >/dev/null
printf '%s\n' 'Unified production stack verification passed.'
