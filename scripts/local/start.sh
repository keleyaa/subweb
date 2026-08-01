#!/bin/sh
set -eu

case "$0" in /*) start_path=$0 ;; *) start_path=$PWD/${0#./} ;; esac
script_directory=$(CDPATH= cd -- "${start_path%/*}" && pwd -P)
project_root=$(CDPATH= cd -- "$script_directory/../.." && pwd -P)
runtime_root=$project_root/.runtime/local
secrets_file=$project_root/.runtime/local/secrets.env
sources_file=$project_root/.runtime/local/config/sources.env

# shellcheck source=lib/common.sh
. "$script_directory/lib/common.sh"
# shellcheck source=lib/ports.sh
. "$script_directory/lib/ports.sh"
# shellcheck source=lib/processes.sh
. "$script_directory/lib/processes.sh"
# shellcheck source=lib/health.sh
. "$script_directory/lib/health.sh"
# shellcheck source=../lib/config.sh
. "$project_root/scripts/lib/config.sh"

[ -f "$secrets_file" ] && [ ! -L "$secrets_file" ] \
  || { local_error '缺少 .runtime/local/secrets.env，请先运行 bootstrap.sh'; exit 1; }
[ -f "$sources_file" ] && [ ! -L "$sources_file" ] \
  || { local_error '缺少 .runtime/local/config/sources.env，请先运行 bootstrap.sh'; exit 1; }
[ -x "$runtime_root/bin/myurls" ] && [ -x "$runtime_root/bin/subconverter" ] \
  || { local_error '缺少本机构建产物，请先运行 bootstrap.sh'; exit 1; }

myurls_api_token=$(load_existing_secret "$secrets_file" MYURLS_API_TOKEN) \
  || { local_error '本机 MyUrls Token 无效'; exit 1; }
redis_password=$(load_existing_secret "$secrets_file" REDIS_PASSWORD) \
  || { local_error '本机 Redis 密码无效'; exit 1; }
read_generated_value() {
  key=$1
  awk -v key="$key" 'index($0, key "=") == 1 { count += 1; value = substr($0, length(key) + 2) } END { if (count == 1 && value != "") print value; else exit 1 }' "$sources_file"
}
subconverter_source=$(read_generated_value SUBCONVERTER_SOURCE_DIR) \
  || { local_error '本机 SubConverter 源码记录无效'; exit 1; }
myurls_source=$(read_generated_value MYURLS_SOURCE_DIR) \
  || { local_error '本机 MyUrls 源码记录无效'; exit 1; }
[ -d "$myurls_source/public" ] && [ ! -L "$myurls_source/public" ] \
  || { local_error '本机 MyUrls public 运行资产无效'; exit 1; }

load_optional_port() {
  key=$1
  fallback=$2
  value=$(read_local_env_value "$project_root/.env" "$key" 2>/dev/null || true)
  [ -n "$value" ] || value=$fallback
  printf '%s\n' "$value"
}
: "${LOCAL_VITE_PORT:=$(load_optional_port LOCAL_VITE_PORT 5173)}"
: "${LOCAL_SUBCONVERTER_PORT:=$(load_optional_port LOCAL_SUBCONVERTER_PORT 25500)}"
: "${LOCAL_MYURLS_PORT:=$(load_optional_port LOCAL_MYURLS_PORT 18082)}"
: "${LOCAL_REDIS_PORT:=$(load_optional_port LOCAL_REDIS_PORT 16379)}"
: "${LOCAL_APP_PORT:=$(load_optional_port LOCAL_APP_PORT 18080)}"
: "${LOCAL_API_PORT:=$(load_optional_port LOCAL_API_PORT 18081)}"
export LOCAL_VITE_PORT LOCAL_SUBCONVERTER_PORT LOCAL_MYURLS_PORT LOCAL_REDIS_PORT LOCAL_APP_PORT LOCAL_API_PORT

assert_all_local_ports() {
  seen_ports=' '
  for entry in \
    "LOCAL_VITE_PORT $LOCAL_VITE_PORT" \
    "LOCAL_SUBCONVERTER_PORT $LOCAL_SUBCONVERTER_PORT" \
    "LOCAL_MYURLS_PORT $LOCAL_MYURLS_PORT" \
    "LOCAL_REDIS_PORT $LOCAL_REDIS_PORT" \
    "LOCAL_APP_PORT $LOCAL_APP_PORT" \
    "LOCAL_API_PORT $LOCAL_API_PORT"; do
    set -- $entry
    name=$1
    port=$2
    assert_port_available "$port" "$name" || return 1
    case "$seen_ports" in *" $port "*) local_error "$name 重复使用本机端口 $port"; return 1 ;; esac
    seen_ports="$seen_ports$port "
  done
}

if find "$runtime_root/pids" -type f -name '*.pid' -print -quit 2>/dev/null | grep -q .; then
  local_error '检测到现有本机 PID 记录，请先运行 status.sh 或 stop.sh'
  exit 1
fi
assert_all_local_ports || exit 1

run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
run_root=$runtime_root/runs/$run_id
ensure_private_directory "$runtime_root/runs" || exit 1
ensure_private_directory "$run_root" || exit 1
ensure_private_directory "$run_root/pids" || exit 1
trap 'rm -rf "$run_root"' EXIT
trap 'rm -rf "$run_root"; exit 1' HUP INT TERM
ln -s "$runtime_root/bin/myurls" "$run_root/myurls"
ln -s "$runtime_root/bin/subconverter" "$run_root/subconverter"
cp -R "$myurls_source/public" "$run_root/public"

find_nginx_mime_types() {
  for candidate in /etc/nginx/mime.types /opt/homebrew/etc/nginx/mime.types /usr/local/etc/nginx/mime.types; do
    [ -f "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  done
  nginx_details=$(nginx -V 2>&1 || true)
  conf_path=$(printf '%s\n' "$nginx_details" | sed -n 's/.*--conf-path=\([^ ]*\).*/\1/p')
  [ -n "$conf_path" ] && [ -f "${conf_path%/*}/mime.types" ] \
    && { printf '%s\n' "${conf_path%/*}/mime.types"; return 0; }
  return 1
}
nginx_mime_types=$(find_nginx_mime_types) || { local_error '无法定位 Nginx mime.types'; exit 1; }
ports_json=$(printf '{"vite":%s,"subconverter":%s,"myurls":%s,"redis":%s,"app":%s,"api":%s}' \
  "$LOCAL_VITE_PORT" "$LOCAL_SUBCONVERTER_PORT" "$LOCAL_MYURLS_PORT" \
  "$LOCAL_REDIS_PORT" "$LOCAL_APP_PORT" "$LOCAL_API_PORT")
MYURLS_API_TOKEN=$myurls_api_token REDIS_PASSWORD=$redis_password \
  node "$script_directory/render-config.mjs" \
  --project-root "$project_root" \
  --run-root "$run_root" \
  --subconverter-source "$subconverter_source" \
  --nginx-mime-types "$nginx_mime_types" \
  --ports-json "$ports_json"

nginx -t -p "$runtime_root/nginx" -c "$run_root/nginx.conf" >/dev/null
if redis-server --help 2>&1 | grep -q -- '--test-memory'; then
  redis-server --test-memory 1 >/dev/null
fi

started_services=
rollback_new_services() {
  for service in $started_services; do
    rm -f "$runtime_root/pids/.$service.pid.tmp.$$"
    stop_owned_process "$run_root/pids/$service.pid" || true
    if [ -f "$runtime_root/pids/$service.pid" ]; then
      published_run_path=$(read_process_record_field "$runtime_root/pids/$service.pid" RUN_PATH 2>/dev/null || true)
      [ "$published_run_path" != "$run_root" ] || rm -f "$runtime_root/pids/$service.pid"
    fi
  done
  if [ -f "$runtime_root/config/local.env" ]; then
    configured_run_root=$(awk 'index($0, "RUN_ROOT=") == 1 { print substr($0, 10) }' "$runtime_root/config/local.env")
    [ "$configured_run_root" != "$run_root" ] || rm -f "$runtime_root/config/local.env"
  fi
  rm -rf "$run_root"
}
trap - EXIT HUP INT TERM
trap 'rollback_new_services; exit 1' HUP INT TERM
trap 'status=$?; [ "$status" -eq 0 ] || rollback_new_services; exit "$status"' EXIT

start_local_service() {
  service=$1
  log_file=$runtime_root/logs/$service.log
  case "$service" in
    redis)
      redis-server "$run_root/redis.conf" >> "$log_file" 2>&1 &
      health_url="redis://127.0.0.1:$LOCAL_REDIS_PORT"
      ;;
    myurls)
      (cd "$run_root" && \
        MYURLS_PORT=$LOCAL_MYURLS_PORT \
        MYURLS_DOMAIN="127.0.0.1:$LOCAL_APP_PORT" \
        MYURLS_PROTO=http \
        MYURLS_REDIS_CONN="127.0.0.1:$LOCAL_REDIS_PORT" \
        MYURLS_REDIS_PASSWORD=$redis_password \
        MYURLS_API_TOKEN=$myurls_api_token \
        exec ./myurls) >> "$log_file" 2>&1 &
      health_url="http://127.0.0.1:$LOCAL_MYURLS_PORT/healthz"
      ;;
    subconverter)
      (cd "$subconverter_source" && \
        PORT=$LOCAL_SUBCONVERTER_PORT \
        MANAGED_CONFIG_PREFIX="http://127.0.0.1:$LOCAL_API_PORT" \
        SUBCONVERTER_SECURITY_PROFILE=public \
        SUBCONVERTER_ALLOW_PUBLIC_UPLOAD=false \
        exec "$run_root/subconverter" -f "$run_root/subconverter.toml") \
        >> "$log_file" 2>&1 &
      health_url="http://127.0.0.1:$LOCAL_SUBCONVERTER_PORT/healthz"
      ;;
    vite)
      (cd "$project_root" && exec node "$project_root/node_modules/vite/bin/vite.js" \
        --host 127.0.0.1 --port "$LOCAL_VITE_PORT" --strictPort) \
        >> "$log_file" 2>&1 &
      health_url="http://127.0.0.1:$LOCAL_VITE_PORT/"
      ;;
    nginx)
      nginx -p "$runtime_root/nginx" -c "$run_root/nginx.conf" -g 'daemon off;' \
        >> "$log_file" 2>&1 &
      health_url="http://127.0.0.1:$LOCAL_APP_PORT/healthz"
      ;;
    *) local_error "未知本机服务: $service"; return 1 ;;
  esac
  service_pid=$!
  started_services="$service $started_services"
  process_start=$(process_start_identity "$service_pid" || true)
  [ -n "$process_start" ] || return 1
  if ! write_process_record "$run_root/pids/$service.pid" "$service_pid" "$service" "$run_root" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$health_url" "$process_start"; then
    kill -TERM "$service_pid" 2>/dev/null || true
    sleep 1
    kill -KILL "$service_pid" 2>/dev/null || true
    return 1
  fi
}

start_local_service redis
wait_for_redis_health "$LOCAL_REDIS_PORT" "$redis_password"
start_local_service myurls
if ! wait_for_http_health myurls "http://127.0.0.1:$LOCAL_MYURLS_PORT/healthz"; then
  if [ -f "$runtime_root/logs/myurls.log" ]; then
    printf '%s\n' 'MyUrls log tail (secrets redacted):' >&2
    tail -n 40 "$runtime_root/logs/myurls.log" \
      | awk -v token="$myurls_api_token" -v password="$redis_password" \
        '{ gsub(token, "[REDACTED]"); gsub(password, "[REDACTED]"); print }' >&2
  fi
  exit 1
fi
start_local_service subconverter
wait_for_http_health subconverter "http://127.0.0.1:$LOCAL_SUBCONVERTER_PORT/healthz"
start_local_service vite
wait_for_http_health vite "http://127.0.0.1:$LOCAL_VITE_PORT/"
start_local_service nginx
wait_for_http_health nginx-app "http://127.0.0.1:$LOCAL_APP_PORT/healthz"
wait_for_http_health nginx-api "http://127.0.0.1:$LOCAL_API_PORT/healthz"

publish_pid_records() {
  for service in redis myurls subconverter vite nginx; do
    cp "$run_root/pids/$service.pid" "$runtime_root/pids/.$service.pid.tmp.$$"
    chmod 0600 "$runtime_root/pids/.$service.pid.tmp.$$"
  done
  for service in redis myurls subconverter vite nginx; do
    mv "$runtime_root/pids/.$service.pid.tmp.$$" "$runtime_root/pids/$service.pid"
  done
  {
    printf 'RUN_ROOT=%s\n' "$run_root"
    printf 'LOCAL_VITE_PORT=%s\n' "$LOCAL_VITE_PORT"
    printf 'LOCAL_SUBCONVERTER_PORT=%s\n' "$LOCAL_SUBCONVERTER_PORT"
    printf 'LOCAL_MYURLS_PORT=%s\n' "$LOCAL_MYURLS_PORT"
    printf 'LOCAL_REDIS_PORT=%s\n' "$LOCAL_REDIS_PORT"
    printf 'LOCAL_APP_PORT=%s\n' "$LOCAL_APP_PORT"
    printf 'LOCAL_API_PORT=%s\n' "$LOCAL_API_PORT"
  } > "$runtime_root/config/local.env.tmp"
  chmod 0600 "$runtime_root/config/local.env.tmp"
  mv -f "$runtime_root/config/local.env.tmp" "$runtime_root/config/local.env"
  printf '%s\n' "$run_root" > "$runtime_root/active-run.tmp"
  chmod 0600 "$runtime_root/active-run.tmp"
  mv -f "$runtime_root/active-run.tmp" "$runtime_root/active-run"
  rm -f "$run_root/pids/"*.pid
}
publish_pid_records
started_services=
trap - EXIT HUP INT TERM
unset myurls_api_token redis_password

printf 'APP: http://127.0.0.1:%s\n' "$LOCAL_APP_PORT"
printf 'API: http://127.0.0.1:%s\n' "$LOCAL_API_PORT"
printf '日志: %s\n' "$runtime_root/logs"
