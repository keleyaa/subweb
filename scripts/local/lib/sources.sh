#!/bin/sh

source_error() {
  printf 'Local source error: %s\n' "$1" >&2
}

github_repository_from_url() {
  value=${1-}
  case "$value" in
    https://github.com/*) repository=${value#https://github.com/} ;;
    http://github.com/*) repository=${value#http://github.com/} ;;
    git@github.com:*) repository=${value#git@github.com:} ;;
    ssh://git@github.com/*) repository=${value#ssh://git@github.com/} ;;
    *) return 1 ;;
  esac
  repository=${repository%.git}
  case "$repository" in */*) printf '%s\n' "$repository" ;; *) return 1 ;; esac
}

source_remote_matches() {
  expected_repository=$(github_repository_from_url "$1") || return 1
  actual_repository=$(github_repository_from_url "$2") || return 1
  [ "$expected_repository" = "$actual_repository" ]
}

validate_pinned_checkout() {
  checkout=$1
  expected_url=$2
  expected_commit=$3
  [ -d "$checkout" ] && [ -e "$checkout/.git" ] || {
    source_error "source checkout is missing or is not a Git worktree: $checkout"
    return 1
  }
  actual_url=$(git -C "$checkout" remote get-url origin 2>/dev/null) || {
    source_error "cannot read origin from source checkout: $checkout"
    return 1
  }
  source_remote_matches "$expected_url" "$actual_url" || {
    source_error "source checkout origin does not match the locked repository: $checkout"
    return 1
  }
  actual_commit=$(git -C "$checkout" rev-parse HEAD 2>/dev/null) || {
    source_error "cannot read HEAD from source checkout: $checkout"
    return 1
  }
  [ "$actual_commit" = "$expected_commit" ] || {
    source_error "source checkout HEAD does not match locked commit $expected_commit: $checkout"
    return 1
  }
}

ensure_pinned_source() {
  service_name=$1
  source_url=$2
  source_commit=$3
  provided_checkout=${4-}
  cache_root=$5
  case "$service_name" in *[!a-z0-9-]*|'') source_error 'invalid source service name'; return 1 ;; esac
  case "$source_commit" in *[!0-9a-f]*|'') source_error 'invalid source commit'; return 1 ;; esac
  [ "${#source_commit}" -eq 40 ] || { source_error 'source commit must be a full SHA'; return 1; }
  source_repository=$(github_repository_from_url "$source_url") \
    || { source_error 'source URL must be a supported GitHub repository URL'; return 1; }

  if [ -n "$provided_checkout" ]; then
    case "$provided_checkout" in /*) ;; *) source_error 'provided source checkout must be absolute'; return 1 ;; esac
    validate_pinned_checkout "$provided_checkout" "$source_url" "$source_commit" || return 1
    printf '%s\n' "$provided_checkout"
    return 0
  fi

  case "$cache_root" in /*) ;; *) source_error 'source cache root must be absolute'; return 1 ;; esac
  service_cache=$cache_root/$service_name
  checkout=$service_cache/$source_commit
  mkdir -p "$service_cache" || { source_error "cannot create source cache: $service_cache"; return 1; }
  if [ ! -e "$checkout/.git" ]; then
    [ ! -e "$checkout" ] || { source_error "incomplete source cache already exists: $checkout"; return 1; }
    temporary_checkout=$(mktemp -d "$service_cache/.clone.XXXXXX") || return 1
    if ! git clone --no-checkout -- "$source_url" "$temporary_checkout" \
      || ! git -C "$temporary_checkout" checkout --detach "$source_commit"; then
      rm -rf "$temporary_checkout"
      source_error "cannot clone locked source for $service_name"
      return 1
    fi
    if ! mv "$temporary_checkout" "$checkout"; then
      rm -rf "$temporary_checkout"
      source_error "cannot publish locked source cache for $service_name"
      return 1
    fi
  fi
  validate_pinned_checkout "$checkout" "$source_url" "$source_commit" || return 1
  printf '%s\n' "$checkout"
}
