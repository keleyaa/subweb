#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_directory/.." && pwd -P)

cd "$project_root"
if command -v actionlint >/dev/null 2>&1; then
  actionlint .github/workflows/*.yml
elif command -v docker >/dev/null 2>&1; then
  docker run --rm \
    --volume "$project_root:/repo:ro" \
    --workdir /repo \
    rhysd/actionlint:1.7.7 \
    .github/workflows/*.yml
else
  printf '%s\n' 'workflow verification requires actionlint or Docker.' >&2
  exit 2
fi

printf '%s\n' 'workflow contracts=passed'
