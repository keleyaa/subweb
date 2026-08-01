#!/bin/sh
set -eu

case "$0" in /*) stop_path=$0 ;; *) stop_path=$PWD/${0#./} ;; esac
script_directory=$(CDPATH= cd -- "${stop_path%/*}" && pwd -P)
project_root=$(CDPATH= cd -- "$script_directory/../.." && pwd -P)
runtime_root=${LOCAL_RUNTIME_ROOT_OVERRIDE:-$project_root/.runtime/local}

# shellcheck source=lib/common.sh
. "$script_directory/lib/common.sh"
# shellcheck source=lib/processes.sh
. "$script_directory/lib/processes.sh"

require_absolute_path "$runtime_root" \
  || { local_error 'LOCAL_RUNTIME_ROOT_OVERRIDE must be an absolute path'; exit 1; }
case "$runtime_root" in */.runtime/local) ;; *) local_error 'local runtime root must end with .runtime/local'; exit 1 ;; esac

state_file=$runtime_root/config/local.env
active_run_file=$runtime_root/active-run
run_root=
if [ -f "$state_file" ] && [ ! -L "$state_file" ]; then
  run_root=$(awk 'index($0, "RUN_ROOT=") == 1 { count += 1; value = substr($0, 10) } END { if (count == 1) print value; else exit 1 }' "$state_file" 2>/dev/null || true)
fi
if [ -z "$run_root" ] && [ -f "$active_run_file" ] && [ ! -L "$active_run_file" ]; then
  IFS= read -r run_root < "$active_run_file" || true
fi
case "$run_root" in "$runtime_root"/runs/*) ;; *) run_root= ;; esac

stop_failed=0
for service in nginx vite subconverter myurls redis; do
  if stop_owned_process "$runtime_root/pids/$service.pid"; then
    printf '%s=stopped\n' "$service"
  else
    printf '%s=unhealthy\n' "$service"
    stop_failed=1
  fi
done

rm -f "$state_file" "$active_run_file"
[ -z "$run_root" ] || rm -rf "$run_root"

[ "$stop_failed" -eq 0 ]
