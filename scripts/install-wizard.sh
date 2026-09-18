#!/bin/sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIRECTORY/lib/release-image.sh"

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

set -- \
  --app-domain "$app_domain" \
  --api-domain "$api_domain" \
  --short-links-enabled "$short_links_enabled"
if [ "$short_links_enabled" = true ]; then
  set -- "$@" \
    --short-domain "$short_domain" \
    --turnstile-site-key "$turnstile_site_key"
fi
if [ -n "$trusted_proxy_cidr" ]; then
  set -- "$@" --trusted-proxy-cidr "$trusted_proxy_cidr"
fi

exec "$SCRIPT_DIRECTORY/docker-deploy.sh" "$@" --image "$resolved_image"
