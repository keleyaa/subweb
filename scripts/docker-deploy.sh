#!/bin/sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIRECTORY=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd)

fail() {
  printf 'Docker deployment error: %s\n' "$1" >&2
  exit 1
}

app_domain=
api_domain=
short_domain=
turnstile_site_key=
turnstile_secret_key=
trusted_proxy_cidr=
trusted_proxy_cidr_seen=0
image=docker.io/keleyaa/subweb:latest
image_seen=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app-domain)
      [ "$#" -ge 2 ] || fail '--app-domain requires a value.'
      app_domain=$2
      shift 2
      ;;
    --api-domain)
      [ "$#" -ge 2 ] || fail '--api-domain requires a value.'
      api_domain=$2
      shift 2
      ;;
    --short-domain)
      [ "$#" -ge 2 ] || fail '--short-domain requires a value.'
      short_domain=$2
      shift 2
      ;;
    --turnstile-site-key)
      [ "$#" -ge 2 ] || fail '--turnstile-site-key requires a value.'
      turnstile_site_key=$2
      shift 2
      ;;
    --turnstile-secret-key)
      [ "$#" -ge 2 ] || fail '--turnstile-secret-key requires a value.'
      turnstile_secret_key=$2
      shift 2
      ;;
    --trusted-proxy-cidr)
      [ "$trusted_proxy_cidr_seen" -eq 0 ] || fail '--trusted-proxy-cidr may be provided only once.'
      [ "$#" -ge 2 ] || fail '--trusted-proxy-cidr requires a value.'
      trusted_proxy_cidr=$2
      trusted_proxy_cidr_seen=1
      shift 2
      ;;
    --image)
      [ "$image_seen" -eq 0 ] || fail '--image may be provided only once.'
      [ "$#" -ge 2 ] || fail '--image requires a value.'
      image=$2
      image_seen=1
      shift 2
      ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

command -v docker >/dev/null 2>&1 || fail 'Docker is not installed or not available in PATH.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required.'

cd "$PROJECT_DIRECTORY"

if [ "$trusted_proxy_cidr_seen" -eq 1 ]; then
  "$SCRIPT_DIRECTORY/configure.sh" \
    --app-domain "$app_domain" \
    --api-domain "$api_domain" \
    --short-domain "$short_domain" \
    --turnstile-site-key "$turnstile_site_key" \
    --turnstile-secret-key "$turnstile_secret_key" \
    --trusted-proxy-cidr "$trusted_proxy_cidr" \
    --subweb-image "$image"
else
  "$SCRIPT_DIRECTORY/configure.sh" \
    --app-domain "$app_domain" \
    --api-domain "$api_domain" \
    --short-domain "$short_domain" \
    --turnstile-site-key "$turnstile_site_key" \
    --turnstile-secret-key "$turnstile_secret_key" \
    --subweb-image "$image"
fi

"$SCRIPT_DIRECTORY/validate-compose.sh"
docker compose pull gateway redis myurls-app myurls-short subconverter
docker compose build request-policy
docker compose up -d --no-build --pull never --wait
docker compose ps

printf 'Docker image deployment started for https://%s.\n' "$app_domain"
