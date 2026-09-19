#!/bin/sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib/config.sh
. "$SCRIPT_DIRECTORY/lib/config.sh"
# shellcheck source=lib/release-image.sh
. "$SCRIPT_DIRECTORY/lib/release-image.sh"

fail() {
  printf 'Installation error: %s\n' "$1" >&2
  exit 1
}

restore_secret_tty() {
  stty echo < "$secret_tty" 2>/dev/null || true
}

prompt_secret() {
  secret_tty=/dev/tty
  [ -r "$secret_tty" ] || fail 'Turnstile Secret Key requires an interactive terminal.'

  printf 'Turnstile Secret Key (hidden): ' > "$secret_tty"
  stty -echo < "$secret_tty" 2>/dev/null \
    || fail 'Unable to hide Turnstile Secret Key input.'
  trap 'restore_secret_tty' EXIT
  trap 'restore_secret_tty; exit 1' HUP INT TERM

  secret_read_status=0
  if IFS= read -r turnstile_secret_key < "$secret_tty"; then
    :
  else
    secret_read_status=$?
  fi

  if ! stty echo < "$secret_tty" 2>/dev/null; then
    trap - HUP INT TERM
    fail 'Unable to restore terminal echo after reading Turnstile Secret Key.'
  fi
  trap - EXIT HUP INT TERM
  printf '\n' > "$secret_tty"

  if [ "$secret_read_status" -ne 0 ] && [ -z "$turnstile_secret_key" ]; then
    fail 'A Turnstile Secret Key is required.'
  fi
  [ -n "$turnstile_secret_key" ] || fail 'A Turnstile Secret Key is required.'
}

prompt_required() {
  prompt=$1
  value=
  printf '%s' "$prompt" >&2
  if IFS= read -r value || [ -n "$value" ]; then
    :
  else
    printf 'A value is required.\n' >&2
    exit 1
  fi
  [ -n "$value" ] || {
    printf 'A value is required.\n' >&2
    exit 1
  }
}

prompt_required 'APP domain: '
app_domain=$value
prompt_required 'API domain: '
api_domain=$value
validate_domain "$app_domain" \
  || fail 'APP domain must be a plain hostname.'
validate_domain "$api_domain" \
  || fail 'API domain must be a plain hostname.'
validate_distinct_domains "$app_domain" "$api_domain" \
  || fail 'APP and API domains must be different.'

while :; do
  prompt_required 'Enable short links (true/false): '
  short_links_enabled=$value
  case "$short_links_enabled" in
    true|false) break ;;
    *) printf 'Invalid value: expected true or false.\n' >&2 ;;
  esac
done

short_domain=
turnstile_site_key=
if [ "$short_links_enabled" = true ]; then
  prompt_required 'SHORT domain: '
  short_domain=$value
  validate_domain "$short_domain" \
    || fail 'SHORT domain must be a plain hostname.'
  validate_distinct_domains "$app_domain" "$api_domain" "$short_domain" \
    || fail 'SHORT, APP, and API domains must be different.'
  prompt_required 'Turnstile Site Key: '
  turnstile_site_key=$value
fi

trusted_proxy_cidr=
printf 'Trusted proxy CIDR (optional): ' >&2
if IFS= read -r trusted_proxy_cidr || [ -n "$trusted_proxy_cidr" ]; then
  :
else
  trusted_proxy_cidr=
fi
[ -z "$trusted_proxy_cidr" ] || validate_ipv4_cidr "$trusted_proxy_cidr" \
  || fail 'TRUSTED_PROXY_CIDR must be a canonical IPv4 CIDR.'

prompt_required 'Gateway version (vX.Y.Z): '
gateway_version=$value
if resolved_image=$(resolve_release_image "$gateway_version" </dev/null); then
  :
else
  exit 1
fi

printf '\nDeployment summary\n' >&2
printf '  APP domain: %s\n' "$app_domain" >&2
printf '  API domain: %s\n' "$api_domain" >&2
if [ "$short_links_enabled" = true ]; then
  printf '  SHORT domain: %s\n' "$short_domain" >&2
fi
printf '  Profile: %s\n' "$short_links_enabled" >&2
if [ -n "$trusted_proxy_cidr" ]; then
  printf '  Trusted proxy CIDR: %s\n' "$trusted_proxy_cidr" >&2
else
  printf '  Trusted proxy CIDR: none\n' >&2
fi
printf '  Gateway version: %s\n' "$gateway_version" >&2
printf '  Immutable image: %s\n' "$resolved_image" >&2

confirmation=
printf 'Continue with this deployment (yes/no): ' >&2
if IFS= read -r confirmation || [ -n "$confirmation" ]; then
  :
else
  confirmation=
fi
if [ "$confirmation" != yes ]; then
  printf 'Deployment cancelled.\n' >&2
  exit 1
fi

turnstile_secret_key=
if [ "$short_links_enabled" = true ]; then
  prompt_secret
fi

set -- \
  --app-domain "$app_domain" \
  --api-domain "$api_domain" \
  --short-links-enabled "$short_links_enabled"
if [ "$short_links_enabled" = true ]; then
  set -- "$@" \
    --short-domain "$short_domain" \
    --turnstile-site-key "$turnstile_site_key" \
    --turnstile-secret-key-stdin
fi
if [ -n "$trusted_proxy_cidr" ]; then
  set -- "$@" --trusted-proxy-cidr "$trusted_proxy_cidr"
fi

if [ "$short_links_enabled" = true ]; then
  printf '%s\n' "$turnstile_secret_key" \
    | exec "$SCRIPT_DIRECTORY/docker-deploy.sh" "$@" --image "$resolved_image"
else
  exec "$SCRIPT_DIRECTORY/docker-deploy.sh" "$@" --image "$resolved_image"
fi
