#!/bin/sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIRECTORY=$(CDPATH='' cd -- "$SCRIPT_DIRECTORY/.." && pwd)
. "$SCRIPT_DIRECTORY/lib/release-image.sh"
. "$SCRIPT_DIRECTORY/lib/path-lock.sh"

DEPLOY_ENV_LOCK_DIRECTORY=
DEPLOY_ENV_LOCK_TOKEN=
DEPLOY_VERSION_LOCK_DIRECTORY=
DEPLOY_VERSION_LOCK_TOKEN=
DEPLOY_VERSION_LOCK_FILE=${VERSION_LOCK_FILE:-}
cleanup() {
  release_path_lock "$DEPLOY_VERSION_LOCK_DIRECTORY" || true
  release_path_lock "$DEPLOY_ENV_LOCK_DIRECTORY" || true
}
trap cleanup 0
trap 'cleanup; exit 1' HUP INT TERM

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
turnstile_secret_key_stdin=0
image=
image_seen=0
version=
version_seen=0

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
    --turnstile-secret-key-stdin)
      [ "$turnstile_secret_key_stdin" -eq 0 ] || fail 'Turnstile secret key may be provided only once.'
      turnstile_secret_key_stdin=1
      shift
      ;;
    --turnstile-secret-key)
      fail 'Turnstile secret keys must be provided through --turnstile-secret-key-stdin, not argv.'
      ;;
    --image)
      [ "$image_seen" -eq 0 ] || fail '--image may be provided only once.'
      [ "$#" -ge 2 ] || fail '--image requires a value.'
      image=$2
      image_seen=1
      shift 2
      ;;
    --version)
      [ "$version_seen" -eq 0 ] || fail '--version may be provided only once.'
      [ "$#" -ge 2 ] || fail '--version requires a value.'
      case "$2" in
        --*) fail '--version requires a value.' ;;
      esac
      version=$2
      version_seen=1
      shift 2
      ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

if [ "$version_seen" -eq 1 ] && [ "$image_seen" -eq 1 ]; then
  fail '--version and --image may not be used together.'
fi
[ "$image_seen" -eq 1 ] || [ "$version_seen" -eq 1 ] || fail '--image is required and must use an immutable sha256 digest.'
if [ "$version_seen" -eq 1 ]; then
  if ! image=$(resolve_release_image "$version" </dev/null); then
    exit 1
  fi
  image_seen=1
fi

newline='
'
case "$image" in
  *"$newline"*) fail '--image must use an immutable sha256 digest.' ;;
esac
repository=${image%@sha256:*}
digest=${image#*@sha256:}
[ "$repository" != "$image" ] && [ -n "$repository" ] \
  || fail '--image must use an immutable sha256 digest.'
printf '%s\n' "$digest" | LC_ALL=C grep -Eq '^[0-9a-f]{64}$' \
  || fail '--image must use an immutable sha256 digest.'

case "$repository" in
  \[*\]:*/*)
    printf '%s\n' "$repository" | LC_ALL=C grep -Eq '^\[[0-9A-Fa-f:.]+\]:[0-9]+/[a-z0-9]+([._-][a-z0-9]+)*(\/([a-z0-9]+([._-][a-z0-9]+)*))*$' \
      || fail '--image must use an immutable sha256 digest.'
    registry=${repository%%/*}
    ;;
  *)
    printf '%s\n' "$repository" | LC_ALL=C grep -Eq '^[a-z0-9][a-z0-9.-]*(:[0-9]+)?(/[a-z0-9]+([._-][a-z0-9]+)*)*$' \
      || fail '--image must use an immutable sha256 digest.'
    case "$repository" in */*) registry=${repository%%/*} ;; *) registry= ;; esac
    ;;
esac

case "$registry" in
  *:*)
    registry_port=${registry##*:}
    [ "$registry_port" -ge 1 ] 2>/dev/null && [ "$registry_port" -le 65535 ] 2>/dev/null \
      || fail '--image must use an immutable sha256 digest.'
    ;;
esac

if [ "$short_links_enabled_seen" -eq 1 ] && [ "$short_links_enabled" = false ]; then
  turnstile_secret_key_stdin=0
fi

compose_docker() (
  # Docker connection settings are intentionally retained; Compose
  # interpolation must come exclusively from the validated environment file.
  env -i \
    PATH="$PATH" \
    HOME="${HOME-}" \
    TMPDIR="${TMPDIR-}" \
    DOCKER_API_VERSION="${DOCKER_API_VERSION-}" \
    DOCKER_CERT_PATH="${DOCKER_CERT_PATH-}" \
    DOCKER_CONFIG="${DOCKER_CONFIG-}" \
    DOCKER_CONTEXT="${DOCKER_CONTEXT-}" \
    DOCKER_HOST="${DOCKER_HOST-}" \
    DOCKER_TLS="${DOCKER_TLS-}" \
    DOCKER_TLS_VERIFY="${DOCKER_TLS_VERIFY-}" \
    SSH_AUTH_SOCK="${SSH_AUTH_SOCK-}" \
    docker compose "$@"
)

command -v docker >/dev/null 2>&1 || fail 'Docker is not installed or not available in PATH.'
compose_docker version >/dev/null 2>&1 || fail 'Docker Compose v2 is required.'

cd "$PROJECT_DIRECTORY"
acquire_path_lock "$PROJECT_DIRECTORY/.env" \
  || fail 'could not lock the deployment environment.'
DEPLOY_ENV_LOCK_DIRECTORY=$PATH_LOCK_DIRECTORY
DEPLOY_ENV_LOCK_TOKEN=$PATH_LOCK_TOKEN
DEPLOY_VERSION_LOCK_FILE=${VERSION_LOCK_FILE:-$PROJECT_DIRECTORY/deploy/versions.lock.json}
export VERSION_LOCK_FILE="$DEPLOY_VERSION_LOCK_FILE"
acquire_path_lock "$DEPLOY_VERSION_LOCK_FILE" \
  || fail 'could not lock deploy/versions.lock.json.'
DEPLOY_VERSION_LOCK_DIRECTORY=$PATH_LOCK_DIRECTORY
DEPLOY_VERSION_LOCK_TOKEN=$PATH_LOCK_TOKEN

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
  [ "$turnstile_secret_key_stdin" -eq 0 ] || set -- "$@" --turnstile-secret-key-stdin
  SUBWEB_ENV_LOCK_HELD=1 \
    SUBWEB_VERSION_LOCK_HELD=1 \
    SUBWEB_ENV_LOCK_DIRECTORY=$DEPLOY_ENV_LOCK_DIRECTORY \
    SUBWEB_ENV_LOCK_TOKEN=$DEPLOY_ENV_LOCK_TOKEN \
    SUBWEB_VERSION_LOCK_DIRECTORY=$DEPLOY_VERSION_LOCK_DIRECTORY \
    SUBWEB_VERSION_LOCK_TOKEN=$DEPLOY_VERSION_LOCK_TOKEN \
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
  compose_docker -f "$compose_file" "$@"
}

SUBWEB_ENV_LOCK_HELD=1 \
  SUBWEB_VERSION_LOCK_HELD=1 \
  SUBWEB_ENV_LOCK_TARGET=$PROJECT_DIRECTORY/.env \
  SUBWEB_ENV_LOCK_DIRECTORY=$DEPLOY_ENV_LOCK_DIRECTORY \
  SUBWEB_ENV_LOCK_TOKEN=$DEPLOY_ENV_LOCK_TOKEN \
  SUBWEB_VERSION_LOCK_DIRECTORY=$DEPLOY_VERSION_LOCK_DIRECTORY \
  SUBWEB_VERSION_LOCK_TOKEN=$DEPLOY_VERSION_LOCK_TOKEN \
  SHORT_LINKS_ENABLED=$short_links_enabled COMPOSE_VALIDATION_FILE=$compose_file \
  "$SCRIPT_DIRECTORY/validate-compose.sh"
if [ "$short_links_enabled" = true ]; then
  compose pull gateway subconverter myurls redis
else
  compose pull gateway subconverter
fi
compose up -d --no-build --pull never --remove-orphans --wait
compose ps

printf 'Docker image deployment started for https://%s.\n' "$app_domain"
