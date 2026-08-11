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

required_tools='node npm go cmake pkg-config redis-server redis-cli nginx git curl lsof openssl tar bash file'
missing_tools=
for tool in $required_tools; do
  command -v "$tool" >/dev/null 2>&1 || missing_tools="$missing_tools $tool"
done
if [ -n "$missing_tools" ]; then
  printf '缺少本机源码运行依赖:%s\n' "$missing_tools" >&2
  case "$platform" in
    Darwin) printf '%s\n' '请手动安装缺失依赖；Homebrew 用户可参考 brew install node go cmake pkg-config redis nginx git curl lsof openssl rapidjson yaml-cpp pcre2。' >&2 ;;
    Linux) printf '%s\n' '请手动安装缺失依赖；Debian/Ubuntu 用户可参考 apt install nodejs npm golang cmake pkg-config redis-server nginx git curl lsof openssl build-essential libcurl4-openssl-dev libpcre2-dev rapidjson-dev libyaml-cpp-dev。' >&2 ;;
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

subconverter_dependency_lock=$subconverter_source/scripts/ci/dependencies.lock.json
[ -f "$subconverter_dependency_lock" ] \
  || { local_error 'SubConverter dependency lock is missing'; exit 1; }
read_subconverter_dependency() {
  dependency=$1
  field=$2
  node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const value = data.git?.[process.argv[2]]?.[process.argv[3]];
if (typeof value !== "string" || value.length === 0) process.exit(1);
process.stdout.write(value);
' "$subconverter_dependency_lock" "$dependency" "$field"
}

quickjspp_url=$(read_subconverter_dependency quickjspp repository) \
  || { local_error 'SubConverter quickjspp dependency URL is invalid'; exit 1; }
quickjspp_commit=$(read_subconverter_dependency quickjspp revision) \
  || { local_error 'SubConverter quickjspp dependency revision is invalid'; exit 1; }
libcron_url=$(read_subconverter_dependency libcron repository) \
  || { local_error 'SubConverter libcron dependency URL is invalid'; exit 1; }
libcron_commit=$(read_subconverter_dependency libcron revision) \
  || { local_error 'SubConverter libcron dependency revision is invalid'; exit 1; }
quickjspp_source=$(ensure_pinned_source quickjspp "$quickjspp_url" "$quickjspp_commit" '' "$source_cache") || exit 1
libcron_source=$(ensure_pinned_source libcron "$libcron_url" "$libcron_commit" '' "$source_cache") || exit 1
git -C "$quickjspp_source" submodule update --init --recursive
git -C "$libcron_source" submodule update --init --recursive

subconverter_work_source=$runtime_root/build/subconverter-source
subconverter_source_marker=$subconverter_work_source/.subweb-source-revision
prepared_subconverter_revision=
[ -f "$subconverter_source_marker" ] && prepared_subconverter_revision=$(sed -n '1p' "$subconverter_source_marker")
if [ "$prepared_subconverter_revision" != "$subconverter_commit" ]; then
  rm -rf "$subconverter_work_source"
  mkdir -p "$subconverter_work_source"
  # Never pipe git archive into tar: macOS BSD tar reports success on empty
  # input, which would mask a failed archive and leave a broken source tree.
  subconverter_archive=$runtime_root/build/.subconverter-archive.$$
  trap 'rm -f "$subconverter_archive"' EXIT HUP INT TERM
  if ! git -C "$subconverter_source" archive "$subconverter_commit" > "$subconverter_archive" \
    || ! tar -x -f "$subconverter_archive" -C "$subconverter_work_source"; then
    rm -f "$subconverter_archive"
    local_error '无法解包锁定版本的 SubConverter 源码'
    exit 1
  fi
  rm -f "$subconverter_archive"
  trap - EXIT HUP INT TERM
  printf '%s\n' "$subconverter_commit" > "$subconverter_source_marker"
fi

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
myurls_binary_temp=$(mktemp "$runtime_root/bin/.myurls.XXXXXX") \
  || { local_error '无法创建 MyUrls 临时产物路径'; exit 1; }
trap 'rm -f "$myurls_binary_temp"' EXIT HUP INT TERM
(cd "$myurls_source" && go build -trimpath -o "$myurls_binary_temp" .)
chmod 0700 "$myurls_binary_temp"
mv -f "$myurls_binary_temp" "$myurls_binary"
trap - EXIT HUP INT TERM

build_jobs=${BUILD_JOBS:-}
if [ -z "$build_jobs" ]; then build_jobs=$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf 2); fi
case "$build_jobs" in ''|*[!0-9]*) local_error 'BUILD_JOBS 必须是正整数'; exit 1 ;; esac
[ "$build_jobs" -ge 1 ] || { local_error 'BUILD_JOBS 必须是正整数'; exit 1; }
subconverter_dependency_prefix=$runtime_root/build/subconverter-dependencies
mkdir -p "$subconverter_dependency_prefix/include" "$subconverter_dependency_prefix/lib/quickjs"

quickjs_marker=$subconverter_dependency_prefix/.quickjspp-revision
installed_quickjs_revision=
[ -f "$quickjs_marker" ] && installed_quickjs_revision=$(sed -n '1p' "$quickjs_marker")
if [ "$installed_quickjs_revision" != "$quickjspp_commit" ] \
  || [ ! -f "$subconverter_dependency_prefix/lib/quickjs/libquickjs.a" ]; then
  quickjs_build=$runtime_root/build/quickjspp
  rm -rf "$quickjs_build"
  cmake -S "$quickjspp_source" -B "$quickjs_build" -DCMAKE_BUILD_TYPE=Release
  cmake --build "$quickjs_build" --config Release --target quickjs --parallel "$build_jobs"
  quickjs_library=$(find "$quickjs_build" -type f -name libquickjs.a -print | sed -n '1p')
  [ -n "$quickjs_library" ] || { local_error 'quickjspp build did not produce libquickjs.a'; exit 1; }
  install -m 0644 "$quickjs_library" "$subconverter_dependency_prefix/lib/quickjs/libquickjs.a"
  mkdir -p "$subconverter_dependency_prefix/include/quickjs"
  install -m 0644 "$quickjspp_source/quickjs/quickjs.h" "$quickjspp_source/quickjs/quickjs-libc.h" \
    "$subconverter_dependency_prefix/include/quickjs/"
  install -m 0644 "$quickjspp_source/quickjspp.hpp" "$subconverter_dependency_prefix/include/quickjspp.hpp"
  printf '%s\n' "$quickjspp_commit" > "$quickjs_marker.tmp"
  mv -f "$quickjs_marker.tmp" "$quickjs_marker"
fi

libcron_marker=$subconverter_dependency_prefix/.libcron-revision
installed_libcron_revision=
[ -f "$libcron_marker" ] && installed_libcron_revision=$(sed -n '1p' "$libcron_marker")
if [ "$installed_libcron_revision" != "$libcron_commit" ] \
  || [ ! -f "$subconverter_dependency_prefix/lib/liblibcron.a" ]; then
  libcron_build=$runtime_root/build/libcron
  rm -rf "$libcron_build"
  cmake -S "$libcron_source" -B "$libcron_build" -DCMAKE_BUILD_TYPE=Release
  cmake --build "$libcron_build" --config Release --target libcron --parallel "$build_jobs"
  libcron_library=$(find "$libcron_build" "$libcron_source/libcron/out" -type f -name liblibcron.a -print 2>/dev/null | sed -n '1p')
  [ -n "$libcron_library" ] || { local_error 'libcron build did not produce liblibcron.a'; exit 1; }
  install -m 0644 "$libcron_library" "$subconverter_dependency_prefix/lib/liblibcron.a"
  mkdir -p "$subconverter_dependency_prefix/include/libcron" "$subconverter_dependency_prefix/include/date"
  install -m 0644 "$libcron_source/libcron/include/libcron/"* "$subconverter_dependency_prefix/include/libcron/"
  install -m 0644 "$libcron_source/libcron/externals/date/include/date/"* "$subconverter_dependency_prefix/include/date/"
  printf '%s\n' "$libcron_commit" > "$libcron_marker.tmp"
  mv -f "$libcron_marker.tmp" "$libcron_marker"
fi

if [ ! -f "$subconverter_work_source/bridge/libmihomo.a" ] \
  || [ ! -f "$subconverter_work_source/bridge/libmihomo.h" ]; then
  (cd "$subconverter_work_source" && bash bridge/build.sh)
fi

subconverter_build=$runtime_root/build/subconverter
cmake -S "$subconverter_work_source" -B "$subconverter_build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="$subconverter_dependency_prefix" \
  -DCMAKE_LIBRARY_PATH="$subconverter_dependency_prefix/lib" \
  -DCMAKE_INCLUDE_PATH="$subconverter_dependency_prefix/include"
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
  printf 'SUBCONVERTER_SOURCE_DIR=%s\n' "$subconverter_work_source"
  printf 'SUBCONVERTER_CHECKOUT_DIR=%s\n' "$subconverter_source"
  printf 'SUBCONVERTER_SOURCE_COMMIT=%s\n' "$subconverter_commit"
  printf 'SUBCONVERTER_BUILD_DIR=%s\n' "$subconverter_build"
  printf 'SUBCONVERTER_BINARY=%s\n' "$subconverter_binary"
} > "$sources_file.tmp"
chmod 0600 "$sources_file.tmp"
mv -f "$sources_file.tmp" "$sources_file"

printf '%s\n' '本机源码依赖已按锁定版本准备完成。'
