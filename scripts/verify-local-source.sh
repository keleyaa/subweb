#!/bin/sh
set -eu

case "$0" in /*) script_path=$0 ;; *) script_path=$PWD/${0#./} ;; esac
script_directory=$(CDPATH= cd -- "${script_path%/*}" && pwd -P)
project_root=$(CDPATH= cd -- "$script_directory/.." && pwd -P)
runtime_root=$project_root/.runtime/local

fail() { printf '本机源码验证失败: %s\n' "$1" >&2; exit 1; }
for command_name in node npm curl openssl; do command -v "$command_name" >/dev/null 2>&1 || fail "缺少 $command_name"; done
temporary_root=${TMPDIR:-/tmp}
case "$temporary_root" in /*) ;; *) fail 'TMPDIR 必须是绝对路径' ;; esac
verification_root=$(mktemp -d "${temporary_root%/}/subweb-local-verify.XXXXXX")

before_myurls=
before_subconverter=
if [ -x "$runtime_root/bin/myurls" ]; then before_myurls=$(shasum -a 256 "$runtime_root/bin/myurls" | awk '{print $1}'); fi
if [ -x "$runtime_root/bin/subconverter" ]; then before_subconverter=$(shasum -a 256 "$runtime_root/bin/subconverter" | awk '{print $1}'); fi
"$project_root/scripts/local/bootstrap.sh" >/dev/null
after_first_myurls=$(shasum -a 256 "$runtime_root/bin/myurls" | awk '{print $1}')
after_first_subconverter=$(shasum -a 256 "$runtime_root/bin/subconverter" | awk '{print $1}')
"$project_root/scripts/local/bootstrap.sh" >/dev/null
[ "$after_first_myurls" = "$(shasum -a 256 "$runtime_root/bin/myurls" | awk '{print $1}')" ] || fail 'MyUrls 产物在重复 bootstrap 后变化'
[ "$after_first_subconverter" = "$(shasum -a 256 "$runtime_root/bin/subconverter" | awk '{print $1}')" ] || fail 'SubConverter 产物在重复 bootstrap 后变化'
[ -z "$before_myurls" ] || [ "$before_myurls" = "$after_first_myurls" ] || fail 'MyUrls 产物发生非预期变化'
[ -z "$before_subconverter" ] || [ "$before_subconverter" = "$after_first_subconverter" ] || fail 'SubConverter 产物发生非预期变化'

cleanup() {
  "$project_root/scripts/local/stop.sh" >/dev/null 2>&1 || true
  rm -rf "$verification_root"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
"$project_root/scripts/local/start.sh" >/dev/null
"$project_root/scripts/local/status.sh" >/dev/null || fail '默认端口状态检查失败'

read_port() { awk -F= -v key="$1" '$1 == key { print $2 }' "$runtime_root/config/local.env"; }
app_port=$(read_port LOCAL_APP_PORT)
api_port=$(read_port LOCAL_API_PORT)
short_port=$(read_port LOCAL_SHORT_PORT)
vite_port=$(read_port LOCAL_VITE_PORT)
subconverter_port=$(read_port LOCAL_SUBCONVERTER_PORT)
myurls_port=$(read_port LOCAL_MYURLS_PORT)
redis_port=$(read_port LOCAL_REDIS_PORT)
curl --noproxy '*' --fail --silent "http://127.0.0.1:$app_port/" | grep -q 'Subconverter Web' || fail 'APP 功能哨兵失败'
curl --noproxy '*' --fail --silent "http://127.0.0.1:$api_port/healthz" >/dev/null || fail 'API 功能哨兵失败'
curl --noproxy '*' --fail --silent "http://127.0.0.1:$short_port/healthz" >/dev/null || fail 'SHORT 功能哨兵失败'
url_encode() { URL_VALUE=$1 node -e 'process.stdout.write(encodeURIComponent(process.env.URL_VALUE))'; }
subscription_url='https://raw.githubusercontent.com/Aethersailor/SubConverter-Extended/v1.2.0/tests/fixtures/sample-subscription.txt'
encoded_subscription=$(url_encode "$subscription_url")
curl --noproxy '*' --fail --silent \
  "http://127.0.0.1:$api_port/sub?target=clash&url=$encoded_subscription" \
  > "$verification_root/conversion.out" || fail '订阅转换哨兵失败'
grep -Eq 'proxy-(providers|groups):' "$verification_root/conversion.out" || fail '订阅转换输出不符合 Clash 契约'
short_key="l$(openssl rand -hex 8)"
long_url="https://example.com/local-verification/$(openssl rand -hex 8)"
form_body="longUrl=$(url_encode "$long_url")&shortKey=$short_key"
curl --noproxy '*' --fail --silent \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data "$form_body" "http://127.0.0.1:$app_port/short-api/short" \
  > "$verification_root/short.json" || fail '短链创建哨兵失败'
SHORT_JSON=$verification_root/short.json node <<'NODE' || fail '短链响应契约失败'
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.env.SHORT_JSON, 'utf8'));
if (payload.Code !== 1 || typeof payload.ShortUrl !== 'string') process.exit(1);
NODE
curl --noproxy '*' --silent --show-error -D "$verification_root/redirect.headers" -o /dev/null \
  "http://127.0.0.1:$app_port/$short_key" || fail '短链跳转哨兵失败'
grep -Fqi "Location: $long_url" "$verification_root/redirect.headers" || fail '短链跳转目标不一致'
printf '%s\n' '默认端口转换、短链和跳转哨兵=通过'
"$project_root/scripts/local/stop.sh" >/dev/null
[ ! -e "$runtime_root/active-run" ] || fail 'stop 后仍存在 active-run'

for occupied_port in "$vite_port" "$subconverter_port" "$myurls_port" "$redis_port" "$app_port" "$api_port" "$short_port"; do
  node - "$occupied_port" <<'NODE' &
const net = require('node:net');
const server = net.createServer();
server.once('error', () => process.exit(1));
server.listen(Number(process.argv[2]), '127.0.0.1');
setInterval(() => {}, 1000);
NODE
  listener_pid=$!
  node -e 'setTimeout(() => {}, 500)'
  if ! kill -0 "$listener_pid" 2>/dev/null; then
    kill -TERM "$listener_pid" 2>/dev/null || true
    wait "$listener_pid" 2>/dev/null || true
    fail "端口 $occupied_port 无法建立测试监听器（可能已被外部进程占用）"
  fi
  if "$project_root/scripts/local/start.sh" > "$verification_root/occupied.out" 2>&1; then
    kill -TERM "$listener_pid" 2>/dev/null || true
    wait "$listener_pid" 2>/dev/null || true
    fail "端口占用时 start 意外成功: $occupied_port"
  fi
  kill -0 "$listener_pid" 2>/dev/null || fail "start 影响了端口占用进程: $occupied_port"
  [ ! -e "$runtime_root/active-run" ] || fail '端口冲突失败后出现 active-run'
  kill -TERM "$listener_pid" 2>/dev/null || true
  wait "$listener_pid" 2>/dev/null || true
done
printf '%s\n' '七个默认端口冲突均在启动前安全失败=通过'

custom_vite=$((app_port + 10))
custom_subconverter=$((custom_vite + 1))
custom_myurls=$((custom_vite + 2))
custom_redis=$((custom_vite + 3))
custom_app=$((custom_vite + 4))
custom_api=$((custom_vite + 5))
custom_short=$((custom_vite + 6))
LOCAL_VITE_PORT=$custom_vite LOCAL_SUBCONVERTER_PORT=$custom_subconverter LOCAL_MYURLS_PORT=$custom_myurls \
LOCAL_REDIS_PORT=$custom_redis LOCAL_APP_PORT=$custom_app LOCAL_API_PORT=$custom_api LOCAL_SHORT_PORT=$custom_short \
  "$project_root/scripts/local/start.sh" >/dev/null
"$project_root/scripts/local/status.sh" >/dev/null || fail '自定义端口状态检查失败'
[ "$(read_port LOCAL_APP_PORT)" = "$custom_app" ] || fail '自定义 APP 端口未派生'
[ "$(read_port LOCAL_API_PORT)" = "$custom_api" ] || fail '自定义 API 端口未派生'
[ "$(read_port LOCAL_SHORT_PORT)" = "$custom_short" ] || fail '自定义 SHORT 端口未派生'

# 测试短链功能在 SHORT 端口上可用
rm -f "$verification_root/short-redirect.headers"
curl --noproxy '*' --silent --show-error -D "$verification_root/short-redirect.headers" -o /dev/null \
  "http://127.0.0.1:$custom_short/$short_key" || fail 'SHORT 端口短链无法访问'
grep -Fqi "Location: $long_url" "$verification_root/short-redirect.headers" || fail 'SHORT 端口短链目标不一致'

rm -f "$verification_root/redirect.headers"
curl --noproxy '*' --silent --show-error -D "$verification_root/redirect.headers" -o /dev/null \
  "http://127.0.0.1:$custom_app/$short_key" || fail '重启后旧短链无法访问'
grep -Fqi "Location: $long_url" "$verification_root/redirect.headers" || fail '重启后旧短链目标不一致'
printf '%s\n' '七个自定义端口派生和 Redis 持久性=通过'
"$project_root/scripts/local/stop.sh" >/dev/null
for port in "$vite_port" "$subconverter_port" "$myurls_port" "$redis_port" "$app_port" "$api_port" "$short_port" \
  "$custom_vite" "$custom_subconverter" "$custom_myurls" "$custom_redis" "$custom_app" "$custom_api" "$custom_short"; do
  node - "$port" <<'NODE' || fail "端口未释放: $port"
const net = require('node:net');
const port = Number(process.argv[2]);
const server = net.createServer();
server.once('error', () => process.exit(1));
server.listen(port, '127.0.0.1', () => server.close(() => process.exit(0)));
NODE
done
printf '%s\n' 'stop 幂等和端口释放=通过'
