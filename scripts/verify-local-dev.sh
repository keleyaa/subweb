#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_directory/.." && pwd -P)

"$script_directory/local/deps.sh" up
cleanup() {
  if [ -n "${vite_pid:-}" ]; then
    kill "$vite_pid" >/dev/null 2>&1 || true
    wait "$vite_pid" >/dev/null 2>&1 || true
  fi
  "$script_directory/local/deps.sh" down >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

local_vite_port=${LOCAL_VITE_PORT:-5173}
local_myurls_port=${LOCAL_MYURLS_PORT:-18082}
local_subconverter_port=${LOCAL_SUBCONVERTER_PORT:-25500}
cd "$project_root"
VITE_LOCAL_SUBCONVERTER_URL="http://127.0.0.1:$local_subconverter_port" \
LOCAL_MYURLS_PORT="$local_myurls_port" \
  npm run serve -- --host 127.0.0.1 --port "$local_vite_port" --strictPort >/dev/null 2>&1 &
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
