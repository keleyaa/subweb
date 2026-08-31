#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

usage() {
  fail '用法: render-gateway-config.sh --template-root ABSOLUTE_PATH --output ABSOLUTE_PATH --nginx-bin PATH [--resolv-conf ABSOLUTE_PATH]'
}

template_root=''
output=''
nginx_bin=''
resolv_conf=/etc/resolv.conf
seen_template_root=0
seen_output=0
seen_nginx_bin=0
seen_resolv_conf=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --template-root|--output|--nginx-bin|--resolv-conf)
      [ "$#" -ge 2 ] || usage
      case "$1" in
        --template-root)
          [ "$seen_template_root" -eq 0 ] || fail '不能重复传递 --template-root'
          seen_template_root=1
          template_root=$2
          ;;
        --output)
          [ "$seen_output" -eq 0 ] || fail '不能重复传递 --output'
          seen_output=1
          output=$2
          ;;
        --nginx-bin)
          [ "$seen_nginx_bin" -eq 0 ] || fail '不能重复传递 --nginx-bin'
          seen_nginx_bin=1
          nginx_bin=$2
          ;;
        --resolv-conf)
          [ "$seen_resolv_conf" -eq 0 ] || fail '不能重复传递 --resolv-conf'
          seen_resolv_conf=1
          resolv_conf=$2
          ;;
      esac
      shift 2
      ;;
    *) usage ;;
  esac
done

carriage_return=$(printf '\r')
reject_control_characters() {
  case "$1" in
    *'
'*|*"$carriage_return"*) return 1 ;;
  esac
}

for cli_value in "$template_root" "$output" "$nginx_bin" "$resolv_conf"; do
  reject_control_characters "$cli_value" \
    || fail '命令行路径不能包含换行或回车'
done

case "$template_root" in /*) ;; *) usage ;; esac
case "$output" in /*) ;; *) usage ;; esac
case "$resolv_conf" in /*) ;; *) usage ;; esac
case "$nginx_bin" in
  /*|[A-Za-z0-9_]*) ;;
  *) usage ;;
esac
for cli_path in "$template_root" "$output" "$resolv_conf"; do
  printf '%s\n' "$cli_path" | grep -Eq '^/[A-Za-z0-9._/-]+$' || usage
done
printf '%s\n' "$nginx_bin" | grep -Eq '^(/[A-Za-z0-9._/-]+|[A-Za-z0-9_.-]+)$' || usage

require_value() {
  name=$1
  is_set=$2
  [ "$is_set" = x ] || fail "缺少必需的网关配置: $name"
}

require_value APP_DOMAIN "${APP_DOMAIN+x}"
require_value API_DOMAIN "${API_DOMAIN+x}"
require_value SHORT_DOMAIN "${SHORT_DOMAIN+x}"
require_value SUBCONVERTER_UPSTREAM "${SUBCONVERTER_UPSTREAM+x}"
require_value MYURLS_APP_UPSTREAM "${MYURLS_APP_UPSTREAM+x}"
require_value MYURLS_SHORT_UPSTREAM "${MYURLS_SHORT_UPSTREAM+x}"
require_value MYURLS_MAX_BODY_BYTES "${MYURLS_MAX_BODY_BYTES+x}"
TRUSTED_PROXY_CIDR=${TRUSTED_PROXY_CIDR:-}
RUNTIME_SITE_ROOT=${RUNTIME_SITE_ROOT:-/tmp/nginx/runtime-site}

for external_value in "$APP_DOMAIN" "$API_DOMAIN" "$SHORT_DOMAIN" \
  "$SUBCONVERTER_UPSTREAM" "$MYURLS_APP_UPSTREAM" "$MYURLS_SHORT_UPSTREAM" \
  "$MYURLS_MAX_BODY_BYTES" "$TRUSTED_PROXY_CIDR" "$RUNTIME_SITE_ROOT"; do
  reject_control_characters "$external_value" \
    || fail '网关环境变量不能包含换行或回车'
done

# Browser Origin hosts are serialized in lowercase; normalize before templating.
APP_DOMAIN=$(printf '%s' "$APP_DOMAIN" | tr '[:upper:]' '[:lower:]')
API_DOMAIN=$(printf '%s' "$API_DOMAIN" | tr '[:upper:]' '[:lower:]')
SHORT_DOMAIN=$(printf '%s' "$SHORT_DOMAIN" | tr '[:upper:]' '[:lower:]')

validate_domain() {
  value=$1
  [ "${#value}" -le 253 ] || return 1
  printf '%s\n' "$value" \
    | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'
}

validate_upstream() {
  value=$1
  printf '%s\n' "$value" \
    | grep -Eq '^http://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?:[0-9]{1,5}$' \
    || return 1
  port=${value##*:}
  [ "$port" -ge 1 ] 2>/dev/null && [ "$port" -le 65535 ]
}

validate_ipv4() {
  value=$1
  printf '%s\n' "$value" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' \
    || return 1
  old_ifs=$IFS
  IFS=.
  set -- $value
  IFS=$old_ifs
  [ "$#" -eq 4 ] || return 1
  for octet in "$@"; do
    [ -n "$octet" ] && [ "$octet" -ge 0 ] 2>/dev/null && [ "$octet" -le 255 ] \
      || return 1
  done
}

validate_ipv4_cidr() {
  value=$1
  printf '%s\n' "$value" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$' \
    || return 1
  [ "$value" != '0.0.0.0/0' ] || return 1
  validate_ipv4 "${value%/*}"
}

http_listen=8080
public_scheme=https

validate_domain "$APP_DOMAIN" || fail 'APP_DOMAIN 不是有效的纯域名'
validate_domain "$API_DOMAIN" || fail 'API_DOMAIN 不是有效的纯域名'
validate_domain "$SHORT_DOMAIN" || fail 'SHORT_DOMAIN 不是有效的纯域名'
normalized_app=$(printf '%s' "$APP_DOMAIN" | tr '[:upper:]' '[:lower:]')
normalized_api=$(printf '%s' "$API_DOMAIN" | tr '[:upper:]' '[:lower:]')
normalized_short=$(printf '%s' "$SHORT_DOMAIN" | tr '[:upper:]' '[:lower:]')
[ "$normalized_app" != "$normalized_api" ] || fail 'APP_DOMAIN 和 API_DOMAIN 不能相同'
[ "$normalized_app" != "$normalized_short" ] || fail 'APP_DOMAIN 和 SHORT_DOMAIN 不能相同'
[ "$normalized_api" != "$normalized_short" ] || fail 'API_DOMAIN 和 SHORT_DOMAIN 不能相同'

validate_upstream "$SUBCONVERTER_UPSTREAM" || fail 'SUBCONVERTER_UPSTREAM 必须是无路径的 http:// 私网主机和端口'
validate_upstream "$MYURLS_APP_UPSTREAM" || fail 'MYURLS_APP_UPSTREAM 必须是无路径的 http:// 私网主机和端口'
validate_upstream "$MYURLS_SHORT_UPSTREAM" || fail 'MYURLS_SHORT_UPSTREAM 必须是无路径的 http:// 私网主机和端口'
printf '%s\n' "$MYURLS_MAX_BODY_BYTES" | grep -Eq '^[0-9]+$' \
  || fail 'MYURLS_MAX_BODY_BYTES 必须为十进制字节数'
[ "$MYURLS_MAX_BODY_BYTES" -ge 1 ] 2>/dev/null && [ "$MYURLS_MAX_BODY_BYTES" -le 16384 ] \
  || fail 'MYURLS_MAX_BODY_BYTES 必须在 1 到 16384 之间'
[ -z "$TRUSTED_PROXY_CIDR" ] || validate_ipv4_cidr "$TRUSTED_PROXY_CIDR" \
  || fail 'TRUSTED_PROXY_CIDR 必须是单个 IPv4 CIDR，例如 172.18.0.1/32'
printf '%s\n' "$RUNTIME_SITE_ROOT" | grep -Eq '^/[A-Za-z0-9._/-]+$' \
  || fail 'RUNTIME_SITE_ROOT 必须是绝对路径'

[ -r "$resolv_conf" ] || fail 'DNS resolver 配置文件不存在或不可读'
nginx_resolver=$(awk '$1 == "nameserver" { print $2; exit }' "$resolv_conf")
reject_control_characters "$nginx_resolver" \
  || fail 'DNS resolver 地址不能包含换行或回车'
validate_ipv4 "$nginx_resolver" || fail 'DNS resolver 必须包含有效的 IPv4 nameserver'

[ ! -d "$output" ] || fail '网关配置输出不能是目录或指向目录的符号链接'

[ -d "$template_root/templates" ] || fail '网关模板目录不存在'
[ -d "$template_root/snippets" ] || fail '网关片段目录不存在'
output_dir=${output%/*}
[ -d "$output_dir" ] || fail '网关配置输出目录不存在'

template="$template_root/templates/http.conf.template"

security="$template_root/snippets/security-headers.conf"
content_type_map="$template_root/snippets/content-type-map.conf"
proxy="$template_root/snippets/proxy-headers.conf.template"
app="$template_root/snippets/app-routes.conf.template"
api="$template_root/snippets/api-routes.conf.template"
short_routes="$template_root/snippets/short-routes.conf.template"
for source in "$template" "$security" "$content_type_map" "$proxy" "$app" "$api" "$short_routes"; do
  [ -f "$source" ] || fail '网关模板文件不完整'
done

umask 077
temp_dir=$(mktemp -d "$output_dir/.gateway-render.XXXXXX") \
  || fail '无法创建私有网关渲染目录'
app_expanded="$temp_dir/app.conf"
app_proxy_expanded="$temp_dir/app-proxy.conf"
api_expanded="$temp_dir/api.conf"
short_expanded="$temp_dir/short.conf"
assembled="$temp_dir/assembled.conf"
rendered_config="$temp_dir/nginx.conf"
trusted_proxy="$temp_dir/trusted-proxy.conf"

if [ -n "$TRUSTED_PROXY_CIDR" ]; then
  {
    printf '%s\n' '  real_ip_header X-Forwarded-For;'
    printf '%s\n' '  real_ip_recursive on;'
    printf '  set_real_ip_from %s;\n' "$TRUSTED_PROXY_CIDR"
  } > "$trusted_proxy"
else
  : > "$trusted_proxy"
fi

cleanup() {
  rm -f "$rendered_config" "$app_expanded" "$app_proxy_expanded" "$api_expanded" "$short_expanded" "$short_server" "$assembled" "$trusted_proxy"
  rm -f "$app_expanded.security" "$api_expanded.security" "$short_expanded.security"
  rmdir "$temp_dir" 2>/dev/null || true
}
trap cleanup EXIT
trap 'trap - EXIT HUP INT TERM; cleanup; exit 1' HUP INT TERM

expand_proxy_marker() {
  source_file=$1
  marker=$2
  public_host_marker=$3
  destination=$4
  awk -v marker="$marker" -v proxy="$proxy" '
    index($0, marker) {
      while ((getline line < proxy) > 0) print line
      close(proxy)
      next
    }
    { print }
  ' "$source_file" | sed "s|@@PUBLIC_HOST@@|$public_host_marker|g" > "$destination"
}

expand_proxy_marker "$app" '@@APP_PROXY_HEADERS@@' '@@APP_DOMAIN@@' "$app_proxy_expanded"
expand_proxy_marker "$app_proxy_expanded" '@@MYURLS_PROXY_HEADERS@@' '@@SHORT_DOMAIN@@' "$app_expanded"
expand_proxy_marker "$api" '@@API_PROXY_HEADERS@@' '@@API_DOMAIN@@' "$api_expanded"
expand_proxy_marker "$short_routes" '@@SHORT_PROXY_HEADERS@@' '@@SHORT_DOMAIN@@' "$short_expanded"

# Locations that declare their own add_header no longer inherit the server-level
# security headers (nginx add_header inheritance rule); expand them in place so
# proxied and short-link responses carry the same CSP/header set. TLS headers are
# owned by the external reverse proxy.
location_hsts=
expand_security_marker() {
  source_file=$1
  destination=$2
  awk -v security="$security" -v hsts="$location_hsts" '
    index($0, "@@SECURITY_HEADERS@@") {
      while ((getline line < security) > 0) print line
      if (hsts != "") print hsts
      close(security)
      next
    }
    { print }
  ' "$source_file" > "$destination"
}
expand_security_marker "$app_expanded" "$app_expanded.security"
expand_security_marker "$api_expanded" "$api_expanded.security"
expand_security_marker "$short_expanded" "$short_expanded.security"

short_server="$temp_dir/short-server.conf"
{
  printf '%s\n' '  server {' '    listen 8080;' "    server_name $SHORT_DOMAIN;"
  cat "$short_expanded.security"
  printf '%s\n' '  }'
} > "$short_server"

awk -v security="$security" -v content_type_map="$content_type_map" -v trusted_proxy="$trusted_proxy" -v app="$app_expanded.security" -v api="$api_expanded.security" -v short_server="$short_server" '
  function emit(file, line) {
    while ((getline line < file) > 0) print line
    close(file)
  }
  index($0, "@@SECURITY_HEADERS@@") { emit(security); next }
  index($0, "@@CONTENT_TYPE_MAP@@") { emit(content_type_map); next }
  index($0, "@@TRUSTED_PROXY_CONFIG@@") { emit(trusted_proxy); next }
  index($0, "@@APP_ROUTES@@") { emit(app); next }
  index($0, "@@API_ROUTES@@") { emit(api); next }
  index($0, "@@SHORT_SERVER@@") { emit(short_server); next }
  { print }
' "$template" > "$assembled"

sed \
  -e "s|@@HTTP_LISTEN@@|$http_listen|g" \
  -e "s|@@APP_DOMAIN@@|$APP_DOMAIN|g" \
  -e "s|@@API_DOMAIN@@|$API_DOMAIN|g" \
  -e "s|@@SHORT_DOMAIN@@|$SHORT_DOMAIN|g" \
  -e "s|@@PUBLIC_SCHEME@@|$public_scheme|g" \
  -e "s|@@SUBCONVERTER_UPSTREAM@@|$SUBCONVERTER_UPSTREAM|g" \
  -e "s|@@MYURLS_APP_UPSTREAM@@|$MYURLS_APP_UPSTREAM|g" \
  -e "s|@@MYURLS_SHORT_UPSTREAM@@|$MYURLS_SHORT_UPSTREAM|g" \
  -e "s|@@MYURLS_MAX_BODY_BYTES@@|$MYURLS_MAX_BODY_BYTES|g" \
  -e "s|@@RUNTIME_SITE_ROOT@@|$RUNTIME_SITE_ROOT|g" \
  -e "s|@@NGINX_RESOLVER@@|$nginx_resolver|g" \
  "$assembled" > "$rendered_config"

if ! "$nginx_bin" -t -c "$rendered_config" >/dev/null; then
  fail 'Nginx 拒绝了渲染后的网关配置'
fi

mv "$rendered_config" "$output" || fail '无法原子替换网关配置'
trap - EXIT HUP INT TERM
cleanup
