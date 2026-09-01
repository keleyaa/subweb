#!/bin/sh
set -eu

# shellcheck source=common.sh
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/common.sh"

prepare_local_environment
"$local_script_directory/deps.sh" up
cleanup() {
  "$local_script_directory/deps.sh" down >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

cd "$local_project_root"
export VITE_LOCAL_SUBCONVERTER_URL="http://127.0.0.1:$local_subweb_port"
export LOCAL_MYURLS_PORT="$local_myurls_port"
npm run serve -- --host 127.0.0.1 --port "$local_vite_port" --strictPort
