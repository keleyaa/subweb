#!/bin/sh
set -eu

[ "$#" -gt 0 ] || {
  printf '%s\n' 'SubConverter log supervisor requires a command' >&2
  exit 2
}

case "$0" in /*) script_path=$0 ;; *) script_path=$PWD/${0#./} ;; esac
script_directory=$(CDPATH= cd -- "${script_path%/*}" && pwd -P)
filter_file=${SUBWEB_LOG_FILTER:-$script_directory/subconverter-log-filter.awk}
runtime_directory=${SUBWEB_LOG_RUNTIME_DIR:-/tmp}
[ -r "$filter_file" ] || {
  printf '%s\n' 'SubConverter log filter is missing' >&2
  exit 1
}
[ -d "$runtime_directory" ] || {
  printf '%s\n' 'SubConverter log runtime directory is invalid' >&2
  exit 1
}
runtime_directory=$(CDPATH= cd -- "$runtime_directory" && pwd -P) || {
  printf '%s\n' 'SubConverter log runtime directory cannot be resolved' >&2
  exit 1
}

umask 077
fifo="$runtime_directory/subweb-subconverter-log.$$"
mkfifo "$fifo"
child_pid=
filter_pid=

cleanup() {
  [ -n "$child_pid" ] && kill -TERM "$child_pid" 2>/dev/null || true
  [ -n "$filter_pid" ] && kill -TERM "$filter_pid" 2>/dev/null || true
  rm -f "$fifo"
}
forward_signal() {
  [ -n "$child_pid" ] && kill -TERM "$child_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap forward_signal HUP INT TERM

(exec awk -f "$filter_file" < "$fifo") &
filter_pid=$!
(exec "$@") > "$fifo" 2>&1 &
child_pid=$!

set +e
wait "$child_pid"
child_status=$?
set -e
child_pid=

# Drain the filter with a bounded grace period: a grandchild that inherited the
# FIFO write end would otherwise keep awk alive forever and block this wait.
filter_wait_seconds=15
elapsed=0
while kill -0 "$filter_pid" 2>/dev/null && [ "$elapsed" -lt "$filter_wait_seconds" ]; do
  sleep 1
  elapsed=$((elapsed + 1))
done
if kill -0 "$filter_pid" 2>/dev/null; then
  kill -TERM "$filter_pid" 2>/dev/null || true
fi
set +e
wait "$filter_pid"
set -e
filter_pid=
exit "$child_status"
