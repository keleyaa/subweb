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

if [ "$rotate_secrets" -eq 0 ] && [ -f "$env_file" ]; then
  myurls_api_token=$(load_existing_secret "$env_file" MYURLS_API_TOKEN) || fail 'Existing MYURLS_API_TOKEN is missing, duplicated, or invalid.'
  redis_password=$(load_existing_secret "$env_file" REDIS_PASSWORD) || fail 'Existing REDIS_PASSWORD is missing, duplicated, or invalid.'
else
  myurls_api_token=$(generate_hex_secret) || fail 'Unable to generate MYURLS_API_TOKEN.'
  redis_password=$(generate_hex_secret) || fail 'Unable to generate REDIS_PASSWORD.'
fi

write_env_atomically "$env_file" <<EOF
APP_DOMAIN=$app_domain
API_DOMAIN=$api_domain
API_URL=https://$api_domain
SHORT_DOMAIN=$short_domain
SHORT_URL=https://$short_domain/short-api
${trusted_proxy_setting}${image_settings}MYURLS_API_TOKEN=$myurls_api_token
REDIS_PASSWORD=$redis_password
EOF

printf 'Deployment configuration written to %s.\n' "$env_file"
