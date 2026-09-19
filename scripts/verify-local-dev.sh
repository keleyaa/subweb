#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_directory/.." && pwd -P)

# This verifier owns the generated local Compose environment.
unset \
  APP_DOMAIN API_DOMAIN API_URL SHORT_DOMAIN SUBWEB_PORT \
  REDIS_PASSWORD IP_HASH_SECRET TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY \
  REDIS_IMAGE SUBCONVERTER_IMAGE MYURLS_IMAGE \
  MYURLS_NETWORK_SUBNET MYURLS_GATEWAY_IP MYURLS_IP MYURLS_TRUST_PROXY_CIDR \
  SUBWEB_LOCAL_PROJECT_NAME

test_network_subnet=$("$script_directory/select-test-network.sh")
test_network_prefix=${test_network_subnet%.*}
export LOCAL_MYURLS_NETWORK_SUBNET="$test_network_subnet"
export LOCAL_MYURLS_GATEWAY_IP="$test_network_prefix.2"
export LOCAL_MYURLS_IP="$test_network_prefix.3"
export LOCAL_MYURLS_TRUST_PROXY_CIDR="$LOCAL_MYURLS_GATEWAY_IP/32"
export SUBWEB_LOCAL_PROJECT_NAME="subweb-local-verify-$(openssl rand -hex 6)"
cleanup() {
  if [ -n "${vite_pid:-}" ]; then
    kill "$vite_pid" >/dev/null 2>&1 || true
    wait "$vite_pid" >/dev/null 2>&1 || true
  fi
  COMPOSE_PROJECT_NAME="$SUBWEB_LOCAL_PROJECT_NAME" "$script_directory/local/deps.sh" remove-volumes >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
"$script_directory/local/deps.sh" up

local_vite_port=${LOCAL_VITE_PORT:-5173}
local_myurls_port=${LOCAL_MYURLS_PORT:-18082}
local_subweb_port=${LOCAL_SUBWEB_PORT:-18081}
cd "$project_root"
VITE_LOCAL_SUBCONVERTER_URL="http://127.0.0.1:$local_subweb_port" \
LOCAL_SUBWEB_PORT="$local_subweb_port" \
LOCAL_MYURLS_PORT="$local_myurls_port" \
  ./node_modules/.bin/vite --host 127.0.0.1 --port "$local_vite_port" --strictPort >/dev/null 2>&1 &
vite_pid=$!

http_connect_timeout_seconds=5
http_max_time_seconds=15
attempt=0
until curl --connect-timeout "$http_connect_timeout_seconds" --max-time "$http_max_time_seconds" \
  --fail --silent --show-error "http://127.0.0.1:$local_vite_port/" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 50 ] || { printf '%s\n' 'Vite did not become ready.' >&2; exit 1; }
  sleep 0.2
done

response=$(curl --connect-timeout "$http_connect_timeout_seconds" --max-time "$http_max_time_seconds" \
  --fail-with-body --silent --show-error \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://example.com/local-development-sentinel"}' \
  "http://127.0.0.1:$local_vite_port/short-api/links")
short_url=$(printf '%s' "$response" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(input);
  if (typeof payload.shortUrl !== "string" || typeof payload.expiresAt !== "string") process.exit(1);
  process.stdout.write(payload.shortUrl);
});
')
case "$short_url" in
  "http://127.0.0.1:$local_myurls_port/"*) ;;
  *) printf '%s\n' 'Local short-link response used an unexpected public base.' >&2; exit 1 ;;
esac

status=$(curl --connect-timeout "$http_connect_timeout_seconds" --max-time "$http_max_time_seconds" \
  --silent --output /dev/null --write-out '%{http_code}' "$short_url")
[ "$status" -eq 302 ] || { printf 'Expected a 302 redirect, got %s.\n' "$status" >&2; exit 1; }
printf '%s\n' 'Compose-first local development flow passed.'
