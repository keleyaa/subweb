#!/bin/sh
set -eu

config_template=${CONFIG_TEMPLATE:-/app/public/conf/config.js}
config_file=${CONFIG_FILE:-/usr/share/nginx/html/conf/config.js}
site_root=${SITE_ROOT:-/usr/share/nginx/html}
gateway_renderer=${GATEWAY_RENDERER:-/app/render-gateway-config.sh}
gateway_template_root=${GATEWAY_TEMPLATE_ROOT:-/etc/nginx/gateway}
gateway_config_file=${GATEWAY_CONFIG_FILE:-/tmp/nginx/nginx.conf}
nginx_bin=${NGINX_BIN:-nginx}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

escape_config_value() {
  case "$1" in
    *'
'*|*''*) fail '配置环境变量不能包含换行符' ;;
  esac

  printf '%s' "$1" | sed "s/\\\\/\\\\\\\\/g; s/'/\\\\'/g"
}

replace_file_value() {
  target_file=$1
  old_value=$2
  new_value=$3
  escaped_value=$(escape_config_value "$new_value")
  sed_escaped=$(printf '%s' "$escaped_value" | sed 's/[\\&]/\\&/g')
  temp_file="${target_file}.$$"

  if sed "s#${old_value}#${sed_escaped}#g" "$target_file" > "$temp_file"; then
    mv "$temp_file" "$target_file" \
      || fail "无法写入运行时文件: ${target_file}"
  else
    rm -f "$temp_file"
    fail "无法写入运行时文件: ${target_file}"
  fi
}

replace_file_replacement() {
  target_file=$1
  old_value=$2
  replacement=$3
  sed_escaped=$(printf '%s' "$replacement" | sed 's/[\\&|]/\\&/g')
  temp_file="${target_file}.$$"

  if sed "s|${old_value}|${sed_escaped}|g" "$target_file" > "$temp_file"; then
    mv "$temp_file" "$target_file" \
      || fail "无法写入运行时文件: ${target_file}"
  else
    rm -f "$temp_file"
    fail "无法写入运行时文件: ${target_file}"
  fi
}

if [ ! -f "$config_file" ]; then
  [ -f "$config_template" ] \
    || fail "运行时配置模板不存在: ${config_template}"

  cp "$config_template" "$config_file" \
    || fail "无法创建运行时配置: ${config_file}"
fi

[ -f "$config_file" ] \
  || fail "运行时配置不存在: ${config_file}"

[ -n "${API_URL:-}" ] || fail '缺少必需的 API_URL，拒绝回退到公共转换端点'
printf '当前 API 地址为: %s\n' "$API_URL"
escaped_api_url=$(escape_config_value "$API_URL")
replace_file_replacement "$config_file" "apiUrl: 'https://api.ml1.one'" "apiUrl: '$escaped_api_url'"
replace_file_replacement "$config_file" "apiUrl: ''" "apiUrl: '$escaped_api_url'"

if [ -n "${APP_DOMAIN:-}" ] && [ -w "$site_root" ]; then
  public_origin="https://${APP_DOMAIN}"
  for public_file in "$site_root/index.html" "$site_root/sitemap.xml" "$site_root/robots.txt"; do
    if [ -f "$public_file" ]; then
      replace_file_value "$public_file" 'https://sub.ml1.one' "$public_origin"
    fi
  done
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
