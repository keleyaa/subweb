#!/bin/sh

# A small POSIX lock for deployment files. mkdir is atomic, and callers must
# release the saved directory from an EXIT/signal trap.
acquire_path_lock() {
  lock_target=$1
  lock_directory=$lock_target.lock
  lock_attempt=0
  while ! mkdir "$lock_directory" 2>/dev/null; do
    lock_attempt=$((lock_attempt + 1))
    [ "$lock_attempt" -lt 30 ] || return 1
    sleep 1
  done
  PATH_LOCK_DIRECTORY=$lock_directory
  export PATH_LOCK_DIRECTORY
}

release_path_lock() {
  lock_directory=${1-}
  [ -n "$lock_directory" ] || return 0
  rmdir "$lock_directory" 2>/dev/null || return 1
}
