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

docker build --check --file Dockerfile.simple .
docker build --file Dockerfile.simple --tag "$image" .
docker run -d --name "$container" \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:uid=101,gid=101,mode=0700 \
  --tmpfs /usr/share/nginx/html/conf:uid=101,gid=101,mode=0700 \
  -e API_URL='https://converter.example.com/api?source=ci&mode=test' \
  -e APP_DOMAIN='app.example.com' \
  -e API_DOMAIN='api.example.com' \
  -e SHORT_DOMAIN='short.example.com' \
  -e SUBCONVERTER_UPSTREAM='http://127.0.0.1:25500' \
  -e MYURLS_UPSTREAM='http://myurls:3000' \
  -e MYURLS_MAX_BODY_BYTES='16384' \
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

[ "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container")" = true ] || {
  printf '容器根文件系统必须只读\n' >&2
  exit 1
}
[ "$(docker inspect --format '{{json .HostConfig.CapDrop}}' "$container")" = '["ALL"]' ] || {
  printf '容器必须丢弃全部 Linux capabilities\n' >&2
  exit 1
}
case "$(docker inspect --format '{{json .HostConfig.SecurityOpt}}' "$container")" in
  *no-new-privileges*) ;;
  *)
    printf '容器必须启用 no-new-privileges\n' >&2
    exit 1
    ;;
esac

docker exec "$container" wget -q -O /dev/null \
  --header='Host: app.example.com' http://127.0.0.1:8080/healthz
docker exec "$container" wget -q -O /dev/null \
  --header='Host: api.example.com' http://127.0.0.1:8080/healthz
docker exec "$container" wget -q -O /dev/null http://127.0.0.1:25500/healthz
docker exec "$container" cat /usr/share/nginx/html/conf/config.js > "$config_output"
node --check --input-type=commonjs < "$config_output"
node -e "const fs=require('node:fs');const vm=require('node:vm');const window={};vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),{window});if(window.config.apiUrl!=='https://converter.example.com/api?source=ci&mode=test'||Object.hasOwn(window.config,'shortUrl'))process.exit(1);" "$config_output"
if grep -Eq 'TOKEN|SECRET|PASSWORD' "$config_output"; then
  printf '公开运行时配置不能包含内部秘密\n' >&2
  exit 1
fi

docker exec "$container" wget -S --spider \
  --header='Host: app.example.com' http://127.0.0.1:8080/ 2> "$headers_output"
grep -qi 'Content-Security-Policy:' "$headers_output"
grep -qi 'X-Content-Type-Options: nosniff' "$headers_output"

printf '容器运行时验证通过: %s\n' "$image"
