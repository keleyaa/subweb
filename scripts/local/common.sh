#!/bin/sh

local_script_directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
local_project_root=$(CDPATH='' cd -- "$local_script_directory/../.." && pwd -P)
local_runtime_directory=$local_project_root/.runtime/local
local_env_file=$local_runtime_directory/compose.env
local_project_name=${SUBWEB_LOCAL_PROJECT_NAME:-subweb-local}
local_myurls_port=${LOCAL_MYURLS_PORT:-18082}
local_subweb_port=${LOCAL_SUBWEB_PORT:-18081}
local_vite_port=${LOCAL_VITE_PORT:-5173}
local_myurls_network_subnet=${LOCAL_MYURLS_NETWORK_SUBNET:-172.30.255.0/29}
local_myurls_gateway_ip=${LOCAL_MYURLS_GATEWAY_IP:-172.30.255.2}
local_myurls_ip=${LOCAL_MYURLS_IP:-172.30.255.3}
local_myurls_trust_proxy_cidr=${LOCAL_MYURLS_TRUST_PROXY_CIDR:-$local_myurls_gateway_ip/32}

local_fail() {
  printf 'Local development error: %s\n' "$1" >&2
  exit 1
}

validate_local_port() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -ge 1024 ] 2>/dev/null && [ "$1" -le 65535 ]
}

validate_local_ipv4() (
  address=${1-}
  printf '%s\n' "$address" | awk -F. '
    BEGIN { valid = 0 }
    NR == 1 {
      valid = (NF == 4)
      for (octet = 1; octet <= 4; octet += 1) {
        if ($octet !~ /^[0-9]+$/ || (length($octet) > 1 && substr($octet, 1, 1) == "0") || ($octet + 0) > 255) {
          valid = 0
        }
      }
    }
    END { exit !(NR == 1 && valid) }
  '
)

validate_local_ipv4_cidr() (
  cidr=${1-}
  maximum_prefix=${2:-30}
  printf '%s\n' "$cidr" | awk -F'[./]' -v maximum_prefix="$maximum_prefix" '
    BEGIN { valid = 0 }
    NR == 1 {
      valid = (NF == 5 && $5 ~ /^([0-9]|[12][0-9]|3[0-2])$/ && ($5 + 0) > 0 && ($5 + 0) <= maximum_prefix)
      for (octet = 1; octet <= 4 && valid; octet += 1) {
        if ($octet !~ /^[0-9]+$/ || (length($octet) > 1 && substr($octet, 1, 1) == "0") || ($octet + 0) > 255) {
          valid = 0
        }
      }
      if (valid) {
        prefix = $5 + 0
        for (octet = 1; octet <= 4; octet += 1) {
          if (prefix >= octet * 8) continue
          if (prefix <= (octet - 1) * 8) {
            expected = 0
          } else {
            block = 2 ^ (8 - (prefix - (octet - 1) * 8))
            expected = int(($octet + 0) / block) * block
          }
          if (($octet + 0) != expected) valid = 0
        }
      }
    }
    END { exit !(NR == 1 && valid) }
  '
)

validate_local_ipv4s_in_subnet() (
  subnet=${1-}
  gateway=${2-}
  myurls=${3-}
  awk -v subnet="$subnet" -v gateway="$gateway" -v myurls="$myurls" '
    function ip_number(value, parts, position, number) {
      split(value, parts, ".")
      number = 0
      for (position = 1; position <= 4; position += 1) number = number * 256 + parts[position]
      return number
    }
    BEGIN {
      split(subnet, subnet_parts, "/")
      network_start = ip_number(subnet_parts[1])
      network_end = network_start + (2 ^ (32 - subnet_parts[2])) - 1
      gateway_number = ip_number(gateway)
      myurls_number = ip_number(myurls)
      exit !(gateway_number > network_start && gateway_number < network_end && myurls_number > network_start && myurls_number < network_end)
    }
  '
)

prepare_local_environment() {
  command -v docker >/dev/null 2>&1 || local_fail 'docker is required.'
  command -v node >/dev/null 2>&1 || local_fail 'node is required.'
  command -v openssl >/dev/null 2>&1 || local_fail 'openssl is required.'
  for port in "$local_myurls_port" "$local_subweb_port" "$local_vite_port"; do
    validate_local_port "$port" || local_fail 'local ports must be integers from 1024 to 65535.'
  done
  [ "$local_myurls_port" != "$local_subweb_port" ] \
     && [ "$local_myurls_port" != "$local_vite_port" ] \
     && [ "$local_subweb_port" != "$local_vite_port" ] \
     || local_fail 'local ports must be distinct.'
  validate_local_ipv4_cidr "$local_myurls_network_subnet" \
    || local_fail 'LOCAL_MYURLS_NETWORK_SUBNET must be a canonical IPv4 subnet.'
  validate_local_ipv4 "$local_myurls_gateway_ip" \
    || local_fail 'LOCAL_MYURLS_GATEWAY_IP must be a valid IPv4 address.'
  validate_local_ipv4 "$local_myurls_ip" \
    || local_fail 'LOCAL_MYURLS_IP must be a valid IPv4 address.'
  [ "$local_myurls_gateway_ip" != "$local_myurls_ip" ] \
    || local_fail 'LOCAL_MYURLS_GATEWAY_IP and LOCAL_MYURLS_IP must be distinct.'
  validate_local_ipv4s_in_subnet \
    "$local_myurls_network_subnet" "$local_myurls_gateway_ip" "$local_myurls_ip" \
    || local_fail 'LOCAL_MYURLS_GATEWAY_IP and LOCAL_MYURLS_IP must be inside LOCAL_MYURLS_NETWORK_SUBNET.'
  validate_local_ipv4_cidr "$local_myurls_trust_proxy_cidr" 32 \
    || local_fail 'LOCAL_MYURLS_TRUST_PROXY_CIDR must be a canonical IPv4 CIDR.'
  [ "$local_myurls_trust_proxy_cidr" = "$local_myurls_gateway_ip/32" ] \
    || local_fail 'LOCAL_MYURLS_TRUST_PROXY_CIDR must exactly match LOCAL_MYURLS_GATEWAY_IP/32.'

  export LOCAL_MYURLS_PORT="$local_myurls_port"
  export LOCAL_SUBWEB_PORT="$local_subweb_port"
  export LOCAL_VITE_PORT="$local_vite_port"
  export MYURLS_NETWORK_SUBNET="$local_myurls_network_subnet"
  export MYURLS_GATEWAY_IP="$local_myurls_gateway_ip"
  export MYURLS_IP="$local_myurls_ip"
  export MYURLS_TRUST_PROXY_CIDR="$local_myurls_trust_proxy_cidr"

  mkdir -p "$local_runtime_directory"
  chmod 0700 "$local_runtime_directory"
  if [ ! -f "$local_env_file" ]; then
    redis_password=$(openssl rand -hex 32) || local_fail 'unable to generate Redis password.'
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
        "REDIS_PASSWORD=$redis_password" \
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
  for name in REDIS_IMAGE SUBCONVERTER_IMAGE MYURLS_IMAGE; do
    [ "$(printf '%s\n' "$runtime_image_env" | grep -c "^$name=")" -eq 1 ] \
      || local_fail 'runtime image contract is incomplete.'
  done
  local_redis_image=$(printf '%s\n' "$runtime_image_env" | sed -n 's/^REDIS_IMAGE=//p')
  local_subconverter_image=$(printf '%s\n' "$runtime_image_env" | sed -n 's/^SUBCONVERTER_IMAGE=//p')
  local_myurls_image=$(printf '%s\n' "$runtime_image_env" | sed -n 's/^MYURLS_IMAGE=//p')
  [ -n "$local_redis_image" ] \
    && [ -n "$local_subconverter_image" ] \
    && [ -n "$local_myurls_image" ] \
    || local_fail 'runtime image contract is incomplete.'
  export REDIS_IMAGE="$local_redis_image"
  export SUBCONVERTER_IMAGE="$local_subconverter_image"
  export MYURLS_IMAGE="$local_myurls_image"

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
