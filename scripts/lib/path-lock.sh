#!/bin/sh

# A small POSIX lock for deployment files. mkdir is atomic, and callers must
# release the saved directory from an EXIT/signal trap.
acquire_path_lock() {
  lock_target=$1
  lock_directory=$lock_target.lock
  lock_attempt=0
  while ! mkdir "$lock_directory" 2>/dev/null; do
    if [ -f "$lock_directory/owner" ]; then
      lock_owner=$(cat "$lock_directory/owner" 2>/dev/null || printf '')
      lock_owner_pid=${lock_owner%%|*}
      case "$lock_owner_pid" in
        ''|*[!0-9]*) lock_owner_pid=0 ;;
      esac
      if [ "$lock_owner_pid" -eq 0 ] || ! kill -0 "$lock_owner_pid" 2>/dev/null; then
        rm -f "$lock_directory/owner" 2>/dev/null || true
        rmdir "$lock_directory" 2>/dev/null || true
        continue
      fi
    fi
    lock_attempt=$((lock_attempt + 1))
    [ "$lock_attempt" -lt 30 ] || return 1
    sleep 1
  done
  lock_token=$lock_directory/$$
  lock_owner_file=$lock_directory/owner.$$
  if ! printf '%s|%s\n' "$$" "$lock_token" > "$lock_owner_file" \
    || ! mv "$lock_owner_file" "$lock_directory/owner"; then
    rm -f "$lock_owner_file" "$lock_directory/owner"
    rmdir "$lock_directory"
    return 1
  fi
  PATH_LOCK_DIRECTORY=$lock_directory
  PATH_LOCK_TOKEN=$lock_token
  export PATH_LOCK_DIRECTORY PATH_LOCK_TOKEN
}

validate_path_lock_handoff() {
  lock_directory=${1-}
  lock_token=${2-}
  [ -n "$lock_directory" ] && [ -n "$lock_token" ] || return 1
  [ -f "$lock_directory/owner" ] || return 1
  lock_owner=$(cat "$lock_directory/owner" 2>/dev/null || return 1)
  [ "$lock_owner" = "${lock_owner%%|*}|$lock_token" ] || return 1
}

release_path_lock() {
  lock_directory=${1-}
  [ -n "$lock_directory" ] || return 0
  [ -f "$lock_directory/owner" ] || return 1
  lock_owner=$(cat "$lock_directory/owner" 2>/dev/null || return 1)
  lock_owner_pid=${lock_owner%%|*}
  [ "$lock_owner_pid" = "$$" ] || return 1
  rm -f "$lock_directory/owner" 2>/dev/null || return 1
  rmdir "$lock_directory" 2>/dev/null || return 1
}
