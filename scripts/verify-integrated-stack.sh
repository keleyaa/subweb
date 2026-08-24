#!/bin/sh
set -eu

usage() {
  printf '%s\n' '用法: verify-integrated-stack.sh --mode behind-proxy|direct-tls' >&2
  exit 2
}

mode=
mode_count=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)
      [ "$#" -ge 2 ] || usage
      mode=$2
      mode_count=$((mode_count + 1))
      shift 2
      ;;
    *) usage ;;
  esac
done
[ "$mode_count" -eq 1 ] || usage
case "$mode" in behind-proxy|direct-tls) ;; *) usage ;; esac

command -v docker >/dev/null 2>&1 || { printf '%s\n' '缺少 Docker' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { printf '%s\n' '缺少 curl' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { printf '%s\n' '缺少 Node.js' >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { printf '%s\n' '缺少 openssl' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { printf '%s\n' '缺少 Docker Compose v2' >&2; exit 1; }

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_directory/.." && pwd)
compose_file=$repository_root/compose.yaml
certificate_creator=$repository_root/scripts/test-support/create-test-certificate.sh
myurls_test_image=${MYURLS_IMAGE:-}
if [ -z "$myurls_test_image" ]; then
  node "$repository_root/scripts/verify-version-locks.mjs" >/dev/null \
    || { printf '%s\n' 'MyUrls 集成测试镜像锁无效' >&2; exit 1; }
  myurls_test_image=$(node - "$repository_root/deploy/versions.lock.json" <<'NODE'
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
  ) || { printf '%s\n' '无法读取 MyUrls 集成测试镜像锁' >&2; exit 1; }
fi
temporary_root=${TMPDIR:-/tmp}
case "$temporary_root" in /*) ;; *) printf '%s\n' 'TMPDIR 必须是绝对路径' >&2; exit 1 ;; esac
[ -d "$temporary_root" ] \
  || { printf '%s\n' 'TMPDIR 必须是已存在的目录' >&2; exit 1; }
temporary_root=$(CDPATH= cd -- "$temporary_root" && pwd -P) \
  || { printf '%s\n' '无法解析 TMPDIR' >&2; exit 1; }
temporary_directory=$(mktemp -d "${temporary_root%/}/subweb-integration.XXXXXX")
project_suffix=$(openssl rand -hex 6)
project_name="subweb-verify-$project_suffix"
env_file=$temporary_directory/stack.env
command_log=$temporary_directory/compose.log
service_log=$temporary_directory/services.log
listener_container=
port_probe_container=
cleanup_complete=0

cleanup() {
  [ "$cleanup_complete" -eq 0 ] || return 0
  cleanup_complete=1
  if [ -n "$listener_container" ]; then
    docker stop "$listener_container" >/dev/null 2>&1 || true
    listener_container=
  fi
  if [ -n "$port_probe_container" ]; then
    docker stop "$port_probe_container" >/dev/null 2>&1 || true
    port_probe_container=
  fi
  if [ -f "$env_file" ]; then
    docker compose -p "$project_name" -f "$compose_file" --env-file "$env_file" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -f "$env_file" "$command_log" "$service_log"
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
const secrets = [process.env.SENTINEL_VALUE, process.env.TOKEN_VALUE, process.env.PASSWORD_VALUE]
  .filter(Boolean);
let output = lines.join('\n');
for (const secret of secrets) output = output.split(secret).join('[REDACTED]');
process.stderr.write(`${output.slice(0, 16384)}\n`);
NODE
  fi
  exit 1
}

compose() {
  docker compose -p "$project_name" -f "$compose_file" --env-file "$env_file" "$@"
}

random_hex() {
  openssl rand -hex "$1"
}

make_test_certificate() {
  output_directory=$1
  app_domain=$2
  api_domain=$3
  short_domain=${4:-}
  if [ -n "$short_domain" ]; then
    "$certificate_creator" "$output_directory" "$app_domain" "$api_domain" "$short_domain" >/dev/null
  else
    "$certificate_creator" "$output_directory" "$app_domain" "$api_domain" >/dev/null
  fi
  chmod 0644 "$output_directory/fullchain.pem" "$output_directory/privkey.pem"
}

random_loopback_port() {
  node <<'NODE'
const net = require('node:net');
const server = net.createServer();
server.unref();
server.on('error', () => process.exit(1));
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port));
  server.close();
});
NODE
}

tcp_connects() {
  node - "$1" "$2" <<'NODE'
const net = require('node:net');
const socket = net.createConnection({ host: process.argv[2], port: Number(process.argv[3]) });
const timeout = setTimeout(() => {
  socket.destroy();
  process.exit(1);
}, 1000);
socket.once('connect', () => {
  clearTimeout(timeout);
  socket.destroy();
  process.exit(0);
});
socket.once('error', () => {
  clearTimeout(timeout);
  process.exit(1);
});
NODE
}

docker_port_is_available() {
  probe_port=$1
  port_probe_container="subweb-port-probe-$project_suffix-$probe_port"
  if ! docker run --detach --rm --name "$port_probe_container" \
    --publish "$probe_port:6379" \
    "${REDIS_IMAGE:-docker.io/library/redis:8-alpine}" \
    redis-server --save '' --appendonly no \
    > "$temporary_directory/port-probe-$probe_port.log" 2>&1; then
    return 1
  fi
  docker stop "$port_probe_container" >/dev/null 2>&1 || return 1
  port_probe_container=
}

url_encode() {
  URL_VALUE=$1 node -e 'process.stdout.write(encodeURIComponent(process.env.URL_VALUE))'
}

write_environment() {
  profile=$1
  certificate_path=${2:-}
  key_path=${3:-}
  short_domain=${4:-}
  umask 077
  {
    printf 'COMPOSE_PROFILES=%s\n' "$profile"
    printf 'APP_DOMAIN=app.test\n'
    printf 'API_DOMAIN=api.app.test\n'
    if [ -n "$short_domain" ]; then
      printf 'DOMAIN_MODE=three-domain\n'
      printf 'SHORT_DOMAIN=%s\n' "$short_domain"
      printf 'API_URL=https://api.app.test\n'
      printf 'SHORT_URL=https://%s/short-api\n' "$short_domain"
    else
      printf 'DOMAIN_MODE=legacy\n'
      printf 'API_URL=https://api.app.test\n'
      printf 'SHORT_URL=https://app.test/short-api\n'
    fi
    printf 'SUBWEB_PORT=%s\n' "$host_port"
    printf 'TLS_CERT_PATH=%s\n' "$certificate_path"
    printf 'TLS_KEY_PATH=%s\n' "$key_path"
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

wait_for_service_health() {
  wait_for_health "$1" || fail "服务健康检查超时: $1"
}

http_request() {
  curl --noproxy '*' --fail --silent --show-error "$@"
}

assert_internal_ports_private() {
  for service_port in 'redis 6379' 'myurls 8080' 'subconverter 25500'; do
    set -- $service_port
    service=$1
    internal_port=$2
    container_id=$(compose ps -q "$service")
    published=$(docker port "$container_id" "$internal_port/tcp" 2>/dev/null || true)
    [ -z "$published" ] || fail '内部服务意外发布了宿主机端口'
    binding=$(docker inspect --format "{{with index .NetworkSettings.Ports \"$internal_port/tcp\"}}{{json .}}{{end}}" "$container_id")
    [ -z "$binding" ] || [ "$binding" = null ] || fail '内部服务存在端口绑定'
  done
  compose config --format json > "$temporary_directory/compose.json"
  node - "$temporary_directory/compose.json" <<'NODE' || exit 1
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const service of ['redis', 'myurls', 'subconverter']) {
  if (config.services[service].ports !== undefined) process.exit(1);
}
NODE
  for internal_port in 6379 8080 25500; do
    if tcp_connects 127.0.0.1 "$internal_port"; then
      fail "宿主 loopback 可连接内部端口: $internal_port"
    fi
  done
  printf '%s\n' '宿主 loopback 内部端口拒绝=通过'
  printf '%s\n' '内部端口未发布=通过'
}

verify_business_contracts() {
  scheme=$1
  app_base=$2
  api_base=$3
  curl_tls_args=
  if [ "$scheme" = https ]; then
    curl_tls_args='--insecure'
  fi

  # shellcheck disable=SC2086
  app_body=$(http_request $curl_tls_args -H 'Host: app.test' "$app_base/") \
    || fail 'APP Host 无法访问'
  printf '%s' "$app_body" | grep -q 'Subconverter Web' || fail 'APP Host 未返回 Subweb'
  printf '%s\n' 'APP Host=通过'

  subscription_url="https://raw.githubusercontent.com/Aethersailor/SubConverter-Extended/v1.2.0/tests/fixtures/sample-subscription.txt?subscription_token=$sentinel_value"
  encoded_subscription=$(url_encode "$subscription_url")
  # shellcheck disable=SC2086
  http_request $curl_tls_args -H 'Host: api.app.test' \
    "$api_base/sub?target=clash&url=$encoded_subscription" \
    > "$temporary_directory/conversion.out" || fail 'API 最小转换失败'
  [ -s "$temporary_directory/conversion.out" ] || fail 'API 转换结果为空'
  grep -Eq 'proxy-(providers|groups):' "$temporary_directory/conversion.out" \
    || fail 'API 转换结果不符合 Clash 契约'
  printf '%s\n' 'API 转换=通过'

  short_key="v$(random_hex 8)"
  long_url="https://example.com/path?verification=$(random_hex 8)"
  form_body="longUrl=$(url_encode "$long_url")&shortKey=$short_key"
  # shellcheck disable=SC2086
  http_request $curl_tls_args -H 'Host: app.test' \
    -H 'Origin: https://app.test' \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -H 'Authorization: Bearer client-forged-value' \
    --data "$form_body" "$app_base/short-api/short" \
    > "$temporary_directory/short.json" || fail '网关短链创建失败'
  SHORT_JSON=$temporary_directory/short.json node <<'NODE' \
    || fail 'MyUrls 创建响应不符合契约'
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.env.SHORT_JSON, 'utf8'));
if (payload.Code !== 1 || typeof payload.ShortUrl !== 'string') process.exit(1);
if (!payload.ShortUrl.startsWith('https://app.test/')) process.exit(1);
NODE
  printf '%s\n' '内部鉴权覆盖=通过'

  # shellcheck disable=SC2086
  http_request $curl_tls_args -D "$temporary_directory/redirect.headers" -o /dev/null \
    -H 'Host: app.test' "$app_base/$short_key" || fail '短码无法访问'
  grep -Fqi "Location: $long_url" "$temporary_directory/redirect.headers" \
    || fail '短码没有跳转到原目标'
  printf '%s\n' '短链创建与跳转=通过'

  compose restart redis > "$command_log" 2>&1 || fail 'Redis 重启失败'
  wait_for_service_health redis
  compose restart myurls >> "$command_log" 2>&1 || fail 'MyUrls 重启失败'
  wait_for_service_health myurls
  wait_for_service_health "$gateway_service"
  rm -f "$temporary_directory/redirect.headers"
  # shellcheck disable=SC2086
  http_request $curl_tls_args -D "$temporary_directory/redirect.headers" -o /dev/null \
    -H 'Host: app.test' "$app_base/$short_key" || fail '重启后短码无法访问'
  grep -Fqi "Location: $long_url" "$temporary_directory/redirect.headers" \
    || fail '重启后短码没有跳转到原目标'
  printf '%s\n' 'Redis 重启持久性=通过'

  assert_internal_ports_private

  # 漂移检测工具自检：本栈卷为新建，镜像与运行卷内容必然一致，应返回 0。
  # 该工具同时暴露 "latest 镜像升级后运行卷沿用旧 /base" 的运维风险。
  COMPOSE_FILE=$compose_file COMPOSE_ENV_FILES=$env_file COMPOSE_PROJECT_NAME=$project_name \
    "$repository_root/scripts/verify-subconverter-runtime.sh" \
    > "$temporary_directory/runtime-drift.out" \
    || fail 'SubConverter runtime drift check failed on a fresh stack'
  grep -q 'runtime volume matches the resolved image' "$temporary_directory/runtime-drift.out" \
    || fail 'SubConverter runtime drift check produced unexpected output'
  printf '%s\n' 'SubConverter 运行卷漂移检测=通过'
}

scan_logs() {
  leak_count=0
  for log_service in "$gateway_service" myurls subconverter redis; do
    compose logs --no-color --tail 500 "$log_service" > "$service_log" 2>&1 \
      || fail '无法读取受限容器日志'
    if grep -Fq "$sentinel_value" "$service_log"; then
      leak_count=$((leak_count + 1))
      printf '隐私泄漏来源=%s:subscription\n' "$log_service" >&2
    fi
    if grep -Fq "$subscription_url" "$service_log"; then
      leak_count=$((leak_count + 1))
      printf '隐私泄漏来源=%s:full-subscription-url\n' "$log_service" >&2
    fi
    if grep -Fq "$myurls_api_token" "$service_log"; then
      leak_count=$((leak_count + 1))
      printf '隐私泄漏来源=%s:internal-token\n' "$log_service" >&2
    fi
  done
  printf '哨兵泄漏数=%s\n' "$leak_count"
  [ "$leak_count" -eq 0 ] || fail '服务日志包含隐私哨兵或内部 Token'
}

verify_no_gateway_service() {
  container_id=$(compose ps -aq gateway-tls 2>/dev/null || true)
  if [ -n "$container_id" ]; then
    running=$(docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null || true)
    if [ "$running" = true ] && curl --noproxy '*' --silent --show-error --max-time 2 --insecure \
      https://127.0.0.1/ >/dev/null 2>&1; then
      fail 'TLS 拒绝场景意外启动了对外网关'
    fi
  fi
}

reset_stack() {
  compose down --volumes --remove-orphans > "$command_log" 2>&1 || fail '无法清理当前测试栈'
}

prepare_rejection_dependencies() {
  compose up -d --no-build --wait --wait-timeout 240 redis myurls subconverter \
    > "$command_log" 2>&1 || fail 'TLS 拒绝场景的内部依赖未能启动'
  wait_for_health 'myurls subconverter redis' \
    || fail 'TLS 拒绝场景的内部依赖未保持健康'
}

expect_tls_rejection() {
  label=$1
  evidence_type=$2
  evidence_value=$3
  prepare_rejection_dependencies
  if compose up -d --no-build --wait --wait-timeout 90 gateway-tls > "$command_log" 2>&1; then
    fail "TLS 拒绝场景意外成功: $label"
  fi
  compose logs --no-color --tail 100 gateway-tls >> "$command_log" 2>&1 || true
  case "$evidence_type" in
    missing-bind)
      [ ! -e "$evidence_value" ] || fail '缺失文件拒绝场景的输入文件意外存在'
      grep -Eiq 'does not exist|not found|no such file|invalid mount' "$command_log" \
        || fail '缺失文件拒绝场景没有匹配到受控错误证据'
      ;;
    gateway-log)
      grep -Fq "$evidence_value" "$command_log" \
        || fail "TLS 拒绝场景没有匹配到网关错误证据: $label"
      ;;
    occupied-port)
      blocker_running=$(docker inspect --format '{{.State.Running}}' "$listener_container" 2>/dev/null || true)
      [ "$blocker_running" = true ] && tcp_connects 127.0.0.1 "$evidence_value" \
        || fail '端口拒绝场景的受控占用容器未运行'
      grep -Eiq 'address already in use|port is already allocated|failed to bind' "$command_log" \
        || fail '端口拒绝场景没有匹配到绑定失败证据'
      ;;
    *) fail '未知的 TLS 拒绝证据类型' ;;
  esac
  wait_for_health 'myurls subconverter redis' \
    || fail 'TLS 拒绝后内部依赖不再健康'
  verify_no_gateway_service
  printf 'TLS 拒绝路径（%s）=通过\n' "$label"
  reset_stack
}

start_port_listener() {
  listener_port=$1
  listener_container="subweb-port-blocker-$project_suffix-$listener_port"
  docker run --detach --rm --name "$listener_container" \
    --publish "$listener_port:6379" \
    "${REDIS_IMAGE:-docker.io/library/redis:8-alpine}" \
    redis-server --save '' --appendonly no \
    > "$temporary_directory/listener.log" 2>&1 || return 1
  deadline=$(( $(date +%s) + 10 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if tcp_connects 127.0.0.1 "$listener_port"; then return 0; fi
    node -e 'setTimeout(() => {}, 100)'
  done
  return 1
}

myurls_api_token=$(random_hex 32)
redis_password=$(random_hex 32)
sentinel_value="sentinel-$(random_hex 16)"
host_port=$(random_loopback_port) || fail '无法分配 loopback 测试端口'

if [ "$mode" = behind-proxy ]; then
  gateway_service=gateway-http
  write_environment behind-proxy
  compose up -d --build --wait --wait-timeout 240 > "$command_log" 2>&1 \
    || fail 'behind-proxy 栈启动失败'
  wait_for_health 'gateway-http myurls subconverter redis' \
    || fail 'behind-proxy 四服务未在时限内健康'
  verify_business_contracts http "http://127.0.0.1:$host_port" "http://127.0.0.1:$host_port"
  scan_logs
else
  gateway_service=gateway-tls
  if ! docker_port_is_available 80 || ! docker_port_is_available 443; then
    printf '%s\n' 'direct-tls 未执行：宿主机 80 或 443 已被外部服务占用' >&2
    exit 1
  fi
  certificate_directory=$temporary_directory/certificate
  mkdir "$certificate_directory"
  make_test_certificate "$certificate_directory" app.test api.app.test
  write_environment direct-tls "$certificate_directory/fullchain.pem" "$certificate_directory/privkey.pem"
  compose up -d --build --wait --wait-timeout 240 > "$command_log" 2>&1 \
    || fail 'direct-tls 栈启动失败'
  wait_for_health 'gateway-tls myurls subconverter redis' \
    || fail 'direct-tls 四服务未在时限内健康'
  redirect_status=$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' -H 'Host: app.test' http://127.0.0.1/)
  [ "$redirect_status" = 308 ] || fail 'HTTP 80 未返回 HTTPS 跳转'
  verify_business_contracts https 'https://127.0.0.1' 'https://127.0.0.1'
  scan_logs
  printf '%s\n' 'Legacy 双域名模式=通过'
  reset_stack

  # 三域名模式测试
  three_domain_cert=$temporary_directory/three-domain
  mkdir "$three_domain_cert"
  make_test_certificate "$three_domain_cert" app.test api.app.test short.test
  write_environment direct-tls "$three_domain_cert/fullchain.pem" "$three_domain_cert/privkey.pem" short.test
  compose up -d --build --wait --wait-timeout 240 > "$command_log" 2>&1 \
    || fail 'three-domain 栈启动失败'
  wait_for_health 'gateway-tls myurls subconverter redis' \
    || fail 'three-domain 四服务未在时限内健康'

  # 验证三个 Host 都可访问
  # http_request already supplies the quoted --noproxy '*' option; keeping the
  # direct-TLS flags here avoids unquoted glob expansion into repository paths.
  curl_tls_args='--silent --show-error --insecure --max-time 10'
  app_base=https://127.0.0.1
  api_base=https://127.0.0.1
  short_base=https://127.0.0.1

  # shellcheck disable=SC2086
  app_body=$(http_request $curl_tls_args -H 'Host: app.test' "$app_base/") \
    || fail 'Three-domain APP Host 无法访问'
  printf '%s' "$app_body" | grep -q 'Subconverter Web' || fail 'Three-domain APP Host 未返回 Subweb'

  # shellcheck disable=SC2086
  http_request $curl_tls_args -H 'Host: api.app.test' \
    "$api_base/sub?target=clash&url=https://example.com/sub.txt" \
    > "$temporary_directory/three-api.out" || fail 'Three-domain API Host 无法访问'

  # 验证短链域名提供 MyUrls 前端和其同源创建入口
  # shellcheck disable=SC2086
  short_ui_body=$(http_request $curl_tls_args -H 'Host: short.test' "$short_base/") \
    || fail 'Three-domain SHORT Host 首页无法访问'
  printf '%s' "$short_ui_body" | grep -q 'MyUrls' \
    || fail 'Three-domain SHORT Host 未返回 MyUrls 前端'
  short_ui_asset_status=$(curl --noproxy '*' $curl_tls_args -H 'Host: short.test' \
    -o /dev/null -w '%{http_code}' "$short_base/app.js")
  [ "$short_ui_asset_status" = 200 ] \
    || fail "Three-domain SHORT 前端资源无法访问，状态码: $short_ui_asset_status"

  three_ui_long_url="https://three-domain-ui.example.com/test?v=$(random_hex 8)"
  # shellcheck disable=SC2086
  http_request $curl_tls_args -H 'Host: short.test' \
    -H 'Origin: https://short.test' \
    -F "longUrl=$three_ui_long_url" \
    "$short_base/short" > "$temporary_directory/three-ui-short.json" \
    || fail 'Three-domain SHORT 前端创建失败'
  THREE_UI_SHORT_JSON=$temporary_directory/three-ui-short.json node <<'NODE' \
    || fail 'Three-domain SHORT 前端创建响应不符合契约'
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.env.THREE_UI_SHORT_JSON, 'utf8'));
if (payload.Code !== 1 || typeof payload.ShortUrl !== 'string') process.exit(1);
if (!payload.ShortUrl.startsWith('https://short.test/')) process.exit(1);
NODE

  # 测试短链创建（使用 short.test Host）
  three_short_key="t$(random_hex 8)"
  three_long_url="https://three-domain.example.com/test?v=$(random_hex 8)"
  three_form_body="longUrl=$(url_encode "$three_long_url")&shortKey=$three_short_key"
  # shellcheck disable=SC2086
  http_request $curl_tls_args -H 'Host: short.test' \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -H 'Origin: https://app.test' \
    --data "$three_form_body" "$short_base/short-api/short" \
    > "$temporary_directory/three-short.json" || fail 'Three-domain 短链创建失败'

  # 验证返回的短链 URL 使用 SHORT_DOMAIN
  THREE_SHORT_JSON=$temporary_directory/three-short.json node <<'NODE' \
    || fail 'Three-domain 短链响应不符合契约'
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.env.THREE_SHORT_JSON, 'utf8'));
if (payload.Code !== 1 || typeof payload.ShortUrl !== 'string') process.exit(1);
if (!payload.ShortUrl.startsWith('https://short.test/')) {
  console.error('Expected short URL to start with https://short.test/, got:', payload.ShortUrl);
  process.exit(1);
}
NODE

  # 测试短链跳转
  rm -f "$temporary_directory/three-redirect.headers"
  # shellcheck disable=SC2086
  http_request $curl_tls_args -D "$temporary_directory/three-redirect.headers" -o /dev/null \
    -H 'Host: short.test' "$short_base/$three_short_key" || fail 'Three-domain 短码无法访问'
  grep -Fqi "Location: $three_long_url" "$temporary_directory/three-redirect.headers" \
    || fail 'Three-domain 短码未跳转到目标'

  # 测试 CORS 预检请求
  # shellcheck disable=SC2086
  cors_status=$(curl --noproxy '*' $curl_tls_args -X OPTIONS -H 'Host: short.test' \
    -H 'Origin: https://app.test' \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: Content-Type' \
    -o /dev/null -w '%{http_code}' "$short_base/short-api/short")
  [ "$cors_status" = 204 ] || fail "Three-domain CORS 预检失败，状态码: $cors_status"

  blocked_cors_status=$(curl --noproxy '*' $curl_tls_args -X OPTIONS -H 'Host: short.test' \
    -H 'Origin: https://evil.test' \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: Content-Type' \
    -o /dev/null -w '%{http_code}' "$short_base/short-api/short")
  [ "$blocked_cors_status" = 403 ] || fail "Three-domain 恶意 Origin 预检未拒绝，状态码: $blocked_cors_status"

  blocked_post_status=$(curl --noproxy '*' $curl_tls_args -X POST -H 'Host: short.test' \
    -H 'Origin: https://evil.test' \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data 'longUrl=https%3A%2F%2Fevil.test%2Fblocked&shortKey=blocked-origin' \
    -o /dev/null -w '%{http_code}' "$short_base/short-api/short")
  [ "$blocked_post_status" = 403 ] || fail "Three-domain 恶意 Origin POST 未拒绝，状态码: $blocked_post_status"

  # 验证 APP 兼容入口仍然可用
  compat_short_key="c$(random_hex 8)"
  compat_long_url="https://compat.example.com/test?v=$(random_hex 8)"
  compat_form_body="longUrl=$(url_encode "$compat_long_url")&shortKey=$compat_short_key"
  # shellcheck disable=SC2086
  http_request $curl_tls_args -H 'Host: app.test' \
    -H 'Origin: https://app.test' \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data "$compat_form_body" "$app_base/short-api/short" \
    > "$temporary_directory/compat-short.json" || fail 'Three-domain APP 兼容入口创建失败'

  rm -f "$temporary_directory/compat-redirect.headers"
  # shellcheck disable=SC2086
  http_request $curl_tls_args -D "$temporary_directory/compat-redirect.headers" -o /dev/null \
    -H 'Host: app.test' "$app_base/$compat_short_key" || fail 'Three-domain APP 兼容短码无法访问'
  grep -Fqi "Location: $compat_long_url" "$temporary_directory/compat-redirect.headers" \
    || fail 'Three-domain APP 兼容短码未跳转'

  scan_logs
  printf '%s\n' 'Three-domain 三域名模式=通过'
  reset_stack

  write_environment direct-tls "$temporary_directory/missing.pem" "$temporary_directory/missing.key"
  expect_tls_rejection '缺少证书' missing-bind "$temporary_directory/missing.pem"

  mismatch_a=$temporary_directory/mismatch-a
  mismatch_b=$temporary_directory/mismatch-b
  mkdir "$mismatch_a" "$mismatch_b"
  make_test_certificate "$mismatch_a" app.test api.app.test
  make_test_certificate "$mismatch_b" app.test api.app.test
  write_environment direct-tls "$mismatch_a/fullchain.pem" "$mismatch_b/privkey.pem"
  expect_tls_rejection '证书与私钥不匹配' gateway-log 'TLS 证书和私钥不匹配'

  wrong_san=$temporary_directory/wrong-san
  mkdir "$wrong_san"
  make_test_certificate "$wrong_san" app.test other.test
  write_environment direct-tls "$wrong_san/fullchain.pem" "$wrong_san/privkey.pem"
  expect_tls_rejection '证书不覆盖 API 域名' gateway-log 'TLS 证书不覆盖 API_DOMAIN: api.app.test'

  # 测试三域名模式下的证书覆盖验证
  wrong_short=$temporary_directory/wrong-short
  mkdir "$wrong_short"
  make_test_certificate "$wrong_short" app.test api.app.test
  write_environment direct-tls "$wrong_short/fullchain.pem" "$wrong_short/privkey.pem" short.test
  expect_tls_rejection '三域名证书不覆盖 SHORT_DOMAIN' gateway-log 'TLS 证书不覆盖 SHORT_DOMAIN: short.test'

  write_environment direct-tls "$certificate_directory/fullchain.pem" "$certificate_directory/privkey.pem"
  start_port_listener 80 || fail '无法启动本任务的 80 端口占用监听器'
  expect_tls_rejection '宿主 80 端口被占用' occupied-port 80
  docker stop "$listener_container" >/dev/null 2>&1 || true
  listener_container=

  start_port_listener 443 || fail '无法启动本任务的 443 端口占用监听器'
  expect_tls_rejection '宿主 443 端口被占用' occupied-port 443
  docker stop "$listener_container" >/dev/null 2>&1 || true
  listener_container=
fi

cleanup
trap - EXIT HUP INT TERM
printf '集成模式=%s，验证完成\n' "$mode"
