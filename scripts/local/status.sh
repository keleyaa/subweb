#!/bin/sh
set -eu
"$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/deps.sh" status
