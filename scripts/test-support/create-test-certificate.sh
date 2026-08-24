#!/bin/sh
set -eu

umask 077

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 3 ] || [ "$#" -eq 4 ] \
  || fail '用法: create-test-certificate.sh ABSOLUTE_EMPTY_DIRECTORY APP_DOMAIN API_DOMAIN [SHORT_DOMAIN]'

output_directory=$1
app_domain=$2
api_domain=$3
short_domain=${4:-}
carriage_return=$(printf '\r')

for value in "$output_directory" "$app_domain" "$api_domain" ${short_domain:+"$short_domain"}; do
  case "$value" in
    *'
'*|*"$carriage_return"*) fail '参数不能包含换行或回车' ;;
  esac
done

case "$output_directory" in
  /private/tmp/*|/tmp/*|/var/folders/*|/private/var/folders/*) ;;
  *) fail '输出目录必须是系统临时目录中的安全绝对路径' ;;
esac

[ -d "$output_directory" ] && [ ! -L "$output_directory" ] \
  || fail '输出目录必须是已存在的普通目录'
[ "$output_directory" != / ] || fail '拒绝使用根目录'
[ -z "$(find "$output_directory" -mindepth 1 -maxdepth 1 -print -quit)" ] \
  || fail '输出目录必须为空'

validate_domain() {
  value=$1
  [ "${#value}" -le 253 ] || return 1
  printf '%s\n' "$value" \
    | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'
}

validate_domain "$app_domain" || fail 'APP 域名无效'
validate_domain "$api_domain" || fail 'API 域名无效'
[ "$app_domain" != "$api_domain" ] || fail 'APP 和 API 域名不能重复'
if [ -n "$short_domain" ]; then
  validate_domain "$short_domain" || fail 'SHORT 域名无效'
  [ "$short_domain" != "$app_domain" ] && [ "$short_domain" != "$api_domain" ] \
    || fail 'SHORT 域名不能与 APP 或 API 域名重复'
  san_list="DNS:$app_domain,DNS:$api_domain,DNS:$short_domain"
else
  san_list="DNS:$app_domain,DNS:$api_domain"
fi
command -v openssl >/dev/null 2>&1 || fail '缺少 openssl'

certificate_path=$output_directory/fullchain.pem
key_path=$output_directory/privkey.pem
cleanup() {
  rm -f "$certificate_path" "$key_path"
}
trap cleanup EXIT HUP INT TERM

openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 2 \
  -subj "/CN=$app_domain" \
  -addext "subjectAltName=$san_list" \
  -keyout "$key_path" -out "$certificate_path" >/dev/null 2>&1 \
  || fail '无法创建测试证书'

chmod 0600 "$key_path" "$certificate_path" \
  || fail '无法限制测试证书权限'
trap - EXIT HUP INT TERM
printf '%s\n' '测试证书已创建'
