#!/bin/sh

local_script_directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
local_project_root=$(CDPATH='' cd -- "$local_script_directory/../.." && pwd -P)
local_runtime_directory=$local_project_root/.runtime/local
local_env_file=$local_runtime_directory/compose.env
local_project_name=${SUBWEB_LOCAL_PROJECT_NAME:-subweb-local}
local_subweb_port=${LOCAL_SUBWEB_PORT:-18081}
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
  command -v node >/dev/null 2>&1 || local_fail 'node is required.'
  command -v openssl >/dev/null 2>&1 || local_fail 'openssl is required.'
  for port in "$local_subweb_port" "$local_vite_port"; do
    validate_local_port "$port" || local_fail 'local ports must be integers from 1024 to 65535.'
  done
  [ "$local_subweb_port" != "$local_vite_port" ] || local_fail 'local ports must be distinct.'

  export LOCAL_SUBWEB_PORT="$local_subweb_port"
  export LOCAL_VITE_PORT="$local_vite_port"

  mkdir -p "$local_runtime_directory"
  chmod 0700 "$local_runtime_directory"
  if [ ! -f "$local_env_file" ]; then
    ip_hash_secret=$(openssl rand -hex 32) || local_fail 'unable to generate IP hash secret.'
    temporary_env=$local_env_file.tmp.$$
    trap 'rm -f "$temporary_env"' 0
    trap 'rm -f "$temporary_env"; exit 1' HUP INT TERM
    {
      printf '%s\n' \
        'APP_DOMAIN=app.local.test' \
        'API_DOMAIN=api.local.test' \
        "API_URL=http://127.0.0.1:$local_subweb_port" \
        'SHORT_DOMAIN=short.local.test' \
        "SUBWEB_PORT=$local_subweb_port" \
        "IP_HASH_SECRET=$ip_hash_secret" \
        'TURNSTILE_SITE_KEY=local-placeholder-site-key' \
        'TURNSTILE_SECRET_KEY=local-placeholder-secret-key'
    } > "$temporary_env" || local_fail 'unable to write local environment.'
    chmod 0600 "$temporary_env"
    mv "$temporary_env" "$local_env_file"
    trap - 0 HUP INT TERM
  fi
  [ -f "$local_env_file" ] && [ ! -L "$local_env_file" ] \
    || local_fail 'local environment must be a regular file.'

  runtime_image_env=$(node "$local_project_root/scripts/runtime-image-contract.mjs" env) \
    || local_fail 'unable to resolve locked runtime images.'
  for name in SUBCONVERTER_IMAGE; do
    [ "$(printf '%s\n' "$runtime_image_env" | grep -c "^$name=")" -eq 1 ] \
      || local_fail 'runtime image contract is incomplete.'
  done
  local_subconverter_image=$(printf '%s\n' "$runtime_image_env" | sed -n 's/^SUBCONVERTER_IMAGE=//p')
  [ -n "$local_subconverter_image" ] || local_fail 'runtime image contract is incomplete.'
  export SUBCONVERTER_IMAGE="$local_subconverter_image"

  temporary_env=$local_env_file.tmp.$$
  trap 'rm -f "$temporary_env"' 0
  trap 'rm -f "$temporary_env"; exit 1' HUP INT TERM
  sed \
    -e "s#^API_URL=.*#API_URL=http://127.0.0.1:$local_subweb_port#" \
    -e "s#^SUBWEB_PORT=.*#SUBWEB_PORT=$local_subweb_port#" \
    -e '/^REDIS_IMAGE=/d' \
    -e '/^SUBCONVERTER_IMAGE=/d' \
    -e '/^MYURLS_IMAGE=/d' \
    "$local_env_file" > "$temporary_env" \
    || local_fail 'unable to update local API URL.'
  if ! grep -q '^API_URL=' "$temporary_env"; then
    printf '%s\n' "API_URL=http://127.0.0.1:$local_subweb_port" >> "$temporary_env" \
      || local_fail 'unable to add local API URL.'
  fi
  if ! grep -q '^SUBWEB_PORT=' "$temporary_env"; then
    printf '%s\n' "SUBWEB_PORT=$local_subweb_port" >> "$temporary_env" \
      || local_fail 'unable to add local Subweb port.'
  fi
  printf '%s\n' "$runtime_image_env" >> "$temporary_env" \
    || local_fail 'unable to add locked runtime images.'
  chmod 0600 "$temporary_env"
  mv "$temporary_env" "$local_env_file" \
    || local_fail 'unable to update local environment.'
  trap - 0 HUP INT TERM

  export COMPOSE_FILE=$local_project_root/compose.yaml:$local_project_root/compose.dev.yaml
  export COMPOSE_ENV_FILES=$local_env_file
  export COMPOSE_PROJECT_NAME=$local_project_name
}
