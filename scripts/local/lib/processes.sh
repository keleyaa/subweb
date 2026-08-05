#!/bin/sh

process_error() {
  printf 'Local process error: %s\n' "$1" >&2
}

read_process_record_field() {
  record_file=$1
  field_name=$2
  awk -v key="$field_name" '
    index($0, key "=") == 1 { count += 1; value = substr($0, length(key) + 2) }
    END { if (count == 1 && value != "") print value; else exit 1 }
  ' "$record_file"
}

write_process_record() {
  record_file=$1
  pid=$2
  service=$3
  run_path=$4
  started_at=$5
  health_url=$6
  process_start=$7
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ -n "$process_start" ] || return 1
  case "$run_path" in /*/.runtime/local/*) ;; *) return 1 ;; esac
  record_directory=${record_file%/*}
  [ "$record_directory" != "$record_file" ] || return 1
  mkdir -p "$record_directory" || return 1
  temporary_record=$(mktemp "$record_directory/.process-record.XXXXXX") || return 1
  umask 077
  {
    printf 'PID=%s\n' "$pid"
    printf 'SERVICE=%s\n' "$service"
    printf 'RUN_PATH=%s\n' "$run_path"
    printf 'STARTED_AT=%s\n' "$started_at"
    printf 'HEALTH_URL=%s\n' "$health_url"
    printf 'PROCESS_START=%s\n' "$process_start"
  } > "$temporary_record" || { rm -f "$temporary_record"; return 1; }
  chmod 0600 "$temporary_record" || { rm -f "$temporary_record"; return 1; }
  mv -f "$temporary_record" "$record_file" || { rm -f "$temporary_record"; return 1; }
}

process_command() {
  process_ps_bin=${PROCESS_PS_BIN:-ps}
  "$process_ps_bin" -p "$1" -o command= 2>/dev/null
}

process_start_identity() {
  process_ps_bin=${PROCESS_PS_BIN:-ps}
  TZ=UTC LC_ALL=C "$process_ps_bin" -p "$1" -o lstart= 2>/dev/null | awk '{$1=$1; print}'
}

process_is_running() {
  pid=$1
  kill -0 "$pid" 2>/dev/null || return 1
  process_ps_bin=${PROCESS_PS_BIN:-ps}
  state=$("$process_ps_bin" -p "$pid" -o stat= 2>/dev/null | awk '{ print $1 }')
  case "$state" in ''|Z*) return 1 ;; *) return 0 ;; esac
}

remove_stale_process_record() {
  record_file=$1
  service=${2-unknown}
  process_error "stale PID record removed for $service"
  rm -f "$record_file"
}

stop_owned_process() {
  record_file=${1-}
  [ -f "$record_file" ] && [ ! -L "$record_file" ] || return 0

  pid=$(read_process_record_field "$record_file" PID 2>/dev/null || true)
  service=$(read_process_record_field "$record_file" SERVICE 2>/dev/null || true)
  run_path=$(read_process_record_field "$record_file" RUN_PATH 2>/dev/null || true)
  case "$pid" in ''|*[!0-9]*) remove_stale_process_record "$record_file" "${service:-unknown}"; return 0 ;; esac
  case "$run_path" in /*/.runtime/local/*) ;; *) remove_stale_process_record "$record_file" "${service:-unknown}"; return 0 ;; esac

  recorded_start=$(read_process_record_field "$record_file" PROCESS_START 2>/dev/null || true)
  current_start=$(process_start_identity "$pid" || true)
  [ -n "$recorded_start" ] && [ "$current_start" = "$recorded_start" ] \
    || { remove_stale_process_record "$record_file" "${service:-unknown}"; return 0; }

  if process_is_running "$pid"; then
    kill -TERM "$pid" 2>/dev/null || {
      process_error "cannot terminate owned process $service ($pid)"
      return 1
    }
  fi

  timeout=${PROCESS_STOP_TIMEOUT:-10}
  case "$timeout" in ''|*[!0-9]*) timeout=10 ;; esac
  elapsed=0
  while process_is_running "$pid" && [ "$elapsed" -lt "$timeout" ]; do
    sleep 1
    elapsed=$((elapsed + 1))
  done
  if process_is_running "$pid"; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$record_file"
}
