#!/bin/sh
set -eu

case "$0" in /*) bootstrap_path=$0 ;; *) bootstrap_path=$PWD/${0#./} ;; esac
script_directory=$(CDPATH= cd -- "${bootstrap_path%/*}" && pwd -P)
project_root=$(CDPATH= cd -- "$script_directory/../.." && pwd -P)

# shellcheck source=lib/common.sh
. "$script_directory/lib/common.sh"
# shellcheck source=lib/sources.sh
. "$script_directory/lib/sources.sh"
# shellcheck source=../../lib/config.sh
. "$project_root/scripts/lib/config.sh"

platform=$(uname -s 2>/dev/null || printf unknown)
case "$platform" in
  Darwin|Linux) ;;
  *Microsoft*|*microsoft*) platform=Linux ;;
  MINGW*|MSYS*|CYGWIN*) local_error '原生 Windows 不受支持，请在 WSL2 中运行'; exit 1 ;;
  *) local_error "不支持的本机系统: $platform"; exit 1 ;;
esac

required_tools='node npm go cmake redis-server redis-cli nginx git curl lsof openssl'
missing_tools=
for tool in $required_tools; do
  command -v "$tool" >/dev/null 2>&1 || missing_tools="$missing_tools $tool"
done
if [ -n "$missing_tools" ]; then
  printf '缺少本机源码运行依赖:%s\n' "$missing_tools" >&2
  case "$platform" in
    Darwin) printf '%s\n' '请手动安装缺失依赖；Homebrew 用户可参考 brew install node go cmake redis nginx git curl lsof openssl。' >&2 ;;
    Linux) printf '%s\n' '请手动安装缺失依赖；Debian/Ubuntu 用户可参考 apt install nodejs npm golang cmake redis-server nginx git curl lsof openssl。' >&2 ;;
    *) printf '%s\n' '请根据当前系统文档手动安装上述依赖。' >&2 ;;
  esac
  exit 1
fi

lock_file=$project_root/deploy/versions.lock.json
[ -f "$lock_file" ] || { local_error '缺少 deploy/versions.lock.json'; exit 1; }
read_lock_value() {
  service=$1
  field=$2
  node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const value = data.services?.[process.argv[2]]?.source?.[process.argv[3]];
if (typeof value !== "string" || value.length === 0) process.exit(1);
process.stdout.write(value);
' "$lock_file" "$service" "$field"
}

myurls_commit=$(read_lock_value myurls commit) || { local_error 'MyUrls lock is invalid'; exit 1; }
myurls_url=$(read_lock_value myurls url) || { local_error 'MyUrls source URL is invalid'; exit 1; }
subconverter_commit=$(read_lock_value subconverter commit) || { local_error 'SubConverter lock is invalid'; exit 1; }
subconverter_url=$(read_lock_value subconverter url) || { local_error 'SubConverter source URL is invalid'; exit 1; }

runtime_root=$project_root/.runtime/local
for directory in "$runtime_root" "$runtime_root/bin" "$runtime_root/build" \
  "$runtime_root/config" "$runtime_root/pids" "$runtime_root/logs" \
  "$runtime_root/redis" "$runtime_root/nginx"; do
  ensure_private_directory "$directory" || exit 1
done

secrets_file=$runtime_root/secrets.env
[ ! -L "$secrets_file" ] && [ ! -d "$secrets_file" ] \
  || { local_error '本机秘密文件不能是符号链接或目录'; exit 1; }
if [ -f "$secrets_file" ]; then
  myurls_api_token=$(load_existing_secret "$secrets_file" MYURLS_API_TOKEN) \
    || { local_error '现有本机 MyUrls Token 无效'; exit 1; }
  redis_password=$(load_existing_secret "$secrets_file" REDIS_PASSWORD) \
    || { local_error '现有本机 Redis 密码无效'; exit 1; }
else
  myurls_api_token=$(generate_hex_secret) || { local_error '无法生成本机 MyUrls Token'; exit 1; }
  redis_password=$(generate_hex_secret) || { local_error '无法生成本机 Redis 密码'; exit 1; }
  CONFIG_TEMP_FILE=
  CONFIG_MOVED_FILE=
  write_env_atomically "$secrets_file" <<EOF || { local_error '无法写入本机秘密'; exit 1; }
MYURLS_API_TOKEN=$myurls_api_token
REDIS_PASSWORD=$redis_password
EOF
fi
unset myurls_api_token redis_password

if [ -n "${XDG_CACHE_HOME:-}" ]; then
  cache_home=$XDG_CACHE_HOME
elif [ -n "${HOME:-}" ]; then
  cache_home=$HOME/.cache
else
  local_error '必须提供绝对 XDG_CACHE_HOME 或 HOME'
  exit 1
fi
case "$cache_home" in /*) ;; *) local_error 'XDG_CACHE_HOME 或 HOME 必须产生绝对缓存路径'; exit 1 ;; esac
source_cache=$cache_home/subweb/sources
myurls_source=$(ensure_pinned_source myurls "$myurls_url" "$myurls_commit" "${MYURLS_SOURCE_DIR:-}" "$source_cache") || exit 1
subconverter_source=$(ensure_pinned_source subconverter "$subconverter_url" "$subconverter_commit" "${SUBCONVERTER_SOURCE_DIR:-}" "$source_cache") || exit 1

lock_digest=$(node -e '
const fs = require("node:fs");
const crypto = require("node:crypto");
process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
' "$project_root/package-lock.json")
package_marker=$runtime_root/build/package-lock.sha256
installed_digest=
[ -f "$package_marker" ] && installed_digest=$(sed -n '1p' "$package_marker")
if [ ! -d "$project_root/node_modules" ] || [ "$installed_digest" != "$lock_digest" ]; then
  (cd "$project_root" && npm ci)
  printf '%s\n' "$lock_digest" > "$package_marker.tmp"
  chmod 0600 "$package_marker.tmp"
  mv -f "$package_marker.tmp" "$package_marker"
fi

myurls_binary=$runtime_root/bin/myurls
myurls_binary_temp=$runtime_root/bin/.myurls.$$
trap 'rm -f "$myurls_binary_temp"' EXIT HUP INT TERM
(cd "$myurls_source" && go build -trimpath -o "$myurls_binary_temp" .)
chmod 0700 "$myurls_binary_temp"
mv -f "$myurls_binary_temp" "$myurls_binary"
trap - EXIT HUP INT TERM

build_jobs=${BUILD_JOBS:-}
if [ -z "$build_jobs" ]; then build_jobs=$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf 2); fi
case "$build_jobs" in ''|*[!0-9]*) local_error 'BUILD_JOBS 必须是正整数'; exit 1 ;; esac
[ "$build_jobs" -ge 1 ] || { local_error 'BUILD_JOBS 必须是正整数'; exit 1; }
subconverter_build=$runtime_root/build/subconverter
cmake -S "$subconverter_source" -B "$subconverter_build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$subconverter_build" --config Release --parallel "$build_jobs"
subconverter_candidates=$(find "$subconverter_build" -type f -name subconverter -perm -111 -print)
subconverter_binary=$(printf '%s\n' "$subconverter_candidates" | sed -n '1p')
subconverter_candidate_count=$(printf '%s\n' "$subconverter_candidates" | awk 'NF { count += 1 } END { print count + 0 }')
[ "$subconverter_candidate_count" -eq 1 ] \
  || { local_error 'CMake 构建未产生唯一的 subconverter 可执行文件'; exit 1; }
subconverter_link=$runtime_root/bin/subconverter
ln -sfn "$subconverter_binary" "$subconverter_link.tmp"
mv -f "$subconverter_link.tmp" "$subconverter_link"

sources_file=$runtime_root/config/sources.env
umask 077
{
  printf 'MYURLS_SOURCE_DIR=%s\n' "$myurls_source"
  printf 'MYURLS_SOURCE_COMMIT=%s\n' "$myurls_commit"
  printf 'SUBCONVERTER_SOURCE_DIR=%s\n' "$subconverter_source"
  printf 'SUBCONVERTER_SOURCE_COMMIT=%s\n' "$subconverter_commit"
  printf 'SUBCONVERTER_BUILD_DIR=%s\n' "$subconverter_build"
  printf 'SUBCONVERTER_BINARY=%s\n' "$subconverter_binary"
} > "$sources_file.tmp"
chmod 0600 "$sources_file.tmp"
mv -f "$sources_file.tmp" "$sources_file"

printf '%s\n' '本机源码依赖已按锁定版本准备完成。'
