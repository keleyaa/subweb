#!/bin/sh
set -eu

image=${1:-subweb:verify}
container="subweb-verify-$$"
config_output=$(mktemp)
headers_output=$(mktemp)

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -f "$config_output" "$headers_output"
}
trap cleanup EXIT INT TERM

docker build --check .
docker build --tag "$image" .
docker run -d --name "$container" \
  -e API_URL='https://converter.example.com/api?source=ci&mode=test' \
  -e SHORT_URL='https://short.example.com/path?source=ci&mode=test' \
  "$image" >/dev/null

attempt=0
while [ "$attempt" -lt 30 ]; do
  status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container")
  [ "$status" = healthy ] && break
  [ "$status" = unhealthy ] && {
    docker logs "$container" >&2
    exit 1
  }
  attempt=$((attempt + 1))
  sleep 1
done

[ "${status:-missing}" = healthy ] || {
  docker logs "$container" >&2
  printf '容器健康检查未在超时时间内通过\n' >&2
  exit 1
}

[ "$(docker exec "$container" id -u)" != 0 ] || {
  printf '容器不能以 root 用户运行\n' >&2
  exit 1
}

docker exec "$container" wget -q -O /dev/null http://127.0.0.1:8080/healthz
docker exec "$container" cat /usr/share/nginx/html/conf/config.js > "$config_output"
node --check --input-type=commonjs < "$config_output"
node -e "const fs=require('node:fs');const vm=require('node:vm');const window={};vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),{window});if(window.config.apiUrl!=='https://converter.example.com/api?source=ci&mode=test'||window.config.shortUrl!=='https://short.example.com/path?source=ci&mode=test')process.exit(1);" "$config_output"

docker exec "$container" wget -S --spider http://127.0.0.1:8080/ 2> "$headers_output"
grep -qi 'Content-Security-Policy:' "$headers_output"
grep -qi 'X-Content-Type-Options: nosniff' "$headers_output"

printf '容器运行时验证通过: %s\n' "$image"
