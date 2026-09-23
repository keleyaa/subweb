#!/bin/sh
set -eu

script_directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
project_root=$(CDPATH='' cd -- "$script_directory/.." && pwd -P)

cd "$project_root"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker run --rm \
    --volume "$project_root:/repo:ro" \
    --workdir /repo \
     rhysd/actionlint:1.7.7@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9 \
    .github/workflows/*.yml
elif command -v actionlint >/dev/null 2>&1; then
  actionlint_version=$(actionlint -version 2>/dev/null | awk 'NR == 1 { print $1; exit }')
  if [ "$actionlint_version" != 1.7.7 ]; then
    printf '%s\n' 'workflow verification without Docker requires actionlint 1.7.7.' >&2
    exit 2
  fi
  actionlint .github/workflows/*.yml
else
  printf '%s\n' 'workflow verification requires actionlint or Docker.' >&2
  exit 2
fi

printf '%s\n' 'workflow contracts=passed'
