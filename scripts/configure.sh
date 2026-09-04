#!/bin/sh
set -eu

umask 077

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib/config.sh
. "$SCRIPT_DIRECTORY/lib/config.sh"

CONFIG_TEMP_FILE=
CONFIG_MOVED_FILE=
cleanup() {
  if [ -n "$CONFIG_TEMP_FILE" ]; then
    rm -f "$CONFIG_TEMP_FILE"
  fi
  if [ -n "$CONFIG_MOVED_FILE" ]; then
    rm -f "$CONFIG_MOVED_FILE"
  fi
}
trap cleanup 0
trap 'cleanup; exit 1' HUP INT TERM

fail() {
  printf 'Configuration error: %s\n' "$1" >&2
  exit 1
}

prompt_turnstile_secret() {
  tty_path=/dev/tty
  [ -r "$tty_path" ] || fail 'TURNSTILE_SECRET_KEY is required; use --turnstile-secret-key-stdin in non-interactive environments.'

  restore_tty() {
    stty echo <"$tty_path" 2>/dev/null || true
  }

  printf 'Turnstile Secret Key (input hidden): ' >"$tty_path"
  stty -echo <"$tty_path"
  trap 'restore_tty; exit 1' HUP INT TERM
  if IFS= read -r turnstile_secret_key <"$tty_path"; then
    read_status=0
  else
    read_status=$?
  fi
  restore_tty
  trap 'cleanup; exit 1' HUP INT TERM
  printf '\n' >"$tty_path"
  [ "$read_status" -eq 0 ] || fail 'Unable to read TURNSTILE_SECRET_KEY.'
}

usage() {
  cat <<'EOF'
Usage: configure.sh --app-domain HOST --api-domain HOST [options]

Options:
  --short-domain HOST
  --api-url URL
  --subweb-port PORT
  --trusted-proxy-cidr IPv4_CIDR
  --short-links-enabled true|false
  --disable-short-links
  --custom-backend-enabled true|false
  --turnstile-site-key KEY
  --turnstile-secret-key-stdin
  --rotate-secrets
  --subweb-image IMAGE
  --help
EOF
}

validate_boolean() {
  case "$1" in
    true|false) ;;
    *) return 1 ;;
  esac
}

validate_port() {
  port_value=${1-}
  printf '%s\n' "$port_value" | LC_ALL=C grep -Eq '^[0-9]+$' || return 1
  [ "$port_value" -ge 1 ] 2>/dev/null && [ "$port_value" -le 65535 ] 2>/dev/null
}

validate_api_url() {
  api_url_value=${1-}
  case "$api_url_value" in
    https://*|http://*) ;;
    *) return 1 ;;
  esac
  api_url_safe_value=$(printf '%s' "$api_url_value" | tr -d '[]')
  case "$api_url_safe_value" in
    *[!A-Za-z0-9:/?%#._~+@=\&-]*) return 1 ;;
    *'@'*) return 1 ;;
  esac

  api_url_rest=${api_url_value#*://}
  api_url_authority=${api_url_rest%%[/?#]*}
  [ -n "$api_url_authority" ] || return 1
  case "$api_url_authority" in
    \[*\]*)
      api_url_host=$(printf '%s' "$api_url_authority" | cut -d ']' -f 1)
      api_url_host="${api_url_host}]"
      api_url_remainder=$(printf '%s' "$api_url_authority" | cut -d ']' -f 2-)
      case "$api_url_remainder" in
        '') ;;
        :*)
          api_url_port=${api_url_remainder#:}
          validate_port "$api_url_port" || return 1
          ;;
        *) return 1 ;;
      esac
      ;;
    *:*)
      api_url_port=${api_url_authority##*:}
      api_url_host=${api_url_authority%:*}
      [ -n "$api_url_port" ] || return 1
      validate_port "$api_url_port" || return 1
      ;;
    *)
      api_url_host=$api_url_authority
      ;;
  esac
  case "$api_url_value" in
    http://*)
      case "$api_url_host" in
        127.0.0.1|localhost|\[::1\]) ;;
        *) return 1 ;;
      esac
      ;;
  esac
  case "$api_url_host" in
    \[*\])
      printf '%s\n' "$api_url_host" | LC_ALL=C grep -Eq '^\[[0-9A-Fa-f:.]+\]$' || return 1
      ;;
    *'['*|*']'*) return 1 ;;
    '') return 1 ;;
    *[!A-Za-z0-9.-]*|*..*|.*|*.) return 1 ;;
  esac
}

validate_turnstile_key() {
  key_value=$1
  [ "${#key_value}" -ge 10 ] && [ "${#key_value}" -le 256 ] || return 1
  printf '%s\n' "$key_value" | LC_ALL=C grep -Eq '^[A-Za-z0-9._-]+$'
}

app_domain=
app_domain_seen=0
api_domain=
api_domain_seen=0
short_domain=
short_domain_seen=0
api_url=
api_url_seen=0
subweb_port=
subweb_port_seen=0
trusted_proxy_cidr=
trusted_proxy_cidr_seen=0
short_links_enabled=true
short_links_enabled_seen=0
custom_backend_enabled=true
custom_backend_enabled_seen=0
rotate_secrets=0
subweb_image=
subweb_image_seen=0
turnstile_site_key=
turnstile_site_key_seen=0
turnstile_secret_key=
turnstile_secret_key_seen=0
turnstile_secret_key_stdin=0

env_file=$PWD/.env

if [ "${1-}" = --help ] || [ "${1-}" = -h ]; then
  [ "$#" -eq 1 ] || fail '--help does not accept other arguments.'
  usage
  exit 0
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app-domain)
      [ "$app_domain_seen" -eq 0 ] || fail '--app-domain may be provided only once.'
      [ "$#" -ge 2 ] || fail '--app-domain requires a value.'
      app_domain=$2
      app_domain_seen=1
      shift 2
      ;;
    --api-domain)
      [ "$api_domain_seen" -eq 0 ] || fail '--api-domain may be provided only once.'
      [ "$#" -ge 2 ] || fail '--api-domain requires a value.'
      api_domain=$2
      api_domain_seen=1
      shift 2
      ;;
    --short-domain)
      [ "$short_domain_seen" -eq 0 ] || fail '--short-domain may be provided only once.'
      [ "$#" -ge 2 ] || fail '--short-domain requires a value.'
      short_domain=$2
      short_domain_seen=1
      shift 2
      ;;
    --api-url)
      [ "$api_url_seen" -eq 0 ] || fail '--api-url may be provided only once.'
      [ "$#" -ge 2 ] || fail '--api-url requires a value.'
      api_url=$2
      api_url_seen=1
      shift 2
      ;;
    --subweb-port)
      [ "$subweb_port_seen" -eq 0 ] || fail '--subweb-port may be provided only once.'
      [ "$#" -ge 2 ] || fail '--subweb-port requires a value.'
      subweb_port=$2
      subweb_port_seen=1
      shift 2
      ;;
    --trusted-proxy-cidr)
      [ "$trusted_proxy_cidr_seen" -eq 0 ] || fail '--trusted-proxy-cidr may be provided only once.'
      [ "$#" -ge 2 ] || fail '--trusted-proxy-cidr requires a value.'
      trusted_proxy_cidr=$2
      trusted_proxy_cidr_seen=1
      shift 2
      ;;
    --short-links-enabled)
      [ "$short_links_enabled_seen" -eq 0 ] || fail '--short-links-enabled may be provided only once.'
      [ "$#" -ge 2 ] || fail '--short-links-enabled requires true or false.'
      short_links_enabled=$2
      short_links_enabled_seen=1
      shift 2
      ;;
    --disable-short-links)
      [ "$short_links_enabled_seen" -eq 0 ] || fail 'short-link mode may be provided only once.'
      short_links_enabled=false
      short_links_enabled_seen=1
      shift
      ;;
    --custom-backend-enabled)
      [ "$custom_backend_enabled_seen" -eq 0 ] || fail '--custom-backend-enabled may be provided only once.'
      [ "$#" -ge 2 ] || fail '--custom-backend-enabled requires true or false.'
      custom_backend_enabled=$2
      custom_backend_enabled_seen=1
      shift 2
      ;;
    --rotate-secrets)
      [ "$rotate_secrets" -eq 0 ] || fail '--rotate-secrets may be provided only once.'
      rotate_secrets=1
      shift
      ;;
    --subweb-image)
      [ "$subweb_image_seen" -eq 0 ] || fail '--subweb-image may be provided only once.'
      [ "$#" -ge 2 ] || fail '--subweb-image requires a value.'
      subweb_image=$2
      subweb_image_seen=1
      shift 2
      ;;
    --turnstile-site-key)
      [ "$turnstile_site_key_seen" -eq 0 ] || fail '--turnstile-site-key may be provided only once.'
      [ "$#" -ge 2 ] || fail '--turnstile-site-key requires a value.'
      turnstile_site_key=$2
      turnstile_site_key_seen=1
      shift 2
      ;;
    --turnstile-secret-key-stdin)
      [ "$turnstile_secret_key_seen" -eq 0 ] || fail 'Turnstile secret key may be provided only once.'
      turnstile_secret_key_seen=1
      turnstile_secret_key_stdin=1
      shift
      ;;
    --turnstile-secret-key)
      fail 'Turnstile secret keys must be provided through --turnstile-secret-key-stdin, not argv.'
      ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

if [ "$turnstile_secret_key_stdin" -eq 1 ]; then
  if IFS= read -r turnstile_secret_key || [ -n "$turnstile_secret_key" ]; then
    :
  else
    fail 'Turnstile secret key must be provided on stdin.'
  fi
fi

if [ "$short_links_enabled_seen" -eq 0 ] && [ -f "$env_file" ]; then
  if existing_value=$(load_existing_optional_value "$env_file" SHORT_LINKS_ENABLED); then
    short_links_enabled=$existing_value
  else
    existing_value_status=$?
    [ "$existing_value_status" -eq 1 ] || fail 'Existing SHORT_LINKS_ENABLED is duplicated or invalid.'
  fi
fi
validate_boolean "$short_links_enabled" || fail 'SHORT_LINKS_ENABLED must be true or false.'

if [ "$custom_backend_enabled_seen" -eq 0 ] && [ -f "$env_file" ]; then
  if existing_value=$(load_existing_optional_value "$env_file" CUSTOM_BACKEND_ENABLED); then
    custom_backend_enabled=$existing_value
  else
    existing_value_status=$?
    [ "$existing_value_status" -eq 1 ] || fail 'Existing CUSTOM_BACKEND_ENABLED is duplicated or invalid.'
  fi
fi
validate_boolean "$custom_backend_enabled" || fail 'CUSTOM_BACKEND_ENABLED must be true or false.'

require_domain() {
  domain_name=$1
  domain_value=$2
  [ -n "$domain_value" ] || fail "$domain_name is required."
  validate_domain "$domain_value" || fail "$domain_name domain must be a plain hostname without scheme, path, or port."
}

require_domain APP_DOMAIN "$app_domain"
require_domain API_DOMAIN "$api_domain"
if [ "$short_links_enabled" = true ]; then
  if [ "$short_domain_seen" -eq 0 ] && [ -f "$env_file" ]; then
    if existing_value=$(load_existing_optional_value "$env_file" SHORT_DOMAIN); then
      short_domain=$existing_value
    else
      existing_value_status=$?
      [ "$existing_value_status" -eq 1 ] || fail 'Existing SHORT_DOMAIN is duplicated or invalid.'
    fi
  fi
  require_domain SHORT_DOMAIN "$short_domain"
elif [ -n "$short_domain" ]; then
  validate_domain "$short_domain" || fail 'SHORT_DOMAIN domain must be a plain hostname without scheme, path, or port.'
fi

[ "$subweb_image_seen" -eq 0 ] || validate_container_image "$subweb_image" \
  || fail 'Subweb image must be a safe registry/repository reference with a tag or sha256 digest.'

normalized_app=$(printf '%s' "$app_domain" | tr '[:upper:]' '[:lower:]')
normalized_api=$(printf '%s' "$api_domain" | tr '[:upper:]' '[:lower:]')
[ "$normalized_app" != "$normalized_api" ] || fail 'APP and API domains must be different.'
if [ -n "$short_domain" ]; then
  normalized_short=$(printf '%s' "$short_domain" | tr '[:upper:]' '[:lower:]')
  [ "$normalized_short" != "$normalized_app" ] || fail 'SHORT and APP domains must be different.'
  [ "$normalized_short" != "$normalized_api" ] || fail 'SHORT and API domains must be different.'
fi

if [ "$api_url_seen" -eq 0 ]; then
  api_url=https://$normalized_api
fi
validate_api_url "$api_url" || fail 'API_URL must use HTTPS or loopback HTTP with a valid host and port.'

if [ "$subweb_port_seen" -eq 0 ] && [ -f "$env_file" ]; then
  if existing_value=$(load_existing_optional_value "$env_file" SUBWEB_PORT); then
    subweb_port=$existing_value
  else
    existing_value_status=$?
    [ "$existing_value_status" -eq 1 ] || fail 'Existing SUBWEB_PORT is duplicated or invalid.'
  fi
fi
[ -n "$subweb_port" ] || subweb_port=18080
validate_port "$subweb_port" || fail 'SUBWEB_PORT must be an integer from 1 to 65535.'

if [ "$trusted_proxy_cidr_seen" -eq 0 ] && [ -f "$env_file" ]; then
  if existing_trusted_proxy_cidr=$(load_existing_optional_value "$env_file" TRUSTED_PROXY_CIDR); then
    trusted_proxy_cidr=$existing_trusted_proxy_cidr
  else
    existing_trusted_proxy_status=$?
    [ "$existing_trusted_proxy_status" -eq 1 ] || fail 'Existing TRUSTED_PROXY_CIDR is duplicated or invalid.'
  fi
fi
[ -z "$trusted_proxy_cidr" ] || validate_ipv4_cidr "$trusted_proxy_cidr" \
  || fail 'TRUSTED_PROXY_CIDR must be one IPv4 CIDR, for example 172.18.0.1/32.'
[ ! -d "$env_file" ] || fail '.env target must not be a directory or a symlink to a directory.'

image_settings=
for image_key in MYURLS_IMAGE REDIS_IMAGE SUBCONVERTER_IMAGE; do
  if [ -f "$env_file" ]; then
    if existing_image=$(load_existing_image "$env_file" "$image_key"); then
      image_settings="${image_settings}${image_key}=${existing_image}
"
    else
      existing_image_status=$?
      [ "$existing_image_status" -eq 1 ] || fail "Existing $image_key is duplicated or invalid."
    fi
  fi
done

if [ "$subweb_image_seen" -eq 0 ] && [ -f "$env_file" ]; then
  if existing_image=$(load_existing_image "$env_file" SUBWEB_IMAGE); then
    subweb_image=$existing_image
  else
    existing_image_status=$?
    [ "$existing_image_status" -eq 1 ] || fail 'Existing SUBWEB_IMAGE is duplicated or invalid.'
  fi
fi
if [ -n "$subweb_image" ]; then
  image_settings="${image_settings}SUBWEB_IMAGE=$subweb_image
"
fi
short_domain_setting=
if [ "$short_links_enabled" = true ]; then
  short_domain_setting="SHORT_DOMAIN=$short_domain
"
fi

trusted_proxy_setting=
if [ -n "$trusted_proxy_cidr" ]; then
  trusted_proxy_setting="TRUSTED_PROXY_CIDR=$trusted_proxy_cidr
"
fi

turnstile_settings=
short_link_secrets=
if [ "$short_links_enabled" = true ]; then
  if [ "$turnstile_site_key_seen" -eq 0 ] && [ -f "$env_file" ]; then
    if existing_value=$(load_existing_optional_value "$env_file" TURNSTILE_SITE_KEY); then
      turnstile_site_key=$existing_value
    else
      existing_value_status=$?
      [ "$existing_value_status" -eq 1 ] || fail 'Existing TURNSTILE_SITE_KEY is duplicated or invalid.'
    fi
  fi
  if [ "$turnstile_secret_key_seen" -eq 0 ] && [ -f "$env_file" ]; then
    if existing_value=$(load_existing_optional_value "$env_file" TURNSTILE_SECRET_KEY); then
      turnstile_secret_key=$existing_value
    else
      existing_value_status=$?
      [ "$existing_value_status" -eq 1 ] || fail 'Existing TURNSTILE_SECRET_KEY is duplicated or invalid.'
    fi
  fi
  if [ -z "$turnstile_secret_key" ] && [ "$turnstile_secret_key_stdin" -eq 0 ]; then
    prompt_turnstile_secret
  fi
  validate_turnstile_key "$turnstile_site_key" \
    || fail 'TURNSTILE_SITE_KEY is required; pass --turnstile-site-key with the Cloudflare site key.'
  validate_turnstile_key "$turnstile_secret_key" \
    || fail 'TURNSTILE_SECRET_KEY is required; pass --turnstile-secret-key-stdin with the Cloudflare secret key.'
  turnstile_settings="TURNSTILE_SITE_KEY=$turnstile_site_key
TURNSTILE_SECRET_KEY=$turnstile_secret_key
"

  if [ "$rotate_secrets" -eq 0 ] && [ -f "$env_file" ]; then
    if redis_password=$(load_existing_secret "$env_file" REDIS_PASSWORD); then
      :
    else
      redis_status=$?
      [ "$redis_status" -eq 1 ] || fail 'Existing REDIS_PASSWORD is missing, duplicated, or invalid.'
      redis_password=$(generate_hex_secret) || fail 'Unable to generate REDIS_PASSWORD.'
    fi
    if ip_hash_secret=$(load_existing_secret "$env_file" IP_HASH_SECRET); then
      :
    else
      ip_hash_status=$?
      [ "$ip_hash_status" -eq 1 ] || fail 'Existing IP_HASH_SECRET is duplicated or invalid.'
      ip_hash_secret=$(generate_hex_secret) || fail 'Unable to generate IP_HASH_SECRET.'
    fi
  else
    redis_password=$(generate_hex_secret) || fail 'Unable to generate REDIS_PASSWORD.'
    ip_hash_secret=$(generate_hex_secret) || fail 'Unable to generate IP_HASH_SECRET.'
  fi
  short_link_secrets="IP_HASH_SECRET=$ip_hash_secret
REDIS_PASSWORD=$redis_password
"
fi

write_env_atomically "$env_file" <<EOF
APP_DOMAIN=$app_domain
API_DOMAIN=$api_domain
API_URL=$api_url
SUBWEB_PORT=$subweb_port
SHORT_LINKS_ENABLED=$short_links_enabled
CUSTOM_BACKEND_ENABLED=$custom_backend_enabled
${short_domain_setting}${trusted_proxy_setting}${image_settings}${turnstile_settings}${short_link_secrets}
EOF

printf 'Deployment configuration written to %s.\n' "$env_file"
