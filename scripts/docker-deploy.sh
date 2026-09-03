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
api_url=
subweb_port=
trusted_proxy_cidr=
short_links_enabled=
short_links_enabled_seen=0
custom_backend_enabled=
custom_backend_enabled_seen=0
turnstile_site_key=
turnstile_secret_key=
image=
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
    --api-url)
      [ "$#" -ge 2 ] || fail '--api-url requires a value.'
      api_url=$2
      shift 2
      ;;
    --subweb-port)
      [ "$#" -ge 2 ] || fail '--subweb-port requires a value.'
      subweb_port=$2
      shift 2
      ;;
    --trusted-proxy-cidr)
      [ "$#" -ge 2 ] || fail '--trusted-proxy-cidr requires a value.'
      trusted_proxy_cidr=$2
      shift 2
      ;;
    --short-links-enabled)
      [ "$short_links_enabled_seen" -eq 0 ] || fail 'short-link mode may be provided only once.'
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
      [ "$custom_backend_enabled_seen" -eq 0 ] || fail 'custom-backend mode may be provided only once.'
      [ "$#" -ge 2 ] || fail '--custom-backend-enabled requires true or false.'
      custom_backend_enabled=$2
      custom_backend_enabled_seen=1
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

[ "$image_seen" -eq 1 ] || fail '--image is required and must use an immutable sha-* tag or sha256 digest.'
case "$image" in
  *@sha256:*)
    printf '%s\n' "$image" | LC_ALL=C grep -Eq '^[^[:space:]@]+@sha256:[0-9a-f]{64}$' \
      || fail '--image must use an immutable sha-* tag or sha256 digest.'
    ;;
  *)
    printf '%s\n' "$image" | LC_ALL=C grep -Eq '^[^[:space:]@]+:sha-[0-9a-f]{7,64}$' \
      || fail '--image must use an immutable sha-* tag or sha256 digest.'
    ;;
esac

command -v docker >/dev/null 2>&1 || fail 'Docker is not installed or not available in PATH.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required.'

cd "$PROJECT_DIRECTORY"

run_configure() {
  set -- "$SCRIPT_DIRECTORY/configure.sh" \
    --app-domain "$app_domain" \
    --api-domain "$api_domain" \
    --subweb-image "$image"
  [ "$short_links_enabled_seen" -eq 1 ] && set -- "$@" --short-links-enabled "$short_links_enabled"
  [ "$custom_backend_enabled_seen" -eq 1 ] && set -- "$@" --custom-backend-enabled "$custom_backend_enabled"
  [ -n "$short_domain" ] && set -- "$@" --short-domain "$short_domain"
  [ -n "$api_url" ] && set -- "$@" --api-url "$api_url"
  [ -n "$subweb_port" ] && set -- "$@" --subweb-port "$subweb_port"
  [ -n "$trusted_proxy_cidr" ] && set -- "$@" --trusted-proxy-cidr "$trusted_proxy_cidr"
  [ -n "$turnstile_site_key" ] && set -- "$@" --turnstile-site-key "$turnstile_site_key"
  [ -n "$turnstile_secret_key" ] && set -- "$@" --turnstile-secret-key "$turnstile_secret_key"
  "$@"
}
run_configure

# The generated .env is the authoritative deployment configuration.
unset SUBWEB_IMAGE

if short_links_enabled=$(awk -F= '$1 == "SHORT_LINKS_ENABLED" { count += 1; value = $2 } END { if (count == 1) print value; else exit (count > 1 ? 2 : 1) }' .env); then
  :
else
  fail 'Generated .env does not contain exactly one SHORT_LINKS_ENABLED value.'
fi

compose_file=compose.yaml
if [ "$short_links_enabled" = false ]; then
  compose_file=compose.disabled-short-links.yaml
fi
compose() {
  docker compose -f "$compose_file" "$@"
}

SHORT_LINKS_ENABLED=$short_links_enabled COMPOSE_VALIDATION_FILE=$compose_file \
  "$SCRIPT_DIRECTORY/validate-compose.sh"
if [ "$short_links_enabled" = true ]; then
  compose pull gateway subconverter myurls-app myurls-short redis
else
  compose pull gateway subconverter
fi
compose up -d --no-build --pull never --wait
compose ps

printf 'Docker image deployment started for https://%s.\n' "$app_domain"
