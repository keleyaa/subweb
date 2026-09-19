#!/bin/sh
set -eu

PROJECT_ROOT=${SUBWEB_ROOT:-/opt/subweb}
ENV_FILE=${SUBWEB_ENV_FILE:-$PROJECT_ROOT/.env}
MIN_FREE_KIB=${MIN_FREE_KIB:-10485760}
fail() {
  printf 'VPS check failed: %s\n' "$1" >&2
  exit 1
}

case "$MIN_FREE_KIB" in
  ''|*[!0-9]*) fail 'MIN_FREE_KIB must be a non-negative decimal.' ;;
esac

[ "$(id -u)" -eq 0 ] || fail 'run as root.'
[ -d "$PROJECT_ROOT" ] && [ ! -L "$PROJECT_ROOT" ] \
  || fail 'configured deployment root must be a directory and not a symlink.'
command -v docker >/dev/null 2>&1 || fail 'Docker Engine is required.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required.'
command -v systemctl >/dev/null 2>&1 || fail 'systemd is required.'
command -v df >/dev/null 2>&1 || fail 'df is required.'

[ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || fail 'production .env must be a regular file.'
permissions=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null) \
  || fail 'unable to inspect production .env permissions.'
[ "$permissions" = 600 ] || fail 'production .env must be mode 0600.'

free_kib=$(df -Pk "$PROJECT_ROOT" | awk 'NR == 2 { print $4 }')
case "$free_kib" in
  ''|*[!0-9]*) fail 'unable to determine free disk space.' ;;
esac
[ "$free_kib" -ge "$MIN_FREE_KIB" ] || fail "free disk space is below ${MIN_FREE_KIB} KiB."

printf 'VPS host checks passed: docker-compose, systemd, .env mode 0600, free_kib=%s\n' "$free_kib"
