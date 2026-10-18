#!/bin/sh
set -eu

script_directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
project_root=$(CDPATH='' cd -- "$script_directory/.." && pwd -P)

cd "$project_root"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker run --rm \
    --volume "$project_root:/repo:ro" \
    --workdir /repo \
     rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 \
    .github/workflows/*.yml
elif command -v actionlint >/dev/null 2>&1; then
  actionlint_version=$(actionlint -version 2>/dev/null | awk 'NR == 1 { print $1; exit }')
  if [ "$actionlint_version" != 1.7.12 ]; then
    printf '%s\n' 'workflow verification without Docker requires actionlint 1.7.12.' >&2
    exit 2
  fi
  actionlint .github/workflows/*.yml
else
  printf '%s\n' 'workflow verification requires actionlint or Docker.' >&2
  exit 2
fi

printf '%s\n' 'workflow contracts=passed'
