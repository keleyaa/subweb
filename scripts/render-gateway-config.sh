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

require_value GATEWAY_MODE "${GATEWAY_MODE+x}"
DOMAIN_MODE=${DOMAIN_MODE:-legacy}
case "$DOMAIN_MODE" in legacy|three-domain) ;; *) fail 'DOMAIN_MODE 只能是 legacy 或 three-domain' ;; esac
SHORT_DOMAIN=${SHORT_DOMAIN:-${APP_DOMAIN:-}}
require_value APP_DOMAIN "${APP_DOMAIN+x}"
require_value API_DOMAIN "${API_DOMAIN+x}"
require_value SHORT_DOMAIN "${SHORT_DOMAIN+x}"
require_value PUBLIC_SCHEME "${PUBLIC_SCHEME+x}"
require_value GATEWAY_PORT "${GATEWAY_PORT+x}"
require_value SUBCONVERTER_UPSTREAM "${SUBCONVERTER_UPSTREAM+x}"
require_value MYURLS_UPSTREAM "${MYURLS_UPSTREAM+x}"
require_value MYURLS_API_TOKEN "${MYURLS_API_TOKEN+x}"
require_value MYURLS_MAX_BODY_BYTES "${MYURLS_MAX_BODY_BYTES+x}"
require_value TLS_CERT_PATH "${TLS_CERT_PATH+x}"
require_value TLS_KEY_PATH "${TLS_KEY_PATH+x}"

for external_value in "$GATEWAY_MODE" "$DOMAIN_MODE" "$APP_DOMAIN" "$API_DOMAIN" "$SHORT_DOMAIN" \
  "$PUBLIC_SCHEME" "$GATEWAY_PORT" "$SUBCONVERTER_UPSTREAM" \
  "$MYURLS_UPSTREAM" "$MYURLS_API_TOKEN" "$MYURLS_MAX_BODY_BYTES" \
  "$TLS_CERT_PATH" "$TLS_KEY_PATH"; do
  reject_control_characters "$external_value" \
    || fail '网关环境变量不能包含换行或回车'
done

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

validate_absolute_path() {
  value=$1
  printf '%s\n' "$value" | grep -Eq '^/[A-Za-z0-9._/-]+$' || return 1
  case "$value" in *'//'*) return 1 ;; esac
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

case "$GATEWAY_MODE" in
  behind-proxy)
    [ "$GATEWAY_PORT" = 8080 ] || fail 'behind-proxy 模式的容器端口必须为 8080'
    http_listen=8080
    ;;
  direct-tls)
    [ "$GATEWAY_PORT" = 8443 ] || fail 'direct-tls 模式的 HTTPS 容器端口必须为 8443'
    http_listen=''
    ;;
  *) fail 'GATEWAY_MODE 只能是 behind-proxy 或 direct-tls' ;;
esac

validate_domain "$APP_DOMAIN" || fail 'APP_DOMAIN 不是有效的纯域名'
validate_domain "$API_DOMAIN" || fail 'API_DOMAIN 不是有效的纯域名'
validate_domain "$SHORT_DOMAIN" || fail 'SHORT_DOMAIN 不是有效的纯域名'
[ "$APP_DOMAIN" != "$API_DOMAIN" ] || fail 'APP_DOMAIN 和 API_DOMAIN 不能相同'
if [ "$DOMAIN_MODE" = three-domain ]; then
  [ "$APP_DOMAIN" != "$SHORT_DOMAIN" ] || fail 'APP_DOMAIN 和 SHORT_DOMAIN 不能相同'
  [ "$API_DOMAIN" != "$SHORT_DOMAIN" ] || fail 'API_DOMAIN 和 SHORT_DOMAIN 不能相同'
fi
case "$PUBLIC_SCHEME" in http|https) ;; *) fail 'PUBLIC_SCHEME 只能是 http 或 https' ;; esac
[ "$GATEWAY_MODE" != direct-tls ] || [ "$PUBLIC_SCHEME" = https ] \
  || fail 'direct-tls 模式的 PUBLIC_SCHEME 必须为 https'

validate_upstream "$SUBCONVERTER_UPSTREAM" || fail 'SUBCONVERTER_UPSTREAM 必须是无路径的 http:// 私网主机和端口'
validate_upstream "$MYURLS_UPSTREAM" || fail 'MYURLS_UPSTREAM 必须是无路径的 http:// 私网主机和端口'
[ "${#MYURLS_API_TOKEN}" -ge 32 ] && [ "${#MYURLS_API_TOKEN}" -le 256 ] \
  || fail 'MYURLS_API_TOKEN 格式无效'
printf '%s\n' "$MYURLS_API_TOKEN" | grep -Eq '^[A-Za-z0-9._~-]+$' \
  || fail 'MYURLS_API_TOKEN 格式无效'
printf '%s\n' "$MYURLS_MAX_BODY_BYTES" | grep -Eq '^[0-9]+$' \
  || fail 'MYURLS_MAX_BODY_BYTES 必须为十进制字节数'
[ "$MYURLS_MAX_BODY_BYTES" -ge 1 ] 2>/dev/null && [ "$MYURLS_MAX_BODY_BYTES" -le 16777216 ] \
  || fail 'MYURLS_MAX_BODY_BYTES 必须在 1 到 16777216 之间'

if [ "$GATEWAY_MODE" = direct-tls ]; then
  validate_absolute_path "$TLS_CERT_PATH" || fail 'TLS_CERT_PATH 必须是安全的绝对路径'
  validate_absolute_path "$TLS_KEY_PATH" || fail 'TLS_KEY_PATH 必须是安全的绝对路径'
else
  [ -z "$TLS_CERT_PATH" ] && [ -z "$TLS_KEY_PATH" ] \
    || fail '非 direct-tls 模式不能配置 TLS 路径'
fi

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

case "$GATEWAY_MODE" in
  direct-tls) template="$template_root/templates/direct-tls.conf.template" ;;
  *) template="$template_root/templates/http.conf.template" ;;
esac

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
api_expanded="$temp_dir/api.conf"
short_expanded="$temp_dir/short.conf"
assembled="$temp_dir/assembled.conf"
rendered_config="$temp_dir/nginx.conf"

cleanup() {
  rm -f "$rendered_config" "$app_expanded" "$api_expanded" "$short_expanded" "$short_server" "$assembled"
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

expand_proxy_marker "$app" '@@APP_PROXY_HEADERS@@' '@@APP_DOMAIN@@' "$app_expanded"
expand_proxy_marker "$api" '@@API_PROXY_HEADERS@@' '@@API_DOMAIN@@' "$api_expanded"
expand_proxy_marker "$short_routes" '@@SHORT_PROXY_HEADERS@@' '@@SHORT_DOMAIN@@' "$short_expanded"

# Locations that declare their own add_header no longer inherit the server-level
# security headers (nginx add_header inheritance rule); expand them in place so
# proxied and short-link responses carry the same CSP/header set. In direct-tls
# mode the server-level HSTS line also does not reach these locations, so it is
# added here; behind-proxy deliberately defers HSTS to the outer TLS entry.
case "$GATEWAY_MODE" in
  direct-tls) location_hsts='add_header Strict-Transport-Security "max-age=31536000" always;' ;;
  *) location_hsts= ;;
esac
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
if [ "$DOMAIN_MODE" = three-domain ]; then
  if [ "$GATEWAY_MODE" = direct-tls ]; then
    {
      printf '%s\n' '  server {' '    listen 8443 ssl;' "    server_name $SHORT_DOMAIN;" "    ssl_certificate $TLS_CERT_PATH;" "    ssl_certificate_key $TLS_KEY_PATH;" '    add_header Strict-Transport-Security "max-age=31536000" always;'
      cat "$security"
      cat "$short_expanded.security"
      printf '%s\n' '  }'
    } > "$short_server"
  else
    {
      printf '%s\n' '  server {' '    listen 8080;' "    server_name $SHORT_DOMAIN;"
      cat "$security"
      cat "$short_expanded.security"
      printf '%s\n' '  }'
    } > "$short_server"
  fi
else
  : > "$short_server"
fi

awk -v security="$security" -v content_type_map="$content_type_map" -v app="$app_expanded.security" -v api="$api_expanded.security" -v short_server="$short_server" '
  function emit(file, line) {
    while ((getline line < file) > 0) print line
    close(file)
  }
  index($0, "@@SECURITY_HEADERS@@") { emit(security); next }
  index($0, "@@CONTENT_TYPE_MAP@@") { emit(content_type_map); next }
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
  -e "s|@@PUBLIC_SCHEME@@|$PUBLIC_SCHEME|g" \
  -e "s|@@SUBCONVERTER_UPSTREAM@@|$SUBCONVERTER_UPSTREAM|g" \
  -e "s|@@MYURLS_UPSTREAM@@|$MYURLS_UPSTREAM|g" \
  -e "s|@@MYURLS_API_TOKEN@@|$MYURLS_API_TOKEN|g" \
  -e "s|@@MYURLS_MAX_BODY_BYTES@@|$MYURLS_MAX_BODY_BYTES|g" \
  -e "s|@@TLS_CERT_PATH@@|$TLS_CERT_PATH|g" \
  -e "s|@@TLS_KEY_PATH@@|$TLS_KEY_PATH|g" \
  -e "s|@@NGINX_RESOLVER@@|$nginx_resolver|g" \
  "$assembled" > "$rendered_config"

if ! "$nginx_bin" -t -c "$rendered_config" >/dev/null; then
  fail 'Nginx 拒绝了渲染后的网关配置'
fi

mv "$rendered_config" "$output" || fail '无法原子替换网关配置'
trap - EXIT HUP INT TERM
cleanup
