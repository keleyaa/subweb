#!/bin/sh
set -eu

config_template=/app/public/conf/config.js
config_file=/usr/share/nginx/html/conf/config.js

fail() {
  printf '%s\n' "$1" >&2
  exit 1
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
  replace_config_value 'http://127.0.0.1:25500' "$API_URL"
else
  printf '%s\n' '当前为默认本地 API 地址: http://127.0.0.1:25500'
  printf '%s\n' "如需修改请在容器启动时使用 -e API_URL='https://sub.ops.ci' 传递环境变量"
fi

if [ -n "${SHORT_URL:-}" ]; then
  printf '当前短链接地址为: %s\n' "$SHORT_URL"
  replace_config_value 'https://s.ops.ci' "$SHORT_URL"
fi

if [ -n "${SITE_NAME:-}" ]; then
  replace_config_value 'Subconverter Web' "$SITE_NAME"
fi

exec nginx -g 'daemon off;'
