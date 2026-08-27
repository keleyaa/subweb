#!/bin/sh
set -eu
umask 077

[ "$#" -eq 0 ] || { printf '%s\n' 'Usage: verify-integrated-stack.sh' >&2; exit 2; }
for command in docker curl node openssl; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Missing command: %s\n' "$command" >&2; exit 1; }
done
docker compose version >/dev/null 2>&1 || { printf '%s\n' 'Docker Compose v2 is required.' >&2; exit 1; }

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repository_root=$(CDPATH= cd -- "$script_directory/.." && pwd -P)
base_compose=$repository_root/compose.yaml
test_compose=$repository_root/compose.test.yaml
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/subweb-integration.XXXXXX")
project_name=subweb-verify-$(openssl rand -hex 6)
client_a_container=${project_name}-client-a
client_b_container=${project_name}-client-b
env_file=$temporary_directory/stack.env
command_log=$temporary_directory/compose.log
service_log=$temporary_directory/services.log
host_port=$(node -e 'const n=require("node:net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')
redis_password=$(openssl rand -hex 32)
ip_hash_secret=$(openssl rand -hex 32)
sentinel_value=sentinel-$(openssl rand -hex 16)

myurls_test_image=${MYURLS_IMAGE:-}
if [ -z "$myurls_test_image" ]; then
  node "$repository_root/scripts/verify-version-locks.mjs" >/dev/null
  myurls_test_image=$(node - "$repository_root/deploy/versions.lock.json" <<'NODE'
const fs = require('node:fs');
const image = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).services.myurls.image;
process.stdout.write(`${image.reference}@${image.digest}`);
NODE
  )
fi

cleanup() {
  docker stop "$client_a_container" "$client_b_container" >/dev/null 2>&1 || true
  docker compose -p "$project_name" -f "$base_compose" -f "$test_compose" --env-file "$env_file" \
    down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$temporary_directory"
}
trap cleanup EXIT HUP INT TERM

fail() {
  printf 'Integrated verification failed: %s\n' "$1" >&2
  [ ! -f "$command_log" ] || tail -n 80 "$command_log" \
    | sed "s/$redis_password/[REDACTED]/g; s/$ip_hash_secret/[REDACTED]/g" >&2
  exit 1
}

compose() {
  docker compose -p "$project_name" -f "$base_compose" -f "$test_compose" --env-file "$env_file" "$@"
}
status_for() {
  output_file=$1
  shift
  curl --noproxy '*' --silent --show-error --output "$output_file" --write-out '%{http_code}' "$@"
}
post_json() {
  output=$1
  host=$2
  origin=$3
  body=$4
  path=${5:-/short-api/v1/links}
  status_for "$output" -H "Host: $host" -H "Origin: $origin" -H 'Content-Type: application/json' \
    --data "$body" "http://127.0.0.1:$host_port$path"
}
count_create_rate_keys() {
  compose exec -T redis sh -eu -c \
    'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning --scan --pattern "myurl:rate:create:*" | wc -l' \
    | awk 'NF { print $1; exit }'
}
start_client() {
  docker run --rm --detach --name "$1" --network "${project_name}_default" \
    node:24-alpine node -e 'setInterval(() => {}, 2 ** 31 - 1)' >/dev/null
}
post_json_from_client() {
  client_container=$1
  client_url=$2
  docker exec "$client_container" node -e '
const http = require("node:http");
const request = http.request({
  host: "gateway",
  port: 8080,
  path: "/short-api/v1/links",
  method: "POST",
  headers: {
    Host: "app.test",
    Origin: "https://app.test",
    "Content-Type": "application/json",
  },
}, (response) => {
  response.resume();
  response.on("end", () => {
    process.stdout.write(String(response.statusCode));
    process.exit(response.statusCode === 201 ? 0 : 1);
  });
});
request.on("error", () => process.exit(1));
request.end(JSON.stringify({ url: process.argv[1] }));
' "$client_url"
}

{
  printf '%s\n' \
    'APP_DOMAIN=app.test' \
    'API_DOMAIN=api.app.test' \
    'API_URL=https://api.app.test' \
    'SHORT_DOMAIN=short.test' \
    "SUBWEB_PORT=$host_port" \
    "MYURLS_IMAGE=$myurls_test_image" \
    "REDIS_PASSWORD=$redis_password" \
    "IP_HASH_SECRET=$ip_hash_secret" \
    'TURNSTILE_SITE_KEY=test-site-key' \
    'TURNSTILE_SECRET_KEY=test-secret-key'
  [ -z "${REDIS_IMAGE:-}" ] || printf 'REDIS_IMAGE=%s\n' "$REDIS_IMAGE"
  [ -z "${SUBCONVERTER_IMAGE:-}" ] || printf 'SUBCONVERTER_IMAGE=%s\n' "$SUBCONVERTER_IMAGE"
} > "$env_file"
chmod 0600 "$env_file"

compose up -d --build --wait --wait-timeout 240 > "$command_log" 2>&1 || fail 'stack did not become healthy'

app_body=$(curl --noproxy '*' --fail --silent --show-error -H 'Host: app.test' "http://127.0.0.1:$host_port/") \
  || fail 'APP host is unavailable'
printf '%s' "$app_body" | grep -q 'Subconverter Web' || fail 'APP host returned unexpected content'

compose exec -T myurls-app node -e \
  "Promise.all(['/health/live','/health/ready'].map(p=>fetch('http://127.0.0.1:3000'+p).then(r=>{if(!r.ok)process.exit(1)}))).catch(()=>process.exit(1))" \
  || fail 'MyUrls live/readiness checks failed'
compose exec -T myurls-short node -e \
  "Promise.all(['/health/live','/health/ready'].map(p=>fetch('http://127.0.0.1:3000'+p).then(r=>{if(!r.ok)process.exit(1)}))).catch(()=>process.exit(1))" \
  || fail 'SHORT MyUrls live/readiness checks failed'

[ "$(compose exec -T gateway getent ahostsv4 myurls-app-edge | awk 'NR == 1 { print $1 }')" = '172.30.255.3' ] \
  || fail 'Gateway did not resolve the APP MyUrls edge alias to its trusted-network address'
[ "$(compose exec -T gateway getent ahostsv4 myurls-short-edge | awk 'NR == 1 { print $1 }')" = '172.30.255.4' ] \
  || fail 'Gateway did not resolve the SHORT MyUrls edge alias to its trusted-network address'

short_html=$(curl --noproxy '*' --fail --silent --show-error -H 'Host: short.test' "http://127.0.0.1:$host_port/") \
  || fail 'SHORT host is unavailable'
asset_path=$(printf '%s' "$short_html" | sed -n 's/.*src="\(\/assets\/[^"]*\.js\)".*/\1/p' | head -n 1)
[ -n "$asset_path" ] || fail 'MyUrls hashed asset was not present in the UI'
[ "$(status_for "$temporary_directory/asset.out" -H 'Host: short.test' "http://127.0.0.1:$host_port$asset_path")" = 200 ] \
  || fail 'MyUrls hashed asset was not reachable'

short_status=$(post_json "$temporary_directory/short-create.json" short.test https://short.test \
  '{"url":"https://example.com/short-hostname-verification"}' /api/v1/links)
[ "$short_status" = 201 ] || fail "SHORT MyUrls creation returned $short_status"
node - "$temporary_directory/short-create.json" <<'NODE' || fail 'SHORT v2 success payload is invalid'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!/^[A-Za-z0-9_-]{1,64}$/.test(value.code) || !value.shortUrl.startsWith('https://short.test/') || Number.isNaN(Date.parse(value.expiresAt))) process.exit(1);
NODE

long_url="https://example.com/path?verification=$(openssl rand -hex 8)"
first_status=$(post_json "$temporary_directory/first.json" app.test https://app.test "{\"url\":\"$long_url\"}")
[ "$first_status" = 201 ] || fail "APP creation returned $first_status"
node - "$temporary_directory/first.json" <<'NODE' || fail 'v2 success payload is invalid'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!/^[A-Za-z0-9_-]{1,64}$/.test(value.code) || !value.shortUrl.startsWith('https://short.test/') || Number.isNaN(Date.parse(value.expiresAt))) process.exit(1);
NODE
code=$(node -e "const p=require(process.argv[1]);process.stdout.write(p.code)" "$temporary_directory/first.json")
curl --noproxy '*' --silent --show-error -D "$temporary_directory/redirect.headers" -o /dev/null \
  -H 'Host: short.test' "http://127.0.0.1:$host_port/$code"
grep -Fqi "Location: $long_url" "$temporary_directory/redirect.headers" \
  || fail 'created short code did not redirect to its target'

challenge_status=$(post_json "$temporary_directory/challenge.json" app.test https://app.test \
  "{\"url\":\"https://example.com/challenge-$sentinel_value\"}")
[ "$challenge_status" = 403 ] || fail "challenge request returned $challenge_status"
node - "$temporary_directory/challenge.json" <<'NODE' || fail 'challenge payload is invalid'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value.error?.code !== 'challenge_required' || value.challenge?.provider !== 'turnstile') process.exit(1);
NODE
retry_status=$(post_json "$temporary_directory/retry.json" app.test https://app.test \
  "{\"url\":\"https://example.com/challenge-$sentinel_value\",\"challengeToken\":\"test-token\"}")
[ "$retry_status" = 201 ] || fail "challenge retry returned $retry_status"

rate_keys_before=$(count_create_rate_keys)
start_client "$client_a_container" || fail 'first independent Docker client did not start'
start_client "$client_b_container" || fail 'second independent Docker client did not start'
[ "$(post_json_from_client "$client_a_container" 'https://example.com/client-rate-a')" = 201 ] \
  || fail 'first independent Docker client could not create a short link'
[ "$(post_json_from_client "$client_b_container" 'https://example.com/client-rate-b')" = 201 ] \
  || fail 'second independent Docker client could not create a short link'
docker stop "$client_a_container" "$client_b_container" >/dev/null \
  || fail 'independent Docker clients did not stop cleanly'
rate_keys_after=$(count_create_rate_keys)
[ "$rate_keys_after" -eq $((rate_keys_before + 4)) ] \
  || fail 'Gateway did not preserve distinct client identities for MyUrls rate limits'

[ "$(status_for "$temporary_directory/type.out" -H 'Host: app.test' -H 'Origin: https://app.test' \
  -H 'Content-Type: text/plain' --data '{}' "http://127.0.0.1:$host_port/short-api/v1/links")" = 415 ] \
  || fail 'non-JSON request was not rejected'
[ "$(post_json "$temporary_directory/origin.out" app.test https://evil.test '{"url":"https://example.com"}')" = 403 ] \
  || fail 'foreign Origin was not rejected'
[ "$(post_json "$temporary_directory/unknown.out" app.test https://app.test '{"url":"https://example.com","unknown":true}')" = 400 ] \
  || fail 'unknown JSON field was not rejected'

for service_port in 'redis 6379' 'myurls-app 3000' 'myurls-short 3000' 'subconverter 25500'; do
  set -- $service_port
  [ -z "$(docker port "$(compose ps -q "$1")" "$2/tcp" 2>/dev/null || true)" ] || fail 'an internal port was published'
done

compose restart redis >> "$command_log" 2>&1 || fail 'Redis restart failed'
compose up -d --wait --wait-timeout 120 >> "$command_log" 2>&1 || fail 'stack did not recover after Redis restart'

for service in gateway myurls-app myurls-short subconverter redis; do
  compose logs --no-color --tail 500 "$service" > "$service_log" 2>&1 || fail 'service logs were unavailable'
  grep -Fq "$sentinel_value" "$service_log" && fail "service log leaked request data: $service"
  grep -Fq 'test-token' "$service_log" && fail "service log leaked a challenge token: $service"
  grep -Fq "$redis_password" "$service_log" && fail "service log leaked Redis credentials: $service"
  grep -Fq "$ip_hash_secret" "$service_log" && fail "service log leaked IP hash secret: $service"
done

printf '%s\n' 'MyUrls v2 integrated stack verification passed.'
