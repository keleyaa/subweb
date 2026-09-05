#!/bin/sh
set -eu

runtime_dir=${SINGLE_RUNTIME_DIR:-/run/subweb}
mkdir -p "$runtime_dir" /data /base
chmod 0700 "$runtime_dir"
mkdir -p "$runtime_dir/subconverter"
chown 10001:10001 "$runtime_dir/subconverter" /data /base
chmod 0700 "$runtime_dir/subconverter" /data /base

run_as() {
  case "$1" in
    10001:10001) user=subweb-app ;;
    10002:10002) user=subweb-gateway ;;
    10003:10003) user=subweb-redis ;;
    *) printf 'single-container: unsupported uid %s\n' "$1" >&2; exit 1 ;;
  esac
  shift
  su -s /bin/sh "$user" -c 'exec "$@"' sh "$@"
}

run_gateway() {
  run_as 10002:10002 env -i \
    HOME=/nonexistent PATH=/usr/local/bin:/usr/bin:/bin TZ="${TZ:-Asia/Shanghai}" \
    LISTEN_ADDR=0.0.0.0:8080 EGRESS_LISTEN_ADDR=0.0.0.0:25502 \
    APP_DOMAIN="$APP_DOMAIN" API_DOMAIN="$API_DOMAIN" SHORT_DOMAIN="$SHORT_DOMAIN" API_URL="$API_URL" \
    SUBCONVERTER_UPSTREAM=http://127.0.0.1:25500 \
    MYURLS_APP_UPSTREAM=http://127.0.0.1:3001 MYURLS_SHORT_UPSTREAM=http://127.0.0.1:3002 \
    REDIS_URL=redis://127.0.0.1:6379/1 REDIS_PASSWORD="$REDIS_PASSWORD" IP_HASH_SECRET="$IP_HASH_SECRET" \
    TURNSTILE_SITE_KEY="$TURNSTILE_SITE_KEY" SHORT_LINKS_ENABLED=true \
    CUSTOM_BACKEND_ENABLED="${CUSTOM_BACKEND_ENABLED:-true}" TRUSTED_PROXY_CIDR="${TRUSTED_PROXY_CIDR:-}" \
    CONVERSION_RATE_LIMIT="${CONVERSION_RATE_LIMIT:-10}" CONVERSION_RATE_WINDOW_SECONDS="${CONVERSION_RATE_WINDOW_SECONDS:-60}" \
    CONVERSION_MAX_REQUEST_BYTES="${CONVERSION_MAX_REQUEST_BYTES:-16384}" CONVERSION_MAX_RESPONSE_BYTES="${CONVERSION_MAX_RESPONSE_BYTES:-8388608}" \
    CONVERSION_REQUEST_TIMEOUT_MS="${CONVERSION_REQUEST_TIMEOUT_MS:-10000}" CONVERSION_DNS_TIMEOUT_MS="${CONVERSION_DNS_TIMEOUT_MS:-2000}" \
    CONVERSION_EGRESS_CONNECT_TIMEOUT_MS="${CONVERSION_EGRESS_CONNECT_TIMEOUT_MS:-5000}" CONVERSION_MAX_CONCURRENCY="${CONVERSION_MAX_CONCURRENCY:-2}" \
    /app/gateway
}

if [ "${1-}" = "--healthcheck" ]; then
  wget -q --header="Host: ${APP_DOMAIN:?APP_DOMAIN is required}" -O /dev/null "http://127.0.0.1:8080/healthz" \
    && wget -q -O /dev/null "http://127.0.0.1:25500/healthz" \
    && wget -q -O /dev/null "http://127.0.0.1:3001/health/live" \
    && wget -q -O /dev/null "http://127.0.0.1:3002/health/live" \
    && /usr/local/bin/redis-cli -a "${REDIS_PASSWORD:?REDIS_PASSWORD is required}" --no-auth-warning ping | grep -qx PONG
  exit $?
fi

required='APP_DOMAIN API_DOMAIN SHORT_DOMAIN API_URL REDIS_PASSWORD IP_HASH_SECRET TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY'
for name in $required; do
  eval "value=\${$name-}"
  [ -n "$value" ] || { printf 'single-container: %s is required\n' "$name" >&2; exit 1; }
done

cleanup() {
  status=$?
  trap - EXIT INT TERM
  for pid in ${gateway_pid-} ${subconverter_pid-} ${app_pid-} ${short_pid-} ${redis_pid-}; do
    [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null || true
  done
  wait || true
  exit "$status"
}
trap cleanup EXIT INT TERM

umask 077
awk '{ gsub(/@@REDIS_PASSWORD@@/, ENVIRON["REDIS_PASSWORD"]); print }' \
  /etc/redis/redis.conf.template > "$runtime_dir/redis.conf"
chown 10003:10003 "$runtime_dir/redis.conf"
run_as 10003:10003 /usr/local/bin/redis-server "$runtime_dir/redis.conf" &
redis_pid=$!

until /usr/local/bin/redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping 2>/dev/null | grep -qx PONG; do sleep 0.2; done

run_as 10001:10001 env -i HOME=/nonexistent PATH=/usr/local/bin:/usr/bin:/bin TZ="${TZ:-Asia/Shanghai}" REDIS_URL=redis://127.0.0.1:6379/0 REDIS_PASSWORD="$REDIS_PASSWORD" APP_PORT=3001 PUBLIC_BASE_URL="https://$APP_DOMAIN" WEB_ROOT=/app/web \
  NODE_ENV=production LOG_LEVEL="${MYURLS_LOG_LEVEL:-warn}" \
  IP_HASH_SECRET="$IP_HASH_SECRET" TURNSTILE_ENABLED=true TURNSTILE_MODE=cloudflare \
  TURNSTILE_SITE_KEY="$TURNSTILE_SITE_KEY" TURNSTILE_SECRET_KEY="$TURNSTILE_SECRET_KEY" \
  TURNSTILE_HOSTNAME="$APP_DOMAIN" TRUST_PROXY_CIDRS="${MYURLS_TRUST_PROXY_CIDR:-}" \
  CREATE_DIRECT_LIMIT_10M=5 CREATE_HARD_LIMIT_10M=20 CREATE_HARD_LIMIT_1D=100 \
  RESOLVE_LIMIT_10S=600 RISK_CHALLENGE_SCORE=3 RISK_BLOCK_SCORE=8 \
  REDIS_TIMEOUT_MS=750 TURNSTILE_TIMEOUT_MS=2500 REQUEST_TIMEOUT_MS=10000 SHUTDOWN_TIMEOUT_MS=10000 \
  /usr/local/bin/myurl-server &
app_pid=$!

run_as 10001:10001 env -i HOME=/nonexistent PATH=/usr/local/bin:/usr/bin:/bin TZ="${TZ:-Asia/Shanghai}" REDIS_URL=redis://127.0.0.1:6379/0 REDIS_PASSWORD="$REDIS_PASSWORD" APP_PORT=3002 PUBLIC_BASE_URL="https://$SHORT_DOMAIN" WEB_ROOT=/app/web \
  NODE_ENV=production LOG_LEVEL="${MYURLS_LOG_LEVEL:-warn}" \
  IP_HASH_SECRET="$IP_HASH_SECRET" TURNSTILE_ENABLED=true TURNSTILE_MODE=cloudflare \
  TURNSTILE_SITE_KEY="$TURNSTILE_SITE_KEY" TURNSTILE_SECRET_KEY="$TURNSTILE_SECRET_KEY" \
  TURNSTILE_HOSTNAME="$SHORT_DOMAIN" TRUST_PROXY_CIDRS="${MYURLS_TRUST_PROXY_CIDR:-}" \
  CREATE_DIRECT_LIMIT_10M=5 CREATE_HARD_LIMIT_10M=20 CREATE_HARD_LIMIT_1D=100 \
  RESOLVE_LIMIT_10S=600 RISK_CHALLENGE_SCORE=3 RISK_BLOCK_SCORE=8 \
  REDIS_TIMEOUT_MS=750 TURNSTILE_TIMEOUT_MS=2500 REQUEST_TIMEOUT_MS=10000 SHUTDOWN_TIMEOUT_MS=10000 \
  /usr/local/bin/myurl-server &
short_pid=$!

PREF_PATH=/base/pref.subweb.toml MANAGED_CONFIG_PREFIX="$API_URL" \
  HTTPS_PROXY=http://127.0.0.1:25502 https_proxy=http://127.0.0.1:25502 \
  NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
sed -E -e 's/^[[:space:]]*log_level[[:space:]]*=.*/log_level = "warn"/' \
    -e 's/^[[:space:]]*print_debug_info[[:space:]]*=.*/print_debug_info = false/' \
    -e 's/^[[:space:]]*profile[[:space:]]*=.*/profile = "public"/' \
    -e 's|^[[:space:]]*default_external_config[[:space:]]*=.*|default_external_config = "config/example_external_config.ini"|' \
    /base/pref.example.toml > /base/pref.subweb.toml
chown 10001:10001 /base/pref.subweb.toml
run_as 10001:10001 env -i HOME=/nonexistent PATH=/usr/local/bin:/usr/bin:/bin TZ="${TZ:-Asia/Shanghai}" PREF_PATH=/base/pref.subweb.toml \
  SUBWEB_LOG_FILTER=/usr/local/bin/subweb-log-filter.awk SUBWEB_LOG_RUNTIME_DIR="$runtime_dir/subconverter" \
  /usr/local/bin/subweb-log-supervisor /usr/bin/subconverter -f /base/pref.subweb.toml &
subconverter_pid=$!

run_gateway &
gateway_pid=$!

wait -n "$redis_pid" "$app_pid" "$short_pid" "$subconverter_pid" "$gateway_pid"
