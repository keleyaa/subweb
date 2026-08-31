#!/bin/sh

local_script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
local_project_root=$(CDPATH= cd -- "$local_script_directory/../.." && pwd -P)
local_runtime_directory=$local_project_root/.runtime/local
local_env_file=$local_runtime_directory/compose.env
local_project_name=${SUBWEB_LOCAL_PROJECT_NAME:-subweb-local}
local_myurls_port=${LOCAL_MYURLS_PORT:-18082}
local_short_myurls_port=${LOCAL_SHORT_MYURLS_PORT:-18083}
local_subconverter_port=${LOCAL_SUBCONVERTER_PORT:-25500}
local_vite_port=${LOCAL_VITE_PORT:-5173}

local_fail() {
  printf 'Local development error: %s\n' "$1" >&2
  exit 1
}

validate_local_port() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -ge 1024 ] 2>/dev/null && [ "$1" -le 65535 ]
}

prepare_local_environment() {
  command -v docker >/dev/null 2>&1 || local_fail 'docker is required.'
  command -v openssl >/dev/null 2>&1 || local_fail 'openssl is required.'
  for port in "$local_myurls_port" "$local_short_myurls_port" "$local_subconverter_port" "$local_vite_port"; do
    validate_local_port "$port" || local_fail 'local ports must be integers from 1024 to 65535.'
  done
  [ "$local_myurls_port" != "$local_subconverter_port" ] \
    && [ "$local_myurls_port" != "$local_short_myurls_port" ] \
    && [ "$local_myurls_port" != "$local_vite_port" ] \
    && [ "$local_short_myurls_port" != "$local_subconverter_port" ] \
    && [ "$local_short_myurls_port" != "$local_vite_port" ] \
    && [ "$local_subconverter_port" != "$local_vite_port" ] \
    || local_fail 'local ports must be distinct.'

  export LOCAL_MYURLS_PORT="$local_myurls_port"
  export LOCAL_SHORT_MYURLS_PORT="$local_short_myurls_port"
  export LOCAL_SUBCONVERTER_PORT="$local_subconverter_port"
  export LOCAL_VITE_PORT="$local_vite_port"

  mkdir -p "$local_runtime_directory"
  chmod 0700 "$local_runtime_directory"
  if [ ! -f "$local_env_file" ]; then
    redis_password=$(openssl rand -hex 32) || local_fail 'unable to generate Redis password.'
    ip_hash_secret=$(openssl rand -hex 32) || local_fail 'unable to generate IP hash secret.'
    temporary_env=$local_env_file.tmp.$$
    trap 'rm -f "$temporary_env"' EXIT HUP INT TERM
    {
      printf '%s\n' \
        'APP_DOMAIN=app.local.test' \
        'API_DOMAIN=api.local.test' \
        "API_URL=http://127.0.0.1:$local_subconverter_port" \
        'SHORT_DOMAIN=short.local.test' \
        "REDIS_PASSWORD=$redis_password" \
        "IP_HASH_SECRET=$ip_hash_secret" \
        'TURNSTILE_SITE_KEY=local-placeholder-site-key' \
        'TURNSTILE_SECRET_KEY=local-placeholder-secret-key'
    } > "$temporary_env" || local_fail 'unable to write local environment.'
    chmod 0600 "$temporary_env"
    mv "$temporary_env" "$local_env_file"
    trap - EXIT HUP INT TERM
  fi
  [ -f "$local_env_file" ] && [ ! -L "$local_env_file" ] \
    || local_fail 'local environment must be a regular file.'

  temporary_env=$local_env_file.tmp.$$
  if grep -q '^API_URL=' "$local_env_file"; then
    sed "s#^API_URL=.*#API_URL=http://127.0.0.1:$local_subconverter_port#" "$local_env_file" > "$temporary_env" \
      || local_fail 'unable to update local API URL.'
  else
    cp "$local_env_file" "$temporary_env" \
      || local_fail 'unable to prepare local environment update.'
    printf '%s\\n' "API_URL=http://127.0.0.1:$local_subconverter_port" >> "$temporary_env" \
      || local_fail 'unable to add local API URL.'
  fi
  chmod 0600 "$temporary_env"
  mv "$temporary_env" "$local_env_file" \
    || local_fail 'unable to update local environment.'

  export COMPOSE_FILE=$local_project_root/compose.yaml:$local_project_root/compose.dev.yaml
  export COMPOSE_ENV_FILES=$local_env_file
  export COMPOSE_PROJECT_NAME=$local_project_name
}
