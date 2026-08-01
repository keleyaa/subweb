#!/bin/sh
set -eu

config_template=${CONFIG_TEMPLATE:-/app/public/conf/config.js}
config_file=${CONFIG_FILE:-/usr/share/nginx/html/conf/config.js}
gateway_renderer=${GATEWAY_RENDERER:-/app/render-gateway-config.sh}
gateway_template_root=${GATEWAY_TEMPLATE_ROOT:-/etc/nginx/gateway}
gateway_config_file=${GATEWAY_CONFIG_FILE:-/tmp/nginx/nginx.conf}
nginx_bin=${NGINX_BIN:-nginx}
openssl_bin=${OPENSSL_BIN:-openssl}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

configure_gateway_port() {
  [ "${GATEWAY_MODE:-}" = platform ] || return 0
  [ "${PORT+x}" = x ] && [ -n "$PORT" ] \
    || fail 'platform 模式必须提供标准 PORT 环境变量'
  case "$PORT" in *[!0-9]*) fail 'platform 模式的 PORT 必须是纯十进制端口' ;; esac
  [ "$PORT" -ge 1024 ] 2>/dev/null && [ "$PORT" -le 65535 ] \
    || fail 'platform 模式的 PORT 必须在 1024 到 65535 之间'
  if [ "${GATEWAY_PORT+x}" = x ] && [ "$GATEWAY_PORT" != "$PORT" ]; then
    fail 'platform 模式的 PORT 与 GATEWAY_PORT 冲突'
  fi
  GATEWAY_PORT=$PORT
  export GATEWAY_PORT
  configure_platform_runtime
}

normalize_platform_upstream() {
  variable_name=$1
  value=$2
  case "$value" in
    http://*) normalized=$value ;;
    *://*) fail "platform 模式的 $variable_name 只支持 HTTP 私网上游" ;;
    *) normalized="http://$value" ;;
  esac
  printf '%s\n' "$normalized" | grep -Eq '^http://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?:[0-9]{1,5}$' \
    || fail "platform 模式的 $variable_name 必须是无路径的私网主机和端口"
  printf '%s\n' "$normalized"
}

configure_platform_runtime() {
  [ -n "$APP_DOMAIN" ] && [ -n "$API_DOMAIN" ] \
    || fail 'platform 模式必须提供 APP_DOMAIN 和 API_DOMAIN'
  [ -n "$SUBCONVERTER_UPSTREAM" ] && [ -n "$MYURLS_UPSTREAM" ] \
    || fail 'platform 模式必须提供两个私网上游'
  PUBLIC_SCHEME=https
  SUBCONVERTER_UPSTREAM=$(normalize_platform_upstream SUBCONVERTER_UPSTREAM "$SUBCONVERTER_UPSTREAM")
  MYURLS_UPSTREAM=$(normalize_platform_upstream MYURLS_UPSTREAM "$MYURLS_UPSTREAM")
  API_URL="https://$API_DOMAIN"
  SHORT_URL="https://$APP_DOMAIN/short-api"
  TLS_CERT_PATH=
  TLS_KEY_PATH=
  MYURLS_MAX_BODY_BYTES=1048576
  export PUBLIC_SCHEME SUBCONVERTER_UPSTREAM MYURLS_UPSTREAM API_URL SHORT_URL
  export TLS_CERT_PATH TLS_KEY_PATH MYURLS_MAX_BODY_BYTES
}

escape_config_value() {
  case "$1" in
    *'
'*|*''*) fail '配置环境变量不能包含换行符' ;;
  esac

  printf '%s' "$1" \
    | sed "s/\\\\/\\\\\\\\/g; s/'/\\\\'/g" \
    | sed 's/[\\&#]/\\&/g'
}

replace_config_value() {
  old_value=$1
  new_value=$2
  escaped_value=$(escape_config_value "$new_value")
  temp_file="${config_file}.$$"

  if sed "s#${old_value}#${escaped_value}#g" "$config_file" > "$temp_file"; then
    mv "$temp_file" "$config_file" \
      || fail "无法写入运行时配置: ${config_file}"
  else
    rm -f "$temp_file"
    fail "无法写入运行时配置: ${config_file}"
  fi
}

configure_gateway_port

if [ ! -f "$config_file" ]; then
  [ -f "$config_template" ] \
    || fail "运行时配置模板不存在: ${config_template}"

  cp "$config_template" "$config_file" \
    || fail "无法创建运行时配置: ${config_file}"
fi

[ -f "$config_file" ] \
  || fail "运行时配置不存在: ${config_file}"

if [ -n "${API_URL:-}" ]; then
  printf '当前 API 地址为: %s\n' "$API_URL"
  replace_config_value 'https://api.ml1.one' "$API_URL"
else
  printf '%s\n' '当前为默认 API 地址: https://api.ml1.one'
  printf '%s\n' "如需修改请在容器启动时使用 -e API_URL='https://converter.example.com' 传递环境变量"
fi

if [ "${SHORT_URL+x}" = x ]; then
  if [ -n "$SHORT_URL" ]; then
    printf '当前短链接地址为: %s\n' "$SHORT_URL"
  else
    printf '%s\n' '当前已关闭短链接功能'
  fi
  replace_config_value 'https://ml1.one' "$SHORT_URL"
else
  printf '%s\n' '当前为默认短链接地址: https://ml1.one'
fi

check_tls_file() {
  kind=$1
  path=$2
  [ -f "$path" ] || fail "TLS ${kind}文件不存在"
  [ -r "$path" ] || fail "当前容器用户无法读取 TLS ${kind}文件"

  permissions=$(LC_ALL=C ls -ld "$path" | awk '{print $1}')
  [ "$(printf '%s' "$permissions" | cut -c6)" != w ] \
    && [ "$(printf '%s' "$permissions" | cut -c9)" != w ] \
    || fail "TLS ${kind}文件不能允许组用户或其他用户写入"
}

validate_direct_tls() {
  check_tls_file '证书' "$TLS_CERT_PATH"
  check_tls_file '私钥' "$TLS_KEY_PATH"

  "$openssl_bin" x509 -in "$TLS_CERT_PATH" -noout -checkhost "$APP_DOMAIN" >/dev/null 2>&1 \
    || fail "TLS 证书不覆盖 APP_DOMAIN: $APP_DOMAIN"
  "$openssl_bin" x509 -in "$TLS_CERT_PATH" -noout -checkhost "$API_DOMAIN" >/dev/null 2>&1 \
    || fail "TLS 证书不覆盖 API_DOMAIN: $API_DOMAIN"
  "$openssl_bin" pkey -in "$TLS_KEY_PATH" -check -noout >/dev/null 2>&1 \
    || fail 'TLS 私钥格式无效'

  cert_fingerprint=$(
    "$openssl_bin" x509 -in "$TLS_CERT_PATH" -pubkey -noout 2>/dev/null \
      | "$openssl_bin" pkey -pubin -outform DER 2>/dev/null \
      | "$openssl_bin" dgst -sha256 2>/dev/null
  ) || fail '无法读取 TLS 证书公钥指纹'
  key_fingerprint=$(
    "$openssl_bin" pkey -in "$TLS_KEY_PATH" -pubout -outform DER 2>/dev/null \
      | "$openssl_bin" dgst -sha256 2>/dev/null
  ) || fail '无法读取 TLS 私钥公钥指纹'
  [ -n "$cert_fingerprint" ] && [ "$cert_fingerprint" = "$key_fingerprint" ] \
    || fail 'TLS 证书和私钥不匹配'
}

if [ "${GATEWAY_MODE:-}" = direct-tls ]; then
  validate_direct_tls
fi

[ -x "$gateway_renderer" ] || fail '网关配置渲染器不存在或不可执行'
mkdir -p "${gateway_config_file%/*}" /tmp/nginx/client_temp /tmp/nginx/proxy_temp \
  /tmp/nginx/fastcgi_temp /tmp/nginx/uwsgi_temp /tmp/nginx/scgi_temp \
  || fail '无法创建 Nginx 临时目录'

"$gateway_renderer" \
  --template-root "$gateway_template_root" \
  --output "$gateway_config_file" \
  --nginx-bin "$nginx_bin" \
  || fail '网关配置渲染或语法校验失败'

exec "$nginx_bin" -c "$gateway_config_file" -g 'daemon off;'
