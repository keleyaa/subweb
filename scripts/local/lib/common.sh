#!/bin/sh

local_error() {
  printf 'Local runtime error: %s\n' "$1" >&2
}

local_fail() {
  local_error "$1"
  return 1
}

require_absolute_path() {
  case ${1-} in
    /*) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_private_directory() {
  directory=${1-}
  require_absolute_path "$directory" || local_fail 'runtime directory must be absolute'
  [ ! -L "$directory" ] || local_fail "runtime directory cannot be a symlink: $directory"
  mkdir -p "$directory" || local_fail "cannot create runtime directory: $directory"
  chmod 0700 "$directory" || local_fail "cannot secure runtime directory: $directory"
  permissions=$(LC_ALL=C ls -ld "$directory" 2>/dev/null | awk '{ print substr($1, 1, 10) }')
  [ -d "$directory" ] && [ "$permissions" = drwx------ ] \
    || local_fail "runtime directory is not private: $directory"
}

is_local_env_key_allowed() {
  case ${1-} in
    LOCAL_VITE_PORT|LOCAL_SUBCONVERTER_PORT|LOCAL_MYURLS_PORT|LOCAL_REDIS_PORT|LOCAL_APP_PORT|LOCAL_API_PORT|TRUSTED_PROXY_CIDR|MYURLS_SOURCE_DIR|SUBCONVERTER_SOURCE_DIR|BUILD_JOBS)
      return 0
      ;;
    *) return 1 ;;
  esac
}

read_local_env_value() {
  env_file=${1-}
  env_key=${2-}
  is_local_env_key_allowed "$env_key" || local_fail "environment key is not allowed: $env_key"
  [ -f "$env_file" ] && [ ! -L "$env_file" ] || return 1
  awk -v key="$env_key" '
    index($0, key "=") == 1 { count += 1; value = substr($0, length(key) + 2) }
    END { if (count == 1) print value; else exit 1 }
  ' "$env_file"
}
