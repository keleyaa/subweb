#!/bin/sh
set -eu

config_template=${CONFIG_TEMPLATE:-/app/public/conf/config.js}
config_file=${CONFIG_FILE:-/usr/share/nginx/html/conf/config.js}
site_root=${SITE_ROOT:-/usr/share/nginx/html}
runtime_site_root=${RUNTIME_SITE_ROOT:-/tmp/nginx/runtime-site}
gateway_renderer=${GATEWAY_RENDERER:-/app/render-simple-gateway-config.sh}
gateway_template_root=${GATEWAY_TEMPLATE_ROOT:-/etc/nginx/simple}
gateway_config_file=${GATEWAY_CONFIG_FILE:-/tmp/nginx/nginx.conf}
nginx_bin=${NGINX_BIN:-nginx}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

escape_config_value() {
  case "$1" in
    *'
'*|*'\r'*) fail '配置环境变量不能包含换行符' ;;
  esac
  printf '%s' "$1"
}

replace_file_value() {
  target_file=$1
  old_value=$2
  new_value=$3
  escaped_value=$(escape_config_value "$new_value")
  sed_escaped=$(printf '%s' "$escaped_value" | sed 's/[\\&#]/\\&/g')
  temp_file="${target_file}.$$"
  sed "s#${old_value}#${sed_escaped}#g" "$target_file" > "$temp_file" || fail "无法写入运行时文件: ${target_file}"
  mv "$temp_file" "$target_file" || fail "无法写入运行时文件: ${target_file}"
}

[ -f "$config_file" ] || {
  [ -f "$config_template" ] || fail "运行时配置模板不存在: ${config_template}"
  cp "$config_template" "$config_file" || fail "无法创建运行时配置: ${config_file}"
}

validate_api_url() {
  case "$1" in
    https://*|http://localhost|http://localhost:*|http://127.0.0.1|http://127.0.0.1:*) ;;
    *) return 1 ;;
  esac
  printf '%s' "$1" | LC_ALL=C grep -q '[[:space:]]' && return 1 || true
  authority=${1#*://}; authority=${authority%%[/?#]*}
  [ -n "$authority" ] || return 1
  case "$authority" in :*|*'@'*) return 1 ;; esac
  case "$authority" in
    \[*\]:*) port=${authority##*:} ;;
    \[*\]) port= ;;
    *:*) port=${authority##*:} ;;
    *) port= ;;
  esac
  case "$authority" in *:*) [ -n "$port" ] || return 1 ;; esac
  if [ -n "$port" ]; then
    case "$port" in ''|*[!0-9]*) return 1 ;; esac
    [ "$port" -ge 1 ] 2>/dev/null && [ "$port" -le 65535 ] || return 1
  fi
}

[ -n "${API_URL:-}" ] || fail '缺少必需的 API_URL，拒绝回退到公共转换端点'
validate_api_url "$API_URL" || fail 'API_URL 必须是 HTTPS 地址，或 localhost/127.0.0.1 的 HTTP 地址，且不能包含凭据或非法端口'
escaped_api_url=$(escape_config_value "$API_URL")
replace_file_value "$config_file" 'apiUrl: '\''https://api.ml1.one'\''' "apiUrl: '$escaped_api_url'"
replace_file_value "$config_file" "apiUrl: ''" "apiUrl: '$escaped_api_url'"
grep -Fq "apiUrl: '$escaped_api_url'" "$config_file" || fail '运行时配置未应用 API_URL'

if [ -n "${APP_DOMAIN:-}" ]; then
  public_origin="https://${APP_DOMAIN}"
  mkdir -p "$runtime_site_root" || fail '无法创建运行时站点目录'
  for public_name in index.html sitemap.xml robots.txt; do
    public_file="$site_root/$public_name"
    runtime_file="$runtime_site_root/$public_name"
    [ -f "$public_file" ] || fail "公共资源不存在: ${public_file}"
    cp "$public_file" "$runtime_file" || fail "无法创建运行时公共资源: ${runtime_file}"
    replace_file_value "$runtime_file" 'https://sub.ml1.one' "$public_origin"
  done
fi

mkdir -p /tmp/nginx/client_temp /tmp/nginx/proxy_temp /tmp/nginx/fastcgi_temp /tmp/nginx/uwsgi_temp /tmp/nginx/scgi_temp "$runtime_site_root" || fail '无法创建运行时目录'

start_converter() {
  runtime_base=${SUBCONVERTER_RUNTIME_BASE:-/tmp/subconverter/base}
  export SUBWEB_LOG_RUNTIME_DIR=${SUBWEB_LOG_RUNTIME_DIR:-/tmp/subconverter}
  export SUBWEB_LOG_FILTER=${SUBWEB_LOG_FILTER:-/usr/local/bin/subweb-log-filter.awk}
  mkdir -p "${runtime_base%/*}"
  [ -d "$runtime_base" ] || cp -R /base "$runtime_base"
  export SUBCONVERTER_BASE_PATH=$runtime_base
  export PREF_PATH=${PREF_PATH:-$runtime_base/pref.toml}
  mkdir -p "${PREF_PATH%/*}" "$SUBWEB_LOG_RUNTIME_DIR"
  /usr/local/bin/subweb-subconverter-entrypoint &
  converter_pid=$!
}

[ -x "$gateway_renderer" ] || fail '简化网关配置渲染器不存在或不可执行'
start_converter

cleanup() {
  kill -TERM "$converter_pid" 2>/dev/null || true
  wait "$converter_pid" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

"$gateway_renderer" --template-root "$gateway_template_root" --output "$gateway_config_file" --nginx-bin "$nginx_bin" || fail '网关配置渲染或语法校验失败'

LD_LIBRARY_PATH= "$nginx_bin" -e /dev/stderr -c "$gateway_config_file" -g 'daemon off;' &
nginx_pid=$!
while kill -0 "$converter_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
  sleep 1
done
if kill -0 "$nginx_pid" 2>/dev/null; then
  kill -TERM "$nginx_pid" 2>/dev/null || true
  set +e
  wait "$nginx_pid"
  nginx_status=$?
  set -e
  exit "$nginx_status"
fi
set +e
wait "$nginx_pid"
nginx_status=$?
set -e
exit "$nginx_status"
