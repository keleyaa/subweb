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

app_domain=
app_domain_seen=0
api_domain=
api_domain_seen=0
short_domain=
short_domain_seen=0
trusted_proxy_cidr=
trusted_proxy_cidr_seen=0
rotate_secrets=0
subweb_image=
subweb_image_seen=0
turnstile_site_key=
turnstile_site_key_seen=0
turnstile_secret_key=
turnstile_secret_key_seen=0

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
    --trusted-proxy-cidr)
      [ "$trusted_proxy_cidr_seen" -eq 0 ] || fail '--trusted-proxy-cidr may be provided only once.'
      [ "$#" -ge 2 ] || fail '--trusted-proxy-cidr requires a value.'
      trusted_proxy_cidr=$2
      trusted_proxy_cidr_seen=1
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
    --turnstile-secret-key)
      [ "$turnstile_secret_key_seen" -eq 0 ] || fail '--turnstile-secret-key may be provided only once.'
      [ "$#" -ge 2 ] || fail '--turnstile-secret-key requires a value.'
      turnstile_secret_key=$2
      turnstile_secret_key_seen=1
      shift 2
      ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

require_domain() {
  domain_name=$1
  domain_value=$2
  [ -n "$domain_value" ] || fail "$domain_name is required."
  validate_domain "$domain_value" || fail "$domain_name domain must be a plain hostname without scheme, path, or port."
}

require_domain APP_DOMAIN "$app_domain"
require_domain API_DOMAIN "$api_domain"
require_domain SHORT_DOMAIN "$short_domain"
[ "$subweb_image_seen" -eq 0 ] || validate_container_image "$subweb_image" || fail 'Subweb image must be a safe registry/repository reference with a tag or sha256 digest.'

normalized_app=$(printf '%s' "$app_domain" | tr '[:upper:]' '[:lower:]')
normalized_api=$(printf '%s' "$api_domain" | tr '[:upper:]' '[:lower:]')
[ "$normalized_app" != "$normalized_api" ] || fail 'APP and API domains must be different.'

normalized_short=$(printf '%s' "$short_domain" | tr '[:upper:]' '[:lower:]')
[ "$normalized_short" != "$normalized_app" ] || fail 'SHORT and APP domains must be different.'
[ "$normalized_short" != "$normalized_api" ] || fail 'SHORT and API domains must be different.'

validate_turnstile_key() {
  key_value=$1
  [ "${#key_value}" -ge 10 ] && [ "${#key_value}" -le 256 ] \
    || return 1
  printf '%s\n' "$key_value" | LC_ALL=C grep -Eq '^[A-Za-z0-9._-]+$'
}

env_file=$PWD/.env
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

trusted_proxy_setting=
if [ -n "$trusted_proxy_cidr" ]; then
  trusted_proxy_setting="TRUSTED_PROXY_CIDR=$trusted_proxy_cidr
"
fi

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
validate_turnstile_key "$turnstile_site_key" \
  || fail 'TURNSTILE_SITE_KEY is required; pass --turnstile-site-key with the Cloudflare site key.'
validate_turnstile_key "$turnstile_secret_key" \
  || fail 'TURNSTILE_SECRET_KEY is required; pass --turnstile-secret-key with the Cloudflare secret key.'

if [ "$rotate_secrets" -eq 0 ] && [ -f "$env_file" ]; then
  redis_password=$(load_existing_secret "$env_file" REDIS_PASSWORD) || fail 'Existing REDIS_PASSWORD is missing, duplicated, or invalid.'
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

write_env_atomically "$env_file" <<EOF
APP_DOMAIN=$app_domain
API_DOMAIN=$api_domain
API_URL=https://$api_domain
SHORT_DOMAIN=$short_domain
${trusted_proxy_setting}${image_settings}TURNSTILE_SITE_KEY=$turnstile_site_key
TURNSTILE_SECRET_KEY=$turnstile_secret_key
IP_HASH_SECRET=$ip_hash_secret
REDIS_PASSWORD=$redis_password
EOF

printf 'Deployment configuration written to %s.\n' "$env_file"
