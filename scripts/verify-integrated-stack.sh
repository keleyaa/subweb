#!/bin/sh
set -eu

[ "$#" -eq 0 ] || {
  printf '%s\n' 'Usage: verify-integrated-stack.sh' >&2
  exit 2
}

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec "$script_directory/verify-unified-stack.sh"
