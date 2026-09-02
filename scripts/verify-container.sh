#!/bin/sh
set -eu

image=${1:-subweb:verify}
container="subweb-verify-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker build --check --file Dockerfile .
docker build --file Dockerfile --tag "$image" .

[ "$(docker image inspect --format '{{.Config.User}}' "$image")" = '65532:65532' ] || {
  printf 'Gateway image must declare the distroless non-root user\n' >&2
  exit 1
}

docker run -d --name "$container" \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -e APP_DOMAIN='app.example.com' \
  -e API_DOMAIN='api.example.com' \
  -e API_URL='https://api.example.com' \
  -e SHORT_LINKS_ENABLED=false \
  -e CUSTOM_BACKEND_ENABLED=false \
  -e SUBCONVERTER_UPSTREAM='http://127.0.0.1:25500' \
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
  printf 'Gateway healthcheck did not pass before timeout\n' >&2
  exit 1
}

[ "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container")" = true ] || {
  printf 'Gateway container must use a read-only root filesystem\n' >&2
  exit 1
}
[ "$(docker inspect --format '{{json .HostConfig.CapDrop}}' "$container")" = '["ALL"]' ] || {
  printf 'Gateway container must drop all Linux capabilities\n' >&2
  exit 1
}
case "$(docker inspect --format '{{json .HostConfig.SecurityOpt}}' "$container")" in
  *no-new-privileges*) ;;
  *)
    printf 'Gateway container must enable no-new-privileges\n' >&2
    exit 1
    ;;
esac

printf 'Gateway container verification passed: %s\n' "$image"
