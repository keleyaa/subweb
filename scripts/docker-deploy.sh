#!/bin/sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIRECTORY=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd)

fail() {
  printf 'Docker deployment error: %s\n' "$1" >&2
  exit 1
}

mode=
app_domain=
api_domain=
short_domain=
tls_cert=
tls_key=
image=docker.io/keleyaa/subweb:latest
image_seen=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)
      [ "$#" -ge 2 ] || fail '--mode requires a value.'
      mode=$2
      shift 2
      ;;
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
    --tls-cert)
      [ "$#" -ge 2 ] || fail '--tls-cert requires a value.'
      tls_cert=$2
      shift 2
      ;;
    --tls-key)
      [ "$#" -ge 2 ] || fail '--tls-key requires a value.'
      tls_key=$2
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

if [ "$mode" = direct-tls ]; then
  "$SCRIPT_DIRECTORY/configure.sh" \
    --mode "$mode" \
    --app-domain "$app_domain" \
    --api-domain "$api_domain" \
    --short-domain "$short_domain" \
    --tls-cert "$tls_cert" \
    --tls-key "$tls_key" \
    --subweb-image "$image"
else
  "$SCRIPT_DIRECTORY/configure.sh" \
    --mode "$mode" \
    --app-domain "$app_domain" \
    --api-domain "$api_domain" \
    --short-domain "$short_domain" \
    --subweb-image "$image"
fi

"$SCRIPT_DIRECTORY/validate-compose.sh"
docker compose pull
docker compose up -d --no-build --pull always --wait
docker compose ps

printf 'Docker image deployment started for https://%s.\n' "$app_domain"
