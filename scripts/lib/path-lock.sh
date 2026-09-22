#!/bin/sh

# A small POSIX lock for deployment files. Each caller initializes a private
# candidate directory before atomically publishing its canonical lock symlink.
path_lock_directory_for_target() {
  path_lock_target=${1-}
  [ -n "$path_lock_target" ] || return 1
  path_lock_target_parent=$(dirname "$path_lock_target") || return 1
  path_lock_target_name=$(basename "$path_lock_target") || return 1
  path_lock_target_parent=$(CDPATH='' cd -- "$path_lock_target_parent" && pwd -P) || return 1
  printf '%s/%s.lock\n' "$path_lock_target_parent" "$path_lock_target_name"
}

path_lock_read_owner() {
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  path_lock_owner=$(cat "$1" 2>/dev/null) || return 1
  path_lock_owner_pid=${path_lock_owner%%|*}
  path_lock_owner_token=${path_lock_owner#*|}
  case "$path_lock_owner_pid" in
    ''|0|*[!0-9]*) return 1 ;;
  esac
  [ -n "$path_lock_owner_token" ] || return 1
  [ "$path_lock_owner" = "$path_lock_owner_pid|$path_lock_owner_token" ] || return 1
  PATH_LOCK_OWNER=$path_lock_owner
  PATH_LOCK_OWNER_TOKEN=$path_lock_owner_token
}

path_lock_owner_token_matches_lock() {
  path_lock_owner_token=$1
  path_lock_directory=$2
  path_lock_candidate_prefix=$path_lock_directory.candidate.
  path_lock_candidate_suffix=${path_lock_owner_token#"$path_lock_candidate_prefix"}
  [ "$path_lock_candidate_suffix" != "$path_lock_owner_token" ] || return 1
  [ -n "$path_lock_candidate_suffix" ] || return 1
  case "$path_lock_candidate_suffix" in
    */*) return 1 ;;
  esac
}

path_lock_owner_record_for_lock() {
  path_lock_read_owner "$1" || return 1
  path_lock_owner_token_matches_lock "$PATH_LOCK_OWNER_TOKEN" "$2"
}

path_lock_owner_is_initialized_for_lock() {
  path_lock_owner_record_for_lock "$1" "$2" || return 1
  [ -d "$PATH_LOCK_OWNER_TOKEN" ] && [ ! -L "$PATH_LOCK_OWNER_TOKEN" ] || return 1
  path_lock_owner_directory=$(CDPATH='' cd -- "$PATH_LOCK_OWNER_TOKEN" && pwd -P) || return 1
  [ "$path_lock_owner_directory" = "$PATH_LOCK_OWNER_TOKEN" ] || return 1
  [ -f "$PATH_LOCK_OWNER_TOKEN/owner" ] && [ ! -L "$PATH_LOCK_OWNER_TOKEN/owner" ] || return 1
  path_lock_owner_copy=$(cat "$PATH_LOCK_OWNER_TOKEN/owner" 2>/dev/null) || return 1
  [ "$path_lock_owner_copy" = "$PATH_LOCK_OWNER" ]
}

path_lock_files_share_inode() {
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  [ -f "$2" ] && [ ! -L "$2" ] || return 1
  case "$(uname -s)" in
    Darwin|FreeBSD|NetBSD|OpenBSD)
      path_lock_first_identity=$(stat -f '%d:%i' "$1" 2>/dev/null) || return 1
      path_lock_second_identity=$(stat -f '%d:%i' "$2" 2>/dev/null) || return 1
      ;;
    Linux)
      path_lock_first_identity=$(stat -c '%d:%i' "$1" 2>/dev/null) || return 1
      path_lock_second_identity=$(stat -c '%d:%i' "$2" 2>/dev/null) || return 1
      ;;
    *) return 1 ;;
  esac
  [ "$path_lock_first_identity" = "$path_lock_second_identity" ]
}

path_lock_owner_is_active() {
  path_lock_owner_pid=${1%%|*}
  case "$path_lock_owner_pid" in
    ''|0|*[!0-9]*) return 1 ;;
  esac
  path_lock_kill_error=$(LC_ALL=C kill -0 "$path_lock_owner_pid" 2>&1) && return 0
  case "$path_lock_kill_error" in
    *'No such process'*) return 1 ;;
    *) return 0 ;;
  esac
}

path_lock_has_recovery_marker() {
  for path_lock_recovery_marker in "$1"/recovery "$1"/recovery.*; do
    [ -e "$path_lock_recovery_marker" ] || [ -L "$path_lock_recovery_marker" ] || continue
    return 0
  done
  return 1
}

path_lock_candidate_has_legacy_recovery() {
  for path_lock_recovery_marker in "$1"/recovery.*; do
    [ -e "$path_lock_recovery_marker" ] || [ -L "$path_lock_recovery_marker" ] || continue
    return 0
  done
  return 1
}

path_lock_guard_prepare() {
  path_lock_guard_directory=$1
  [ ! -L "$path_lock_guard_directory" ] || return 1
  if [ -e "$path_lock_guard_directory" ]; then
    [ -d "$path_lock_guard_directory" ] || return 1
  else
    (umask 077; mkdir -m 700 "$path_lock_guard_directory") 2>/dev/null || [ -d "$path_lock_guard_directory" ] || return 1
  fi
  [ ! -L "$path_lock_guard_directory" ] && [ -d "$path_lock_guard_directory" ] || return 1
  chmod 700 "$path_lock_guard_directory" || return 1
  [ ! -L "$path_lock_guard_directory" ] && [ -d "$path_lock_guard_directory" ] || return 1
  ! path_lock_has_recovery_marker "$path_lock_guard_directory"
}

path_lock_guard_follow_successors() {
  path_lock_guard_tail=$1
  path_lock_directory=$2
  path_lock_guard_chain=$path_lock_guard_tail
  while :; do
    path_lock_candidate_has_legacy_recovery "$path_lock_guard_tail" && return 1
    [ -L "$path_lock_guard_tail/recovery" ] && return 1
    if [ ! -e "$path_lock_guard_tail/recovery" ]; then
      path_lock_owner_is_initialized_for_lock "$path_lock_guard_tail/owner" "$path_lock_directory" || return 1
      PATH_LOCK_GUARD_TAIL=$path_lock_guard_tail
      PATH_LOCK_GUARD_CHAIN=$path_lock_guard_chain
      return 0
    fi
    [ -f "$path_lock_guard_tail/recovery" ] || return 1
    path_lock_owner_is_initialized_for_lock "$path_lock_guard_tail/recovery" "$path_lock_directory" || return 1
    path_lock_guard_next=$PATH_LOCK_OWNER_TOKEN
    path_lock_files_share_inode "$path_lock_guard_tail/recovery" "$path_lock_guard_next/owner" || return 1
    if printf '%s\n' "$path_lock_guard_chain" | grep -F -x -- "$path_lock_guard_next" >/dev/null; then
      return 1
    fi
    path_lock_guard_chain="${path_lock_guard_chain}
$path_lock_guard_next"
    path_lock_guard_tail=$path_lock_guard_next
  done
}

path_lock_guard_cleanup_predecessors() {
  path_lock_guard_candidate=$1
  printf '%s\n' "${PATH_LOCK_GUARD_CHAIN-}" | while IFS= read -r path_lock_guard_predecessor; do
    [ -n "$path_lock_guard_predecessor" ] || continue
    [ "$path_lock_guard_predecessor" = "$path_lock_guard_candidate" ] && continue
    rm -f "$path_lock_guard_predecessor/recovery" 2>/dev/null || true
    rm -f "$path_lock_guard_predecessor/owner" 2>/dev/null || true
    rmdir "$path_lock_guard_predecessor" 2>/dev/null || true
  done
}

path_lock_guard_acquire() {
  path_lock_guard_directory=$1
  path_lock_candidate=$2
  path_lock_directory=$3
  path_lock_guard_prepare "$path_lock_guard_directory" || return 1

  path_lock_guard_attempt=0
  while :; do
    if [ -L "$path_lock_guard_directory/owner" ]; then
      return 1
    elif [ -e "$path_lock_guard_directory/owner" ]; then
      path_lock_owner_is_initialized_for_lock "$path_lock_guard_directory/owner" "$path_lock_directory" || return 1
      path_lock_guard_root=$PATH_LOCK_OWNER_TOKEN
      path_lock_files_share_inode "$path_lock_guard_directory/owner" "$path_lock_guard_root/owner" || return 1
      path_lock_guard_follow_successors "$path_lock_guard_root" "$path_lock_directory" || return 1
      if [ "$PATH_LOCK_GUARD_TAIL" = "$path_lock_candidate" ] &&
        [ "$PATH_LOCK_OWNER" = "$$|$path_lock_candidate" ]; then
        PATH_LOCK_GUARD_ROOT=$path_lock_guard_root
        return 0
      fi
      if ! path_lock_owner_is_active "$PATH_LOCK_OWNER" &&
        ln "$path_lock_candidate/owner" "$PATH_LOCK_GUARD_TAIL/recovery" 2>/dev/null; then
        continue
      fi
    elif ln "$path_lock_candidate/owner" "$path_lock_guard_directory/owner" 2>/dev/null; then
      PATH_LOCK_GUARD_ROOT=$path_lock_candidate
      PATH_LOCK_GUARD_TAIL=$path_lock_candidate
      return 0
    fi

    path_lock_guard_attempt=$((path_lock_guard_attempt + 1))
    if [ "$path_lock_guard_attempt" -ge 30 ]; then
      unset PATH_LOCK_GUARD_ROOT PATH_LOCK_GUARD_TAIL
      return 1
    fi
    sleep 1
  done
}

path_lock_guard_release() {
  path_lock_guard_directory=$1
  path_lock_candidate=$2
  path_lock_directory=$3
  path_lock_guard_root=${PATH_LOCK_GUARD_ROOT-}
  [ -n "$path_lock_guard_root" ] || return 1
  [ ! -L "$path_lock_guard_directory/owner" ] && [ -f "$path_lock_guard_directory/owner" ] || return 1
  path_lock_owner_is_initialized_for_lock "$path_lock_guard_directory/owner" "$path_lock_directory" || return 1
  [ "$PATH_LOCK_OWNER_TOKEN" = "$path_lock_guard_root" ] || return 1
  path_lock_files_share_inode "$path_lock_guard_directory/owner" "$path_lock_guard_root/owner" || return 1
  path_lock_guard_follow_successors "$path_lock_guard_root" "$path_lock_directory" || return 1
  [ "$PATH_LOCK_GUARD_TAIL" = "$path_lock_candidate" ] || return 1
  [ "$PATH_LOCK_OWNER" = "$$|$path_lock_candidate" ] || return 1

  rm -f "$path_lock_guard_directory/owner" 2>/dev/null || return 1
  path_lock_guard_cleanup_predecessors "$path_lock_candidate"
  unset PATH_LOCK_GUARD_ROOT PATH_LOCK_GUARD_TAIL PATH_LOCK_GUARD_CHAIN
}

path_lock_cleanup_stale_candidate() {
  path_lock_stale_candidate=$1
  path_lock_stale_owner=$2
  [ -d "$path_lock_stale_candidate" ] || return 0
  path_lock_stale_owner_copy=$(cat "$path_lock_stale_candidate/owner" 2>/dev/null) || return 0
  [ "$path_lock_stale_owner_copy" = "$path_lock_stale_owner" ] || return 0
  rm -f "$path_lock_stale_candidate/owner" 2>/dev/null || return 0
  rmdir "$path_lock_stale_candidate" 2>/dev/null || true
}

acquire_path_lock() {
  lock_directory=$(path_lock_directory_for_target "${1-}") || return 1
  lock_guard_directory=$lock_directory.guard
  lock_candidate_parent=${lock_directory%/*}
  lock_candidate=$(mktemp -d "$lock_candidate_parent/${lock_directory##*/}.candidate.XXXXXX") || return 1
  lock_token=$lock_candidate
  lock_owner_file=$lock_candidate/owner
  if ! printf '%s|%s\n' "$$" "$lock_token" > "$lock_owner_file"; then
    rmdir "$lock_candidate" 2>/dev/null || true
    return 1
  fi

  lock_attempt=0
  while :; do
    if ! path_lock_guard_acquire "$lock_guard_directory" "$lock_candidate" "$lock_directory"; then
      rm -f "$lock_owner_file" 2>/dev/null || true
      rmdir "$lock_candidate" 2>/dev/null || true
      return 1
    fi

    lock_wait_for_owner=0
    lock_stale_candidate=''
    lock_stale_owner=''
    if [ -L "$lock_directory" ]; then
      lock_published_target=$(readlink "$lock_directory" 2>/dev/null) || lock_wait_for_owner=1
      if [ "$lock_wait_for_owner" -eq 0 ] && [ ! -e "$lock_directory" ]; then
        rm -f "$lock_directory" 2>/dev/null || lock_wait_for_owner=1
      elif [ "$lock_wait_for_owner" -eq 0 ] && [ -f "$lock_directory/owner" ] &&
        path_lock_owner_is_initialized_for_lock "$lock_directory/owner" "$lock_directory" &&
        [ "$PATH_LOCK_OWNER_TOKEN" = "$lock_published_target" ]; then
        lock_stale_owner=$PATH_LOCK_OWNER
        lock_stale_candidate=$PATH_LOCK_OWNER_TOKEN
        if path_lock_owner_is_active "$lock_stale_owner"; then
          lock_wait_for_owner=1
        else
          if ! rm -f "$lock_directory" 2>/dev/null; then
            lock_wait_for_owner=1
          fi
        fi
      else
        lock_wait_for_owner=1
      fi
    elif [ -e "$lock_directory" ]; then
      lock_wait_for_owner=1
    fi

    if [ "$lock_wait_for_owner" -eq 0 ] && [ ! -e "$lock_directory" ] && [ ! -L "$lock_directory" ]; then
      if ln -s "$lock_candidate" "$lock_directory" 2>/dev/null; then
        lock_published_target=$(readlink "$lock_directory" 2>/dev/null || printf '')
        if [ "$lock_published_target" = "$lock_candidate" ] &&
          path_lock_guard_release "$lock_guard_directory" "$lock_candidate" "$lock_directory"; then
          [ -z "$lock_stale_candidate" ] || path_lock_cleanup_stale_candidate "$lock_stale_candidate" "$lock_stale_owner"
          PATH_LOCK_DIRECTORY=$lock_directory
          PATH_LOCK_TOKEN=$lock_token
          export PATH_LOCK_DIRECTORY PATH_LOCK_TOKEN
          return 0
        fi
        path_lock_guard_release "$lock_guard_directory" "$lock_candidate" "$lock_directory" || true
        return 1
      fi
    fi

    path_lock_guard_release "$lock_guard_directory" "$lock_candidate" "$lock_directory" || return 1
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
  path_lock_owner_is_initialized_for_lock "$lock_directory/owner" "$lock_directory" || return 1
  [ "$PATH_LOCK_OWNER_TOKEN" = "$lock_token" ]
}

release_path_lock() {
  lock_directory=${1-}
  [ -n "$lock_directory" ] || return 0
  [ -L "$lock_directory" ] && [ -f "$lock_directory/owner" ] || return 1
  path_lock_owner_is_initialized_for_lock "$lock_directory/owner" "$lock_directory" || return 1
  lock_owner=$PATH_LOCK_OWNER
  lock_owner_token=$PATH_LOCK_OWNER_TOKEN
  [ "$lock_owner" = "$$|$lock_owner_token" ] || return 1
  [ "$(readlink "$lock_directory" 2>/dev/null || printf '')" = "$lock_owner_token" ] || return 1

  lock_guard_directory=$lock_directory.guard
  lock_candidate_parent=$(dirname "$lock_owner_token") || return 1
  path_lock_guard_acquire "$lock_guard_directory" "$lock_owner_token" "$lock_directory" || return 1

  if ! path_lock_owner_is_initialized_for_lock "$lock_directory/owner" "$lock_directory" ||
    [ "$PATH_LOCK_OWNER" != "$$|$lock_owner_token" ] ||
    [ "$(readlink "$lock_directory" 2>/dev/null || printf '')" != "$lock_owner_token" ]; then
    path_lock_guard_release "$lock_guard_directory" "$lock_owner_token" "$lock_directory" || true
    return 1
  fi
  rm -f "$lock_directory" 2>/dev/null || return 1
  path_lock_guard_release "$lock_guard_directory" "$lock_owner_token" "$lock_directory" || return 1
  rm -f "$lock_owner_token/owner" 2>/dev/null || return 1
  rmdir "$lock_owner_token" 2>/dev/null || return 1
}
