#!/bin/sh

health_error() {
  printf 'Local health error: %s\n' "$1" >&2
}

wait_for_http_health() {
  service=$1
  url=$2
  timeout=${LOCAL_HEALTH_TIMEOUT:-30}
  case "$timeout" in ''|*[!0-9]*) health_error 'LOCAL_HEALTH_TIMEOUT must be a positive integer'; return 1 ;; esac
  [ "$timeout" -ge 1 ] || { health_error 'LOCAL_HEALTH_TIMEOUT must be a positive integer'; return 1; }
  elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if curl --noproxy '*' --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  health_error "$service did not become healthy within ${timeout}s"
  return 1
}

wait_for_redis_health() {
  port=$1
  password=$2
  timeout=${LOCAL_HEALTH_TIMEOUT:-30}
  case "$timeout" in ''|*[!0-9]*) health_error 'LOCAL_HEALTH_TIMEOUT must be a positive integer'; return 1 ;; esac
  [ "$timeout" -ge 1 ] || { health_error 'LOCAL_HEALTH_TIMEOUT must be a positive integer'; return 1; }
  elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if REDISCLI_AUTH=$password redis-cli -h 127.0.0.1 -p "$port" --no-auth-warning PING 2>/dev/null \
      | grep -qx PONG; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  health_error "redis did not become healthy within ${timeout}s"
  return 1
}
