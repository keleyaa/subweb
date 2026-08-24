#!/bin/sh
set -eu

[ "$#" -eq 0 ] || { printf '%s\n' '用法: verify-integrated-stack.sh' >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { printf '%s\n' '缺少 Docker' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { printf '%s\n' '缺少 curl' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { printf '%s\n' '缺少 Node.js' >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { printf '%s\n' '缺少 openssl' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { printf '%s\n' '缺少 Docker Compose v2' >&2; exit 1; }

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_directory/.." && pwd)
compose_file=$repository_root/compose.yaml
myurls_test_image=${MYURLS_IMAGE:-}
if [ -z "$myurls_test_image" ]; then
  node "$repository_root/scripts/verify-version-locks.mjs" >/dev/null \
    || { printf '%s\n' 'MyUrls 集成测试镜像锁无效' >&2; exit 1; }
  myurls_test_image=$(node - "$repository_root/deploy/versions.lock.json" <<'NODE'
const fs = require('node:fs');
const lock = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const image = lock.services?.myurls?.image;
if (!image || typeof image.reference !== 'string' || typeof image.digest !== 'string') process.exit(1);
process.stdout.write(`${image.reference}@${image.digest}`);
NODE
  ) || { printf '%s\n' '无法读取 MyUrls 集成测试镜像锁' >&2; exit 1; }
fi

temporary_root=${TMPDIR:-/tmp}
case "$temporary_root" in /*) ;; *) printf '%s\n' 'TMPDIR 必须是绝对路径' >&2; exit 1 ;; esac
temporary_directory=$(mktemp -d "${temporary_root%/}/subweb-integration.XXXXXX")
project_suffix=$(openssl rand -hex 6)
project_name="subweb-verify-$project_suffix"
env_file=$temporary_directory/stack.env
command_log=$temporary_directory/compose.log
service_log=$temporary_directory/services.log
host_port=
cleanup_complete=0

cleanup() {
  [ "$cleanup_complete" -eq 0 ] || return 0
  cleanup_complete=1
  [ -f "$env_file" ] && docker compose -p "$project_name" -f "$compose_file" --env-file "$env_file" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$temporary_directory"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

fail() {
  printf '集成验证失败: %s\n' "$1" >&2
  if [ -f "$command_log" ]; then
    SENTINEL_VALUE=$sentinel_value TOKEN_VALUE=$myurls_api_token PASSWORD_VALUE=$redis_password \
      node - "$command_log" <<'NODE' >&2
const fs = require('node:fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).slice(-80);
const secrets = [process.env.SENTINEL_VALUE, process.env.TOKEN_VALUE, process.env.PASSWORD_VALUE].filter(Boolean);
let output = lines.join('\n');
for (const secret of secrets) output = output.split(secret).join('[REDACTED]');
process.stderr.write(`${output.slice(0, 16384)}\n`);
NODE
  fi
  exit 1
}

compose() { docker compose -p "$project_name" -f "$compose_file" --env-file "$env_file" "$@"; }
random_hex() { openssl rand -hex "$1"; }
url_encode() { URL_VALUE=$1 node -e 'process.stdout.write(encodeURIComponent(process.env.URL_VALUE))'; }

random_loopback_port() {
  node <<'NODE'
const net = require('node:net');
const server = net.createServer();
server.unref();
server.listen(0, '127.0.0.1', () => { process.stdout.write(String(server.address().port)); server.close(); });
NODE
}

write_environment() {
  umask 077
  {
    printf 'APP_DOMAIN=app.test\n'
    printf 'API_DOMAIN=api.app.test\n'
    printf 'API_URL=https://api.app.test\n'
    printf 'SHORT_DOMAIN=short.test\n'
    printf 'SHORT_URL=https://short.test/short-api\n'
    printf 'SUBWEB_PORT=%s\n' "$host_port"
    [ -z "${REDIS_IMAGE:-}" ] || printf 'REDIS_IMAGE=%s\n' "$REDIS_IMAGE"
    printf 'MYURLS_IMAGE=%s\n' "$myurls_test_image"
    [ -z "${SUBCONVERTER_IMAGE:-}" ] || printf 'SUBCONVERTER_IMAGE=%s\n' "$SUBCONVERTER_IMAGE"
    printf 'MYURLS_API_TOKEN=%s\n' "$myurls_api_token"
    printf 'REDIS_PASSWORD=%s\n' "$redis_password"
  } > "$env_file"
  chmod 0600 "$env_file"
}

wait_for_health() {
  services=$1
  deadline=$(( $(date +%s) + 240 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    all_healthy=1
    for service in $services; do
      container_id=$(compose ps -q "$service" 2>/dev/null || true)
      [ -n "$container_id" ] || { all_healthy=0; break; }
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
      [ "$health" = healthy ] || { all_healthy=0; break; }
    done
    [ "$all_healthy" -eq 1 ] && return 0
    node -e 'setTimeout(() => {}, 500)'
  done
  return 1
}

http_request() { curl --noproxy '*' --fail --silent --show-error "$@"; }

assert_internal_ports_private() {
  for service_port in 'redis 6379' 'myurls 8080' 'subconverter 25500'; do
    set -- $service_port
    container_id=$(compose ps -q "$1")
    published=$(docker port "$container_id" "$2/tcp" 2>/dev/null || true)
    [ -z "$published" ] || fail '内部服务意外发布了宿主机端口'
  done
  compose config --format json > "$temporary_directory/compose.json"
  node - "$temporary_directory/compose.json" <<'NODE' || fail 'Compose 内部端口契约失败'
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const service of ['redis', 'myurls', 'subconverter']) {
  if (config.services[service].ports !== undefined) process.exit(1);
}
NODE
}

verify_business_contracts() {
  app_body=$(http_request -H 'Host: app.test' "http://127.0.0.1:$host_port/") || fail 'APP Host 无法访问'
  printf '%s' "$app_body" | grep -q 'Subconverter Web' || fail 'APP Host 未返回 Subweb'

  subscription_url="https://raw.githubusercontent.com/Aethersailor/SubConverter-Extended/v1.2.0/tests/fixtures/sample-subscription.txt?subscription_token=$sentinel_value"
  encoded_subscription=$(url_encode "$subscription_url")
  http_request -H 'Host: api.app.test' \
    "http://127.0.0.1:$host_port/sub?target=clash&url=$encoded_subscription" \
    > "$temporary_directory/conversion.out" || fail 'API 最小转换失败'
  [ -s "$temporary_directory/conversion.out" ] || fail 'API 转换结果为空'
  grep -Eq 'proxy-(providers|groups):' "$temporary_directory/conversion.out" || fail 'API 转换结果不符合 Clash 契约'

  short_ui=$(http_request -H 'Host: short.test' "http://127.0.0.1:$host_port/") || fail 'SHORT Host 首页无法访问'
  printf '%s' "$short_ui" | grep -q 'MyUrls' || fail 'SHORT Host 未返回 MyUrls 前端'
  short_asset_status=$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' -H 'Host: short.test' "http://127.0.0.1:$host_port/app.js")
  [ "$short_asset_status" = 200 ] || fail "SHORT 前端资源无法访问: $short_asset_status"

  long_url="https://example.com/path?verification=$(random_hex 8)"
  short_key="v$(random_hex 8)"
  http_request -H 'Host: short.test' -H 'Origin: https://short.test' \
    -F "longUrl=$long_url" -F "shortKey=$short_key" \
    "http://127.0.0.1:$host_port/short" > "$temporary_directory/short.json" || fail 'SHORT 前端创建失败'
  SHORT_JSON=$temporary_directory/short.json node <<'NODE' || fail 'SHORT 创建响应不符合契约'
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.env.SHORT_JSON, 'utf8'));
if (payload.Code !== 1 || typeof payload.ShortUrl !== 'string' || !payload.ShortUrl.startsWith('https://short.test/')) process.exit(1);
NODE
  http_request -D "$temporary_directory/redirect.headers" -o /dev/null \
    -H 'Host: short.test' "http://127.0.0.1:$host_port/$short_key" || fail '短码无法访问'
  grep -Fqi "Location: $long_url" "$temporary_directory/redirect.headers" || fail '短码没有跳转到原目标'

  compat_key="c$(random_hex 8)"
  compat_url="https://compat.example.com/test?v=$(random_hex 8)"
  http_request -H 'Host: app.test' -H 'Origin: https://app.test' \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data "longUrl=$(url_encode "$compat_url")&shortKey=$compat_key" \
    "http://127.0.0.1:$host_port/short-api/short" > /dev/null || fail 'APP 兼容短链入口失败'

  cors_status=$(curl --noproxy '*' -sS -X OPTIONS -H 'Host: short.test' -H 'Origin: https://short.test' \
    -H 'Access-Control-Request-Method: POST' -o /dev/null -w '%{http_code}' \
    "http://127.0.0.1:$host_port/short")
  [ "$cors_status" = 204 ] || fail "SHORT CORS 预检失败: $cors_status"
  blocked_status=$(curl --noproxy '*' -sS -X OPTIONS -H 'Host: short.test' -H 'Origin: https://evil.test' \
    -H 'Access-Control-Request-Method: POST' -o /dev/null -w '%{http_code}' \
    "http://127.0.0.1:$host_port/short")
  [ "$blocked_status" = 403 ] || fail "恶意 Origin 未拒绝: $blocked_status"
}

scan_logs() {
  for log_service in gateway myurls subconverter redis; do
    compose logs --no-color --tail 500 "$log_service" > "$service_log" 2>&1 || fail '无法读取容器日志'
    if grep -Fq "$sentinel_value" "$service_log"; then
      fail "服务日志泄漏订阅哨兵: $log_service"
    fi
    if grep -Fq "$myurls_api_token" "$service_log"; then
      fail "服务日志泄漏内部 Token: $log_service"
    fi
  done
}

myurls_api_token=$(random_hex 32)
redis_password=$(random_hex 32)
sentinel_value="sentinel-$(random_hex 16)"
host_port=$(random_loopback_port) || fail '无法分配 loopback 测试端口'
write_environment
compose up -d --build --wait --wait-timeout 240 > "$command_log" 2>&1 || fail '单一 HTTP 栈启动失败'
wait_for_health 'gateway myurls subconverter redis' || fail '四服务未在时限内健康'
verify_business_contracts
compose restart redis >> "$command_log" 2>&1 || fail 'Redis 重启失败'
wait_for_health 'gateway myurls subconverter redis' || fail 'Redis 重启后服务未恢复健康'
assert_internal_ports_private
COMPOSE_FILE=$compose_file COMPOSE_ENV_FILES=$env_file COMPOSE_PROJECT_NAME=$project_name \
  "$repository_root/scripts/verify-subconverter-runtime.sh" > "$temporary_directory/runtime-drift.out" \
  || fail 'SubConverter runtime drift check failed on a fresh stack'
grep -q 'runtime volume matches the resolved image' "$temporary_directory/runtime-drift.out" \
  || fail 'SubConverter runtime drift check produced unexpected output'
scan_logs
printf '%s\n' '单一 HTTP 三域名集成验证=通过'
