#!/bin/sh

port_error() {
  printf 'Local port error: %s\n' "$1" >&2
}

validate_local_port() {
  port=${1-}
  case "$port" in ''|*[!0-9]*) return 1 ;; esac
  [ "$port" -ge 1 ] 2>/dev/null && [ "$port" -le 65535 ]
}

port_has_listener() {
  port=$1
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return $?
  fi
  command -v node >/dev/null 2>&1 || return 2
  node - "$port" <<'NODE'
const net = require('node:net');
const socket = net.createConnection({ host: '127.0.0.1', port: Number(process.argv[2]) });
const timeout = setTimeout(() => {
  socket.destroy();
  process.exit(1);
}, 500);
socket.once('connect', () => {
  clearTimeout(timeout);
  socket.destroy();
  process.exit(0);
});
socket.once('error', () => {
  clearTimeout(timeout);
  process.exit(1);
});
NODE
}

assert_port_available() {
  port=${1-}
  variable_name=${2-unknown}
  validate_local_port "$port" || {
    port_error "$variable_name has an invalid port: $port"
    return 1
  }
  if port_has_listener "$port"; then
    port_error "$variable_name port $port is already in use"
    if command -v lsof >/dev/null 2>&1; then
      lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 2>/dev/null || true
    fi
    return 1
  else
    probe_status=$?
  fi
  [ "$probe_status" -ne 2 ] || {
    port_error "cannot inspect $variable_name port $port: lsof, nc, and node are unavailable"
    return 1
  }
}
