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

mode=
mode_seen=0
app_domain=
app_domain_seen=0
api_domain=
api_domain_seen=0
short_domain=
short_domain_seen=0
tls_cert=
tls_cert_seen=0
tls_key=
tls_key_seen=0
rotate_secrets=0
subweb_image=
subweb_image_seen=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)
      [ "$mode_seen" -eq 0 ] || fail '--mode may be provided only once.'
      [ "$#" -ge 2 ] || fail '--mode requires a value.'
      mode=$2
      mode_seen=1
      shift 2
      ;;
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
    --tls-cert)
      [ "$tls_cert_seen" -eq 0 ] || fail '--tls-cert may be provided only once.'
      [ "$#" -ge 2 ] || fail '--tls-cert requires a value.'
      tls_cert=$2
      tls_cert_seen=1
      shift 2
      ;;
    --tls-key)
      [ "$tls_key_seen" -eq 0 ] || fail '--tls-key may be provided only once.'
      [ "$#" -ge 2 ] || fail '--tls-key requires a value.'
      tls_key=$2
      tls_key_seen=1
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

validate_mode "$mode" || fail 'mode must be behind-proxy or direct-tls.'
validate_domain "$app_domain" || fail 'APP domain must be a plain hostname without scheme, path, or port.'
validate_domain "$api_domain" || fail 'API domain must be a plain hostname without scheme, path, or port.'
[ "$subweb_image_seen" -eq 0 ] || validate_container_image "$subweb_image" || fail 'Subweb image must be a safe registry/repository reference with a tag or sha256 digest.'

normalized_app=$(printf '%s' "$app_domain" | tr '[:upper:]' '[:lower:]')
normalized_api=$(printf '%s' "$api_domain" | tr '[:upper:]' '[:lower:]')
[ "$normalized_app" != "$normalized_api" ] || fail 'APP and API domains must be different.'

if [ "$short_domain_seen" -eq 1 ]; then
  domain_mode=three-domain
  validate_domain "$short_domain" || fail 'SHORT domain must be a plain hostname without scheme, path, or port.'
  normalized_short=$(printf '%s' "$short_domain" | tr '[:upper:]' '[:lower:]')
  [ "$normalized_short" != "$normalized_app" ] || fail 'SHORT and APP domains must be different in three-domain mode.'
  [ "$normalized_short" != "$normalized_api" ] || fail 'SHORT and API domains must be different in three-domain mode.'
else
  domain_mode=legacy
  short_domain=$app_domain
fi

case "$mode" in
  behind-proxy)
    [ -z "$tls_cert" ] && [ -z "$tls_key" ] || fail 'TLS paths are not accepted in behind-proxy mode.'
    ;;
  direct-tls)
    [ -n "$tls_cert" ] || fail '--tls-cert is required in direct-tls mode.'
    [ -n "$tls_key" ] || fail '--tls-key is required in direct-tls mode.'
    validate_absolute_path "$tls_cert" || fail 'TLS certificate path must be absolute and contain only safe path characters.'
    validate_absolute_path "$tls_key" || fail 'TLS private key path must be absolute and contain only safe path characters.'
    ;;
esac

env_file=$PWD/.env
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

if [ "$rotate_secrets" -eq 0 ] && [ -f "$env_file" ]; then
  myurls_api_token=$(load_existing_secret "$env_file" MYURLS_API_TOKEN) || fail 'Existing MYURLS_API_TOKEN is missing, duplicated, or invalid.'
  redis_password=$(load_existing_secret "$env_file" REDIS_PASSWORD) || fail 'Existing REDIS_PASSWORD is missing, duplicated, or invalid.'
else
  myurls_api_token=$(generate_hex_secret) || fail 'Unable to generate MYURLS_API_TOKEN.'
  redis_password=$(generate_hex_secret) || fail 'Unable to generate REDIS_PASSWORD.'
fi

if [ "$mode" = direct-tls ]; then
  write_env_atomically "$env_file" <<EOF
COMPOSE_PROFILES=$mode
DOMAIN_MODE=$domain_mode
APP_DOMAIN=$app_domain
API_DOMAIN=$api_domain
API_URL=https://$api_domain
SHORT_DOMAIN=$short_domain
SHORT_URL=https://$short_domain/short-api
${image_settings}TLS_CERT_PATH=$tls_cert
TLS_KEY_PATH=$tls_key
MYURLS_API_TOKEN=$myurls_api_token
REDIS_PASSWORD=$redis_password
EOF
else
  write_env_atomically "$env_file" <<EOF
COMPOSE_PROFILES=$mode
DOMAIN_MODE=$domain_mode
APP_DOMAIN=$app_domain
API_DOMAIN=$api_domain
API_URL=https://$api_domain
SHORT_DOMAIN=$short_domain
SHORT_URL=https://$short_domain/short-api
${image_settings}MYURLS_API_TOKEN=$myurls_api_token
REDIS_PASSWORD=$redis_password
EOF
fi

printf 'Deployment configuration written to %s.\n' "$env_file"
