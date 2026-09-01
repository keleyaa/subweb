#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

usage() {
  fail '用法: render-simple-gateway-config.sh --template-root ABSOLUTE_PATH --output ABSOLUTE_PATH --nginx-bin PATH [--resolv-conf ABSOLUTE_PATH]'
}

template_root=''
output=''
nginx_bin=''
resolv_conf=/etc/resolv.conf

while [ "$#" -gt 0 ]; do
  case "$1" in
    --template-root|--output|--nginx-bin|--resolv-conf)
      [ "$#" -ge 2 ] || usage
      case "$1" in
        --template-root) template_root=$2 ;;
        --output) output=$2 ;;
        --nginx-bin) nginx_bin=$2 ;;
        --resolv-conf) resolv_conf=$2 ;;
      esac
      shift 2
      ;;
    *) usage ;;
  esac
done

case "$template_root:$output:$resolv_conf" in
  /*:/*:/*) ;;
  *) usage ;;
esac
case "$nginx_bin" in
  /*|[A-Za-z0-9_.-]*) ;;
  *) usage ;;
esac

reject_control_characters() {
  case "$1" in
    *'
'*|*'\r'*) return 1 ;;
  esac
}

for value in "$template_root" "$output" "$nginx_bin" "$resolv_conf" \
  "${APP_DOMAIN:-}" "${API_DOMAIN:-}" "${SHORT_DOMAIN:-}" \
  "${SUBCONVERTER_UPSTREAM:-}" "${MYURLS_UPSTREAM:-}" \
  "${MYURLS_MAX_BODY_BYTES:-}" "${RUNTIME_SITE_ROOT:-}"; do
  reject_control_characters "$value" || fail '网关环境变量不能包含换行或回车'
done

require_value() {
  [ -n "$2" ] || fail "缺少必需的网关配置: $1"
}

require_value APP_DOMAIN "${APP_DOMAIN:-}"
require_value API_DOMAIN "${API_DOMAIN:-}"
require_value SHORT_DOMAIN "${SHORT_DOMAIN:-}"
require_value SUBCONVERTER_UPSTREAM "${SUBCONVERTER_UPSTREAM:-}"
require_value MYURLS_UPSTREAM "${MYURLS_UPSTREAM:-}"
require_value MYURLS_MAX_BODY_BYTES "${MYURLS_MAX_BODY_BYTES:-}"

APP_DOMAIN=$(printf '%s' "$APP_DOMAIN" | tr '[:upper:]' '[:lower:]')
API_DOMAIN=$(printf '%s' "$API_DOMAIN" | tr '[:upper:]' '[:lower:]')
SHORT_DOMAIN=$(printf '%s' "$SHORT_DOMAIN" | tr '[:upper:]' '[:lower:]')
RUNTIME_SITE_ROOT=${RUNTIME_SITE_ROOT:-/tmp/nginx/runtime-site}

validate_domain() {
  [ "${#1}" -le 253 ] || return 1
  printf '%s\n' "$1" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'
}

validate_upstream() {
  printf '%s\n' "$1" | grep -Eq '^http://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?:[0-9]{1,5}$' || return 1
  port=${1##*:}
  [ "$port" -ge 1 ] 2>/dev/null && [ "$port" -le 65535 ]
}

validate_domain "$APP_DOMAIN" || fail 'APP_DOMAIN 不是有效的纯域名'
validate_domain "$API_DOMAIN" || fail 'API_DOMAIN 不是有效的纯域名'
validate_domain "$SHORT_DOMAIN" || fail 'SHORT_DOMAIN 不是有效的纯域名'
[ "$APP_DOMAIN" != "$API_DOMAIN" ] || fail 'APP_DOMAIN 和 API_DOMAIN 不能相同'
[ "$APP_DOMAIN" != "$SHORT_DOMAIN" ] || fail 'APP_DOMAIN 和 SHORT_DOMAIN 不能相同'
[ "$API_DOMAIN" != "$SHORT_DOMAIN" ] || fail 'API_DOMAIN 和 SHORT_DOMAIN 不能相同'
validate_upstream "$SUBCONVERTER_UPSTREAM" || fail 'SUBCONVERTER_UPSTREAM 必须是无路径的 http:// 主机和端口'
validate_upstream "$MYURLS_UPSTREAM" || fail 'MYURLS_UPSTREAM 必须是无路径的 http:// 主机和端口'
printf '%s\n' "$MYURLS_MAX_BODY_BYTES" | grep -Eq '^[0-9]+$' || fail 'MYURLS_MAX_BODY_BYTES 必须为十进制字节数'
[ "$MYURLS_MAX_BODY_BYTES" -ge 1 ] 2>/dev/null && [ "$MYURLS_MAX_BODY_BYTES" -le 16384 ] || fail 'MYURLS_MAX_BODY_BYTES 必须在 1 到 16384 之间'
printf '%s\n' "$RUNTIME_SITE_ROOT" | grep -Eq '^/[A-Za-z0-9._/-]+$' || fail 'RUNTIME_SITE_ROOT 必须是绝对路径'

[ -r "$resolv_conf" ] || fail 'DNS resolver 配置文件不存在或不可读'
nginx_resolver=$(awk '$1 == "nameserver" { print $2; exit }' "$resolv_conf")
printf '%s\n' "$nginx_resolver" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || fail 'DNS resolver 必须包含有效的 IPv4 nameserver'
[ -f "$template_root/simple.conf.template" ] || fail '简化网关模板不存在'
output_dir=${output%/*}
[ -d "$output_dir" ] || fail '网关配置输出目录不存在'
[ ! -d "$output" ] || fail '网关配置输出不能是目录'

umask 077
temp_dir=$(mktemp -d "$output_dir/.simple-gateway-render.XXXXXX") || fail '无法创建私有网关渲染目录'
rendered_config=$temp_dir/nginx.conf
cleanup() {
  rm -rf "$temp_dir"
}
trap cleanup EXIT HUP INT TERM

sed \
  -e "s|@@APP_DOMAIN@@|$APP_DOMAIN|g" \
  -e "s|@@API_DOMAIN@@|$API_DOMAIN|g" \
  -e "s|@@SHORT_DOMAIN@@|$SHORT_DOMAIN|g" \
  -e "s|@@SUBCONVERTER_UPSTREAM@@|$SUBCONVERTER_UPSTREAM|g" \
  -e "s|@@MYURLS_UPSTREAM@@|$MYURLS_UPSTREAM|g" \
  -e "s|@@MYURLS_MAX_BODY_BYTES@@|$MYURLS_MAX_BODY_BYTES|g" \
  -e "s|@@RUNTIME_SITE_ROOT@@|$RUNTIME_SITE_ROOT|g" \
  -e "s|@@NGINX_RESOLVER@@|$nginx_resolver|g" \
  "$template_root/simple.conf.template" > "$rendered_config"

if grep -q '@@' "$rendered_config"; then
  fail '简化网关配置包含未替换的模板标记'
fi
LD_LIBRARY_PATH= "$nginx_bin" -e /dev/stderr -t -q -c "$rendered_config" >/dev/null || fail 'Nginx 拒绝了简化网关配置'
mv "$rendered_config" "$output" || fail '无法原子替换网关配置'
