#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_directory/.." && pwd -P)

# This verifier owns the generated local Compose environment.
unset \
  APP_DOMAIN API_DOMAIN API_URL SHORT_DOMAIN SUBWEB_PORT \
  IP_HASH_SECRET TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY \
  SUBCONVERTER_IMAGE \
  SHORT_LINK_DB_PATH SHORT_LINK_TTL_SECONDS
export SUBWEB_LOCAL_PROJECT_NAME="subweb-local-verify-$(openssl rand -hex 6)"
SUBWEB_LOCAL_PROJECT_NAME="$SUBWEB_LOCAL_PROJECT_NAME" \
  "$script_directory/local/select-test-network.sh" >/dev/null
create_body=
cleanup() {
  [ -z "$create_body" ] || rm -f "$create_body"
  if [ -n "${vite_pid:-}" ]; then
    pkill -P "$vite_pid" >/dev/null 2>&1 || true
    kill "$vite_pid" >/dev/null 2>&1 || true
    wait "$vite_pid" >/dev/null 2>&1 || true
  fi
  COMPOSE_PROJECT_NAME="$SUBWEB_LOCAL_PROJECT_NAME" "$script_directory/local/deps.sh" remove-volumes >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
"$script_directory/local/deps.sh" up

# Pick a free port unless the caller pins one, so a stale dev server cannot
# answer the readiness probe with its own, unrelated proxy.
if [ -n "${LOCAL_VITE_PORT:-}" ]; then
  local_vite_port=$LOCAL_VITE_PORT
else
  local_vite_port=$(node -e '
const net = require("node:net");
const server = net.createServer();
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(String(server.address().port));
  server.close();
});
') || { printf '%s\n' 'Unable to reserve a local Vite port.' >&2; exit 1; }
fi
local_subweb_port=${LOCAL_SUBWEB_PORT:-18081}
cd "$project_root"
VITE_LOCAL_SUBCONVERTER_URL="http://127.0.0.1:$local_subweb_port" \
LOCAL_SUBWEB_PORT="$local_subweb_port" \
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

create_body=$(mktemp "${TMPDIR:-/tmp}/subweb-local-create.XXXXXX") \
  || { printf '%s\n' 'Unable to create a temporary short-link response file.' >&2; exit 1; }
attempt=0
while :; do
  create_status=$(curl --connect-timeout "$http_connect_timeout_seconds" --max-time "$http_max_time_seconds" \
    --silent --show-error --output "$create_body" --write-out '%{http_code}' \
    -H 'Content-Type: application/json' \
    --data '{"url":"https://example.com/local-development-sentinel"}' \
    "http://127.0.0.1:$local_vite_port/short-api/links")
  if [ "$create_status" = 201 ] && code=$(node -e '
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (typeof payload.code !== "string" || typeof payload.shortUrl !== "string" ||
    typeof payload.expiresAt !== "string") process.exit(1);
if (payload.shortUrl !== "https://short.local.test/" + payload.code) process.exit(1);
process.stdout.write(payload.code);
' "$create_body"); then
    break
  fi
  attempt=$((attempt + 1))
  [ "$attempt" -lt 20 ] \
    || { printf 'Short-link creation did not succeed (last status %s).\n' "$create_status" >&2; exit 1; }
  sleep 0.5
done

status=$(curl --connect-timeout "$http_connect_timeout_seconds" --max-time "$http_max_time_seconds" \
  --header 'Host: short.local.test' \
  --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:$local_subweb_port/$code")
[ "$status" -eq 302 ] || { printf 'Expected a 302 redirect, got %s.\n' "$status" >&2; exit 1; }
printf '%s\n' 'Compose-first local development flow passed.'
