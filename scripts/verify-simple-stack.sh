#!/bin/sh
set -eu
umask 077

[ "$#" -eq 0 ] || { printf '%s\n' 'Usage: verify-simple-stack.sh' >&2; exit 2; }
for command in docker curl node openssl; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Missing command: %s\n' "$command" >&2
    exit 1
  }
done
docker compose version >/dev/null 2>&1 || {
  printf '%s\n' 'Docker Compose v2 is required.' >&2
  exit 1
}

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repository_root=$(CDPATH= cd -- "$script_directory/.." && pwd -P)
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/subweb-simple.XXXXXX")
project_name=subweb-simple-verify-$(openssl rand -hex 6)
env_file=$temporary_directory/stack.env
host_port=$(node -e 'const net = require("node:net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { process.stdout.write(String(server.address().port)); server.close(); });')
redis_password=$(openssl rand -hex 32)
ip_hash_secret=$(openssl rand -hex 32)

cleanup() {
  docker compose -p "$project_name" -f "$repository_root/compose.yaml" --env-file "$env_file" \
    down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$temporary_directory"
}
trap cleanup EXIT HUP INT TERM

fail() {
  printf 'Simple stack verification failed: %s\n' "$1" >&2
  docker compose -p "$project_name" -f "$repository_root/compose.yaml" --env-file "$env_file" \
    logs --no-color 2>/dev/null \
    | sed "s/$redis_password/[REDACTED]/g; s/$ip_hash_secret/[REDACTED]/g" >&2 || true
  exit 1
}

cat > "$env_file" <<EOF
APP_DOMAIN=app.test
API_DOMAIN=api.app.test
API_URL=https://api.app.test
SHORT_DOMAIN=short.app.test
SUBWEB_PORT=$host_port
TURNSTILE_SITE_KEY=test-site-key
TURNSTILE_SECRET_KEY=test-secret-key
REDIS_PASSWORD=$redis_password
IP_HASH_SECRET=$ip_hash_secret
EOF

compose() {
  docker compose -p "$project_name" -f "$repository_root/compose.yaml" --env-file "$env_file" "$@"
}

[ "$(compose config --services | LC_ALL=C sort | tr '\n' ' ')" = 'myurls redis subweb ' ] \
  || fail 'default Compose must define only myurls, redis, and subweb'
compose up --build --detach --wait || fail 'Compose services did not become healthy'
compose exec -T subweb sh -ceu '
  test "$MANAGED_CONFIG_PREFIX" = "https://api.app.test"
  test "$SUBCONVERTER_SECURITY_PROFILE" = public
  test "$SUBCONVERTER_ALLOW_PUBLIC_UPLOAD" = false
' || fail 'SubConverter default security and managed-config settings were not applied'

status_for() {
  curl --silent --output /dev/null --write-out '%{http_code}' \
    --header "Host: $1" "http://127.0.0.1:$host_port$2"
}

[ "$(status_for app.test /healthz)" = 200 ] || fail 'APP health endpoint was not reachable'
[ "$(status_for api.app.test /healthz)" = 200 ] || fail 'API health endpoint was not reachable'
[ "$(status_for short.app.test /healthz)" = 200 ] || fail 'SHORT health endpoint was not reachable'
[ "$(status_for short.app.test /api/links)" = 404 ] || fail 'SHORT domain exposed MyUrls API'

printf '%s\n' 'Simple three-service stack verification passed.'
