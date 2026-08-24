#!/bin/sh
set -eu
umask 077

command -v docker >/dev/null 2>&1 || { printf '%s\n' '缺少 Docker' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { printf '%s\n' '缺少 curl' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { printf '%s\n' '缺少 Node.js' >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { printf '%s\n' '缺少 openssl' >&2; exit 1; }

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_directory/.." && pwd -P)
myurls_test_image=${MYURLS_IMAGE:-}
if [ -z "$myurls_test_image" ]; then
  node "$project_root/scripts/verify-version-locks.mjs" >/dev/null \
    || { printf '%s\n' 'MyUrls 运维测试镜像锁无效' >&2; exit 1; }
  myurls_test_image=$(node - "$project_root/deploy/versions.lock.json" <<'NODE'
const fs = require('node:fs');
const lock = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const image = lock.services?.myurls?.image;
if (
  !image ||
  typeof image.reference !== 'string' ||
  typeof image.digest !== 'string'
) {
  process.exit(1);
}
process.stdout.write(`${image.reference}@${image.digest}`);
NODE
  ) || { printf '%s\n' '无法读取 MyUrls 运维测试镜像锁' >&2; exit 1; }
fi
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/subweb-redis-operations.XXXXXX")
project_name=subweb-redis-operations-$(openssl rand -hex 6)
env_file=$temporary_directory/stack.env
backup_file=$temporary_directory/backup.rdb
short_key=ops$(openssl rand -hex 6)
long_url=https://example.com/redis-restore-verification
host_port=$(node -e '
const net = require("node:net");
const server = net.createServer();
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(String(server.address().port));
  server.close();
});
')
token=$(openssl rand -hex 32)
password=$(openssl rand -hex 32)

cleanup() {
  COMPOSE_FILE=$project_root/compose.yaml \
  COMPOSE_ENV_FILES=$env_file COMPOSE_PROJECT_NAME=$project_name \
    docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$temporary_directory"
}
trap cleanup EXIT HUP INT TERM

{
  printf 'COMPOSE_PROFILES=behind-proxy\n'
  printf 'APP_DOMAIN=app.test\n'
  printf 'API_DOMAIN=api.app.test\n'
  printf 'API_URL=https://api.app.test\n'
  printf 'SHORT_URL=https://app.test/short-api\n'
  printf 'SUBWEB_PORT=%s\n' "$host_port"
  [ -z "${REDIS_IMAGE:-}" ] || printf 'REDIS_IMAGE=%s\n' "$REDIS_IMAGE"
  printf 'MYURLS_IMAGE=%s\n' "$myurls_test_image"
  [ -z "${SUBCONVERTER_IMAGE:-}" ] || printf 'SUBCONVERTER_IMAGE=%s\n' "$SUBCONVERTER_IMAGE"
  printf 'MYURLS_API_TOKEN=%s\n' "$token"
  printf 'REDIS_PASSWORD=%s\n' "$password"
} > "$env_file"
chmod 0600 "$env_file"

export COMPOSE_FILE=$project_root/compose.yaml
export COMPOSE_ENV_FILES=$env_file
export COMPOSE_PROJECT_NAME=$project_name
export SUBWEB_OPERATIONS_RUNTIME_DIR=$temporary_directory/rollback

cd "$project_root"
docker compose up -d --build --wait >/dev/null

curl --noproxy '*' --fail --silent --show-error \
  -H 'Host: app.test' -H 'Origin: https://app.test' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data "longUrl=$long_url&shortKey=$short_key" \
  "http://127.0.0.1:$host_port/short-api/short" >/dev/null

redis_dbsize() {
  docker compose exec -T redis sh -eu -c \
    'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning DBSIZE' | awk 'NF { value=$1 } END { print value }'
}
created_count=$(redis_dbsize)
[ "$created_count" -gt 0 ] || { printf '%s\n' '短链创建后 Redis 仍为空' >&2; exit 1; }

"$script_directory/operations/backup-redis.sh" --output "$backup_file" >/dev/null
"$script_directory/operations/verify-redis-backup.sh" --backup "$backup_file" >/dev/null

docker compose exec -T redis sh -eu -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning FLUSHDB >/dev/null'
cleared_count=$(redis_dbsize)
[ "$cleared_count" -eq 0 ] || { printf '%s\n' 'Redis FLUSHDB 后仍有数据' >&2; exit 1; }
missing_status=$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' \
  -H 'Host: app.test' "http://127.0.0.1:$host_port/$short_key")
[ "$missing_status" != 301 ] && [ "$missing_status" != 302 ] \
  || { printf '%s\n' 'Redis 清空后短码仍然存在' >&2; exit 1; }

"$script_directory/operations/restore-redis.sh" \
  --backup "$backup_file" --confirm-stop-writes >/dev/null

restored_count=$(redis_dbsize)
[ "$restored_count" -eq "$created_count" ] \
  || { printf '恢复后 Redis key 数不一致: before=%s after=%s\n' "$created_count" "$restored_count" >&2; exit 1; }

headers=$temporary_directory/headers
curl --noproxy '*' --fail --silent --show-error -D "$headers" -o /dev/null \
  -H 'Host: app.test' "http://127.0.0.1:$host_port/$short_key"
grep -Fqi "Location: $long_url" "$headers" \
  || { printf '%s\n' '恢复后短码未指向原目标' >&2; exit 1; }

printf '%s\n' 'Redis 临时栈备份、校验、清空与恢复=通过'
