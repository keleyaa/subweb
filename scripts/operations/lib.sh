#!/bin/sh

operations_script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
operations_project_root=$(CDPATH= cd -- "$operations_script_directory/../.." && pwd -P)

operations_fail() {
  printf 'Redis operation error: %s\n' "$1" >&2
  exit 1
}

require_docker() {
  command -v docker >/dev/null 2>&1 || operations_fail 'docker is required.'
}

require_absolute_regular_file() {
  case "$1" in /*) ;; *) operations_fail "$2 must be an absolute path." ;; esac
  [ -f "$1" ] && [ ! -L "$1" ] || operations_fail "$2 must be a regular file and not a symlink."
}

directory_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

require_private_directory() {
  [ -d "$1" ] && [ ! -L "$1" ] || operations_fail 'output directory must exist and not be a symlink.'
  mode=$(directory_mode "$1") || operations_fail 'unable to inspect output directory permissions.'
  mode_value=$((0$mode))
  [ $((mode_value & 077)) -eq 0 ] || operations_fail 'output directory must not grant group or other permissions.'
}

# 备份校验工具链有意使用锁文件基线的 Redis 镜像，而非运行栈跟随的 redis:latest：
# RDB 格式向后兼容，基线工具链提供确定性的 redis-check-rdb 与隔离校验环境，
# 避免校验行为随 latest 漂移。运行栈镜像升级导致 RDB 主版本变化时，
# preflight-upgrade.sh 的 Redis 主版本检查会先行拦截。
redis_image_reference() {
  node -e '
const fs = require("node:fs");
const lock = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const image = lock.services?.redis?.image;
if (!image?.reference || !/^sha256:[0-9a-f]{64}$/.test(image.digest ?? "")) process.exit(1);
process.stdout.write(`${image.reference}@${image.digest}`);
' "$operations_project_root/deploy/versions.lock.json" || operations_fail 'Redis image lock is invalid.'
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}
