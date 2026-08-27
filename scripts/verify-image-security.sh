#!/bin/sh
set -eu

ignore_file=/dev/null
if [ "${1:-}" = '--ignorefile' ]; then
  [ "$#" -ge 2 ] || {
    printf '%s\n' '--ignorefile 需要路径' >&2
    exit 2
  }
  ignore_file=$2
  shift 2
fi

[ "$#" -gt 0 ] || {
  printf '用法: %s [--ignorefile PATH] IMAGE [IMAGE ...]\n' "$0" >&2
  exit 2
}

[ -r "$ignore_file" ] || {
  printf 'Trivy ignorefile 不存在: %s\n' "$ignore_file" >&2
  exit 2
}

command -v trivy >/dev/null 2>&1 || {
  printf '镜像安全验证需要安装 trivy\n' >&2
  exit 2
}

for image in "$@"; do
  printf 'image security scan=%s\n' "$image"
  trivy image \
    --ignorefile "$ignore_file" \
    --ignore-unfixed \
    --pkg-types os,library \
    --scanners vuln \
    --severity CRITICAL,HIGH \
    --exit-code 1 \
    "$image"
done

printf '%s\n' 'image security verification=passed'
