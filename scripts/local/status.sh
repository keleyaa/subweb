#!/bin/sh
set -eu

case "$0" in /*) status_path=$0 ;; *) status_path=$PWD/${0#./} ;; esac
script_directory=$(CDPATH= cd -- "${status_path%/*}" && pwd -P)
project_root=$(CDPATH= cd -- "$script_directory/../.." && pwd -P)
runtime_root=${LOCAL_RUNTIME_ROOT_OVERRIDE:-$project_root/.runtime/local}

# shellcheck source=lib/common.sh
. "$script_directory/lib/common.sh"
# shellcheck source=lib/processes.sh
. "$script_directory/lib/processes.sh"
# shellcheck source=../../scripts/lib/config.sh
. "$project_root/scripts/lib/config.sh"

require_absolute_path "$runtime_root" \
  || { local_error 'LOCAL_RUNTIME_ROOT_OVERRIDE must be an absolute path'; exit 1; }
case "$runtime_root" in */.runtime/local) ;; *) local_error 'local runtime root must end with .runtime/local'; exit 1 ;; esac

state_file=$runtime_root/config/local.env
secrets_file=$runtime_root/secrets.env

read_state_value() {
  state_key=$1
  case "$state_key" in
    RUN_ROOT|LOCAL_VITE_PORT|LOCAL_SUBCONVERTER_PORT|LOCAL_MYURLS_PORT|LOCAL_REDIS_PORT|LOCAL_APP_PORT|LOCAL_API_PORT) ;;
    *) return 1 ;;
  esac
  [ -f "$state_file" ] && [ ! -L "$state_file" ] || return 1
  awk -v key="$state_key" '
    index($0, key "=") == 1 { count += 1; value = substr($0, length(key) + 2) }
    END { if (count == 1 && value != "") print value; else exit 1 }
  ' "$state_file"
}

run_root=$(read_state_value RUN_ROOT 2>/dev/null || true)
case "$run_root" in "$runtime_root"/runs/*) ;; *) run_root= ;; esac
case "$run_root" in "$runtime_root"/runs/*/*) run_root= ;; esac

process_owned_and_running() {
  service=$1
  record_file=$runtime_root/pids/$service.pid
  [ -f "$record_file" ] || return 1
  # A symlinked record is a tamper signal: report stale, not stopped.
  [ ! -L "$record_file" ] || return 2
  pid=$(read_process_record_field "$record_file" PID 2>/dev/null || true)
  recorded_service=$(read_process_record_field "$record_file" SERVICE 2>/dev/null || true)
  recorded_run_path=$(read_process_record_field "$record_file" RUN_PATH 2>/dev/null || true)
  case "$pid" in ''|*[!0-9]*) return 2 ;; esac
  [ "$recorded_service" = "$service" ] || return 2
  [ -n "$run_root" ] && [ "$recorded_run_path" = "$run_root" ] || return 2
  recorded_start=$(read_process_record_field "$record_file" PROCESS_START 2>/dev/null || true)
  current_start=$(process_start_identity "$pid" || true)
  [ -n "$recorded_start" ] && [ "$current_start" = "$recorded_start" ] || return 2
  process_is_running "$pid" || return 2
}

http_healthy() {
  curl --noproxy '*' --fail --silent --show-error --max-time 2 "$1" >/dev/null 2>&1
}

redis_healthy() {
  redis_port=$(read_state_value LOCAL_REDIS_PORT 2>/dev/null || true)
  redis_password=$(load_existing_secret "$secrets_file" REDIS_PASSWORD 2>/dev/null || true)
  [ -n "$redis_port" ] || { local_error 'local Redis port state is missing'; return 1; }
  [ -n "$redis_password" ] || { local_error 'local Redis secret is invalid'; return 1; }
  redis_reply=$(REDISCLI_AUTH=$redis_password redis-cli -h 127.0.0.1 -p "$redis_port" --no-auth-warning PING 2>/dev/null || true)
  [ "$redis_reply" = PONG ]
}

required_unhealthy=0
report_service() {
  service=$1
  probe=$2
  if process_owned_and_running "$service"; then
    if "$probe"; then
      printf '%s=healthy\n' "$service"
    else
      printf '%s=unhealthy\n' "$service"
      required_unhealthy=1
    fi
  else
    ownership_status=$?
    if [ "$ownership_status" -eq 1 ]; then
      printf '%s=stopped\n' "$service"
    else
      printf '%s=stale\n' "$service"
    fi
    required_unhealthy=1
  fi
}

probe_myurls() { port=$(read_state_value LOCAL_MYURLS_PORT 2>/dev/null || true); [ -n "$port" ] && http_healthy "http://127.0.0.1:$port/healthz"; }
probe_subconverter() { port=$(read_state_value LOCAL_SUBCONVERTER_PORT 2>/dev/null || true); [ -n "$port" ] && http_healthy "http://127.0.0.1:$port/healthz"; }
probe_vite() { port=$(read_state_value LOCAL_VITE_PORT 2>/dev/null || true); [ -n "$port" ] && http_healthy "http://127.0.0.1:$port/"; }
probe_nginx() { port=$(read_state_value LOCAL_APP_PORT 2>/dev/null || true); [ -n "$port" ] && http_healthy "http://127.0.0.1:$port/healthz"; }

report_service redis redis_healthy
report_service myurls probe_myurls
report_service subconverter probe_subconverter
report_service vite probe_vite
report_service nginx probe_nginx

if process_owned_and_running nginx; then
  api_port=$(read_state_value LOCAL_API_PORT 2>/dev/null || true)
  if [ -n "$api_port" ] && http_healthy "http://127.0.0.1:$api_port/healthz"; then
    printf 'nginx-api=healthy\n'
  else
    printf 'nginx-api=unhealthy\n'
    required_unhealthy=1
  fi
else
  nginx_ownership_status=$?
  [ "$nginx_ownership_status" -eq 1 ] && printf 'nginx-api=stopped\n' || printf 'nginx-api=stale\n'
  required_unhealthy=1
fi

unset redis_password
[ "$required_unhealthy" -eq 0 ]
