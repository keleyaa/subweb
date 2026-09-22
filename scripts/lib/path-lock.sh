#!/bin/sh

# A small POSIX lock for deployment files. Each caller initializes a private
# candidate directory before atomically publishing its canonical lock symlink.
acquire_path_lock() {
  lock_target=$1
  lock_directory=$lock_target.lock
  lock_candidate_directory=$(dirname "$lock_directory") || return 1
  lock_candidate_parent=$(CDPATH='' cd -- "$lock_candidate_directory" && pwd -P) || return 1
  lock_candidate=$(mktemp -d "$lock_candidate_parent/$(basename "$lock_directory").candidate.XXXXXX") || return 1
  lock_token=$lock_candidate
  lock_owner_file=$lock_candidate/owner
  lock_candidate_name=$(basename "$lock_candidate") || return 1
  if ! printf '%s|%s\n' "$$" "$lock_token" > "$lock_owner_file"; then
    rmdir "$lock_candidate" 2>/dev/null || true
    return 1
  fi

  lock_attempt=0
  while :; do
    if [ ! -e "$lock_directory" ] && [ ! -L "$lock_directory" ]; then
      if ln -s "$lock_candidate" "$lock_directory" 2>/dev/null; then
        lock_published_target=$(readlink "$lock_directory" 2>/dev/null || printf '')
        if [ "$lock_published_target" = "$lock_candidate" ]; then
          PATH_LOCK_DIRECTORY=$lock_directory
          PATH_LOCK_TOKEN=$lock_token
          export PATH_LOCK_DIRECTORY PATH_LOCK_TOKEN
          return 0
        fi
        rm -f "$lock_directory/$lock_candidate_name" 2>/dev/null || true
      fi
    elif [ -L "$lock_directory" ] && [ ! -e "$lock_directory" ]; then
      rm -f "$lock_directory" 2>/dev/null || true
      continue
    elif [ -L "$lock_directory" ] && [ -f "$lock_directory/owner" ]; then
      lock_owner=$(cat "$lock_directory/owner" 2>/dev/null || printf '')
      lock_owner_pid=${lock_owner%%|*}
      lock_owner_token=${lock_owner#*|}
      case "$lock_owner_pid" in
        ''|*[!0-9]*) lock_owner_pid=0 ;;
      esac
      if [ "$lock_owner_pid" -eq 0 ] || ! kill -0 "$lock_owner_pid" 2>/dev/null; then
        lock_published_target=$(readlink "$lock_directory" 2>/dev/null || printf '')
        if [ "$lock_published_target" = "$lock_owner_token" ]; then
          rm -f "$lock_directory" 2>/dev/null || true
        fi
        continue
      fi
    fi
    lock_attempt=$((lock_attempt + 1))
    if [ "$lock_attempt" -ge 30 ]; then
      rm -f "$lock_owner_file" 2>/dev/null || true
      rmdir "$lock_candidate" 2>/dev/null || true
      return 1
    fi
    sleep 1
  done
}

validate_path_lock_handoff() {
  lock_directory=${1-}
  lock_token=${2-}
  [ -n "$lock_directory" ] && [ -n "$lock_token" ] || return 1
  [ -L "$lock_directory" ] && [ -f "$lock_directory/owner" ] || return 1
  [ "$(readlink "$lock_directory" 2>/dev/null || printf '')" = "$lock_token" ] || return 1
  lock_owner=$(cat "$lock_directory/owner" 2>/dev/null || return 1)
  [ "$lock_owner" = "${lock_owner%%|*}|$lock_token" ] || return 1
}

release_path_lock() {
  lock_directory=${1-}
  [ -n "$lock_directory" ] || return 0
  [ -L "$lock_directory" ] && [ -f "$lock_directory/owner" ] || return 1
  lock_owner=$(cat "$lock_directory/owner" 2>/dev/null || return 1)
  lock_owner_pid=${lock_owner%%|*}
  lock_owner_token=${lock_owner#*|}
  [ "$lock_owner" = "$$|$lock_owner_token" ] || return 1
  [ "$(readlink "$lock_directory" 2>/dev/null || printf '')" = "$lock_owner_token" ] || return 1
  rm -f "$lock_directory" 2>/dev/null || return 1
  rm -f "$lock_owner_token/owner" 2>/dev/null || return 1
  rmdir "$lock_owner_token" 2>/dev/null || return 1
}
