#!/bin/sh
set -eu
umask 077

for command in docker curl node openssl grep; do
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

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/subweb-unified-smoke.XXXXXX")
project_name=subweb-unified-smoke-$(openssl rand -hex 6)
compose_files=$project_root/compose.yaml:$project_root/compose.test.yaml
env_file=$temporary_directory/stack.env
host_port=$(node -e 'const n=require("node:net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')
password=$(openssl rand -hex 32)
ip_hash_secret=$(openssl rand -hex 32)
test_network_subnet=$("$script_directory/select-test-network.sh")
test_network_prefix=${test_network_subnet%.*}
test_gateway_ip=$test_network_prefix.2
test_app_ip=$test_network_prefix.3
test_short_ip=$test_network_prefix.4
request_headers=$temporary_directory/headers
request_body=$temporary_directory/body

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

node "$project_root/scripts/verify-version-locks.mjs" >/dev/null
locked_images=$(node - "$project_root/deploy/versions.lock.json" <<'NODE'
const fs = require('node:fs');
const lock = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const service of ['myurls', 'redis', 'subconverter']) {
  const image = lock.services[service]?.image;
  if (!image?.reference || !/^sha256:[0-9a-f]{64}$/u.test(image.digest ?? '')) process.exit(1);
  process.stdout.write(`${service.toUpperCase()}_IMAGE=${image.reference}@${image.digest}\n`);
}
NODE
) || fail 'unable to read locked production images.'

{
  printf '%s\n' \
    'APP_DOMAIN=app.test' \
    'API_DOMAIN=api.app.test' \
    'API_URL=https://api.app.test' \
    'SHORT_DOMAIN=short.test' \
    'SHORT_LINKS_ENABLED=true' \
    'CUSTOM_BACKEND_ENABLED=true' \
    'CONVERSION_RATE_LIMIT=1' \
    'CONVERSION_RATE_WINDOW_SECONDS=60' \
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
  printf '%s\n' "$locked_images"
} > "$env_file"
chmod 0600 "$env_file"

export COMPOSE_FILE=$compose_files
export COMPOSE_ENV_FILES=$env_file
export COMPOSE_PROJECT_NAME=$project_name

cd "$project_root"
docker compose up -d --build --wait >/dev/null

request() {
  request_host=$1
  request_method=$2
  request_path=$3
  request_data=${4-}
  request_headers=$temporary_directory/headers
  request_body=$temporary_directory/body
  rm -f "$request_headers" "$request_body"
  if [ -n "$request_data" ]; then
    curl --noproxy '*' --silent --show-error -D "$request_headers" -o "$request_body" \
      -X "$request_method" -H "Host: $request_host" -H 'Content-Type: application/json' \
      --data "$request_data" -w '%{http_code}' "http://127.0.0.1:$host_port$request_path"
  else
    curl --noproxy '*' --silent --show-error -D "$request_headers" -o "$request_body" \
      -X "$request_method" -H "Host: $request_host" -w '%{http_code}' \
      "http://127.0.0.1:$host_port$request_path"
  fi
}

assert_status() {
  actual=$1
  expected=$2
  description=$3
  [ "$actual" = "$expected" ] || fail "$description: expected HTTP $expected, got $actual"
}

assert_header() {
  name=$1
  value=$2
  awk -v name="$name" -v expected="$value" '
    index($0, ":") == 0 { next }
    { header_name = $0; sub(/:.*/, "", header_name); header_value = $0; sub(/^[^:]*:[[:space:]]*/, "", header_value); sub(/\r$/, "", header_value) }
    tolower(header_name) == tolower(name) && header_value == expected { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$request_headers" || fail "missing $name header with value $value"
}

assert_header_matches() {
  name=$1
  pattern=$2
  awk -v name="$name" -v pattern="$pattern" '
    index($0, ":") == 0 { next }
    { header_name = $0; sub(/:.*/, "", header_name); header_value = $0; sub(/^[^:]*:[[:space:]]*/, "", header_value); sub(/\r$/, "", header_value) }
    tolower(header_name) == tolower(name) && header_value ~ pattern { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$request_headers" || fail "missing $name header matching $pattern"
}

assert_problem_code() {
  expected=$1
  node - "$request_body" "$expected" <<'NODE'
const fs = require('node:fs');
const [bodyPath, expected] = process.argv.slice(2);
try {
  const problem = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));
  process.exit(problem.code === expected ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

assert_fixture_headers_cleared() {
  node - "$request_body" <<'NODE'
const fs = require('node:fs');
try {
  const headers = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  process.exit(Object.values(headers).every((value) => value === '') ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

assert_runtime_config() {
  expected_short=$1
  expected_custom=$2
  node - "$request_body" "$expected_short" "$expected_custom" <<'NODE'
const fs = require('node:fs');
const [bodyPath, expectedShort, expectedCustom] = process.argv.slice(2);
const source = fs.readFileSync(bodyPath, 'utf8');
const context = {};
new Function('window', source)(context);
const config = context.__SUBWEB_CONFIG__;
if (!config || context.config !== config || config.shortLinksEnabled !== (expectedShort === 'true') || config.customBackendEnabled !== (expectedCustom === 'true')) process.exit(1);
for (const forbidden of ['redis', 'password', 'secret', 'myurls', 'subconverter']) {
  if (JSON.stringify(config).toLowerCase().includes(forbidden)) process.exit(1);
}
NODE
}

assert_gateway_security() {
  gateway_id=$(docker compose ps -q gateway)
  [ -n "$gateway_id" ] || fail 'gateway container is missing.'
  docker inspect --format '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}} {{json .HostConfig.CapDrop}} {{json .HostConfig.SecurityOpt}}' "$gateway_id" \
    | grep -Fq '65532:65532 true ["ALL"] ["no-new-privileges:true"]' \
    || fail 'gateway runtime security settings differ from the Compose contract.'
}

assert_services_healthy() {
  for service in gateway redis myurls-app myurls-short subconverter; do
    id=$(docker compose ps -q "$service")
    [ -n "$id" ] || fail "$service container is missing."
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$id") \
      || fail "unable to inspect $service health."
    [ "$health" = healthy ] || fail "$service is not healthy."
  done
}

assert_fixture_services_healthy() {
  for service in gateway subconverter; do
    id=$(docker compose ps -q "$service")
    [ -n "$id" ] || fail "$service fixture container is missing."
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$id") \
      || fail "unable to inspect $service fixture health."
    [ "$health" = healthy ] || fail "$service fixture is not healthy."
  done
}

assert_no_sensitive_logs() {
  marker=private-header-$(openssl rand -hex 8)
  status=$(curl --noproxy '*' --silent --show-error -D "$request_headers" -o "$request_body" \
    -H 'Host: app.test' -H "Authorization: Bearer $marker" -H "Cookie: session=$marker" \
    -H "X-Forwarded-For: $marker" -H "X-Request-ID: $marker" \
    -w '%{http_code}' "http://127.0.0.1:$host_port/")
  assert_status "$status" 200 'privacy probe'
  for service in gateway myurls-app myurls-short subconverter; do
    if docker compose logs --no-log-prefix "$service" | grep -Fq "$marker"; then
      fail "$service logged sensitive request data."
    fi
  done
}

assert_services_healthy
assert_gateway_security

status=$(request app.test GET /)
assert_status "$status" 200 'APP root'
assert_header Content-Type 'text/html; charset=utf-8'

grep -Eo '/assets/[^" ]+\.(css|js)' "$request_body" | sort -u > "$temporary_directory/assets"
[ -s "$temporary_directory/assets" ] || fail 'APP HTML did not reference built assets.'
while IFS= read -r asset; do
  status=$(request app.test GET "$asset")
  assert_status "$status" 200 "asset $asset"
  assert_header Cache-Control 'public, max-age=31536000, immutable'
done < "$temporary_directory/assets"

for entry in \
  '/favicon.svg:image/svg+xml' \
  '/apple-touch-icon.png:image/png' \
  '/icon-192.png:image/png' \
  '/icon-512.png:image/png' \
  '/site.webmanifest:application/manifest+json' \
  '/robots.txt:text/plain; charset=utf-8' \
  '/sitemap.xml:application/xml'; do
  path=${entry%%:*}
  content_type=${entry#*:}
  status=$(request app.test GET "$path")
  assert_status "$status" 200 "$path"
  assert_header Content-Type "$content_type"
done

status=$(request app.test GET /missing.js)
assert_status "$status" 404 'missing static resource'
status=$(request app.test GET /dashboard/view)
assert_status "$status" 200 'SPA fallback'
assert_header Content-Type 'text/html; charset=utf-8'

status=$(request app.test GET /conf/config.js)
assert_status "$status" 200 'runtime config'
assert_header Cache-Control no-store
assert_runtime_config true true

status=$(request api.app.test GET /readyz)
assert_status "$status" 200 'API readiness'
assert_header Content-Type text/plain
status=$(request short.test GET /readyz)
assert_status "$status" 404 'SHORT readiness isolation'
status=$(request app.test GET '/sub?target=clash&url=ss%3A%2F%2FYWVzLTI1Ni1nY206cGFzcw%3D%3D%40example.com%3A443%23probe')
assert_status "$status" 404 'APP conversion isolation'
status=$(request short.test GET '/sub?target=clash&url=ss%3A%2F%2FYWVzLTI1Ni1nY206cGFzcw%3D%3D%40example.com%3A443%23probe')
assert_status "$status" 404 'SHORT conversion isolation'
status=$(request unknown.test GET /)
assert_status "$status" 421 'unknown host isolation'

node_uri='ss%3A%2F%2FYWVzLTI1Ni1nY206cGFzcw%3D%3D%40example.com%3A443%23probe'
status=$(request api.app.test GET "/sub?target=clash&url=$node_uri")
assert_status "$status" 200 'inline conversion'
assert_header_matches Content-Type '^(text/plain|text/yaml|text/x-yaml|application/yaml|application/json|application/octet-stream)(;[[:space:]]*charset=utf-8)?$'

status=$(request api.app.test GET '/sub?target=clash&url=https%3A%2F%2F127.0.0.1%2Fprobe')
assert_status "$status" 403 'private-address conversion rejection'
assert_header Content-Type 'application/problem+json'
assert_problem_code private_address || fail 'private-address rejection returned the wrong problem code.'

status=$(request api.app.test GET "/sub?target=clash&url=$node_uri")
assert_status "$status" 429 'conversion rate limit'
assert_header Retry-After 60
assert_problem_code rate_limited || fail 'rate limit returned the wrong problem code.'

assert_no_sensitive_logs

short_response=$(request app.test POST /short-api/links '{"url":"https://example.com/unified-stack"}')
assert_status "$short_response" 201 'short-link creation'
short_code=$(node - "$request_body" <<'NODE'
const fs = require('node:fs');
try {
  const result = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const value = result.code ?? result.shortCode ?? result.slug;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) process.exit(1);
  process.stdout.write(value);
} catch {
  process.exit(1);
}
NODE
) || fail 'short-link creation response did not contain a code.'

status=$(request short.test GET "/$short_code")
assert_status "$status" 302 'short-link resolution'
assert_header Location 'https://example.com/unified-stack'

docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning SET "myurl:link:$1" "https://example.com/expired" EX 1 >/dev/null' \
  sh expired-probe
status=$(request short.test GET /expired-probe)
assert_status "$status" 302 'short-link before expiry'
sleep 2
status=$(request short.test GET /expired-probe)
assert_status "$status" 404 'short-link expiry'

for service in redis gateway subconverter myurls-app myurls-short; do
  docker compose restart "$service" >/dev/null
  docker compose up -d --wait >/dev/null
  assert_services_healthy
  status=$(request short.test GET "/$short_code")
  assert_status "$status" 302 "short-link after $service restart"
done

"$script_directory/verify-redis-operations.sh"

docker compose down --volumes --remove-orphans >/dev/null

compose_files=$project_root/compose.disabled-short-links.yaml
env_file=$temporary_directory/disabled.env
project_name=subweb-unified-disabled-$(openssl rand -hex 6)
{
  printf '%s\n' \
    'APP_DOMAIN=app.test' \
    'API_DOMAIN=api.app.test' \
    'API_URL=https://api.app.test' \
    'SHORT_LINKS_ENABLED=false' \
    'CUSTOM_BACKEND_ENABLED=false' \
    "SUBWEB_PORT=$host_port"
  printf '%s\n' "$locked_images" | grep -E '^SUBCONVERTER_IMAGE='
} > "$env_file"
chmod 0600 "$env_file"

export COMPOSE_FILE=$compose_files
export COMPOSE_ENV_FILES=$env_file
export COMPOSE_PROJECT_NAME=$project_name

docker compose up -d --build --wait >/dev/null

running_services=$(docker compose ps --services --filter status=running | sort)
[ "$running_services" = "gateway
subconverter" ] || fail 'disabled short-link profile did not start exactly Gateway and SubConverter.'
status=$(request app.test GET /conf/config.js)
assert_status "$status" 200 'disabled runtime config'
assert_runtime_config false false
status=$(request app.test POST /short-api/links '{"url":"https://example.com/disabled"}')
assert_status "$status" 404 'disabled short-link creation'
status=$(request api.app.test GET "/sub?target=clash&url=$node_uri")
assert_status "$status" 200 'disabled profile conversion'
status=$(request api.app.test GET "/sub?target=clash&url=$node_uri&api=https%3A%2F%2Fignored.invalid")
assert_status "$status" 200 'disabled custom backend override'

docker compose down --volumes --remove-orphans >/dev/null

compose_files=$project_root/compose.disabled-short-links.yaml:$project_root/compose.fixture.yaml
env_file=$temporary_directory/fixture.env
project_name=subweb-unified-fixture-$(openssl rand -hex 6)
{
  printf '%s\n' \
    'APP_DOMAIN=app.test' \
    'API_DOMAIN=api.app.test' \
    'API_URL=https://api.app.test' \
    'SHORT_LINKS_ENABLED=false' \
    'CUSTOM_BACKEND_ENABLED=false' \
    "SUBWEB_PORT=$host_port"
  printf '%s\n' "$locked_images" | grep -E '^SUBCONVERTER_IMAGE='
} > "$env_file"
chmod 0600 "$env_file"

export COMPOSE_FILE=$compose_files
export COMPOSE_ENV_FILES=$env_file
export COMPOSE_PROJECT_NAME=$project_name

docker compose up -d --build --wait >/dev/null
assert_fixture_services_healthy
fixture_node_uri='ss%3A%2F%2FYWVzLTI1Ni1nY206cGFzcw%3D%3D%40example.com%3A443%23fixture%3A%2F%2Fecho'
status=$(curl --noproxy '*' --silent --show-error -D "$request_headers" -o "$request_body" \
  -H 'Host: api.app.test' -H 'Authorization: Bearer fixture-secret' -H 'Proxy-Authorization: Basic fixture-secret' \
  -H 'Cookie: session=fixture-secret' -H 'Origin: https://fixture.invalid' -H 'Forwarded: for=fixture-secret' \
  -H 'X-Forwarded-For: fixture-secret' -H 'X-Real-IP: fixture-secret' -w '%{http_code}' \
  "http://127.0.0.1:$host_port/sub?target=clash&url=$fixture_node_uri")
assert_status "$status" 200 'fixture header boundary'
assert_header Content-Type application/json
assert_fixture_headers_cleared || fail 'fixture received sensitive client headers.'

fixture_node_uri='ss%3A%2F%2FYWVzLTI1Ni1nY206cGFzcw%3D%3D%40example.com%3A443%23fixture%3A%2F%2Fslow'
status=$(request api.app.test GET "/sub?target=clash&url=$fixture_node_uri")
assert_status "$status" 504 'fixture conversion timeout'
assert_problem_code upstream_timeout || fail 'fixture timeout returned the wrong problem code.'

fixture_node_uri='ss%3A%2F%2FYWVzLTI1Ni1nY206cGFzcw%3D%3D%40example.com%3A443%23fixture%3A%2F%2Flarge'
status=$(request api.app.test GET "/sub?target=clash&url=$fixture_node_uri")
assert_status "$status" 413 'fixture oversized response'
assert_problem_code response_too_large || fail 'fixture oversized response returned the wrong problem code.'

printf '%s\n' 'Unified production stack verification passed.'
