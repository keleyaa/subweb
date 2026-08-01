#!/bin/sh
set -eu

# shellcheck source=lib.sh
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/lib.sh"

current=
target=
backup=
confirmed=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --current) [ "$#" -ge 2 ] || operations_fail '--current requires a value.'; current=$2; shift 2 ;;
    --target) [ "$#" -ge 2 ] || operations_fail '--target requires a value.'; target=$2; shift 2 ;;
    --backup) [ "$#" -ge 2 ] || operations_fail '--backup requires a value.'; backup=$2; shift 2 ;;
    --confirm-redis-major) confirmed=1; shift ;;
    *) operations_fail "unknown argument: $1" ;;
  esac
done

[ -n "$current" ] && [ -n "$target" ] || operations_fail '--current and --target are required.'
require_absolute_regular_file "$current" 'current lock'
require_absolute_regular_file "$target" 'target lock'

majors=$(node -e '
const fs = require("node:fs");
const major = (file) => {
  const lock = JSON.parse(fs.readFileSync(file, "utf8"));
  const tag = lock.services?.redis?.source?.tag;
  const match = /^(\d+)(?:\.|$)/u.exec(tag ?? "");
  if (!match) process.exit(1);
  return match[1];
};
process.stdout.write(`${major(process.argv[1])} ${major(process.argv[2])}`);
' "$current" "$target") || operations_fail 'unable to read Redis major versions from lock files.'
set -- $majors
current_major=$1
target_major=$2

if [ "$current_major" != "$target_major" ]; then
  [ "$confirmed" -eq 1 ] || operations_fail 'Redis major version changes require --confirm-redis-major.'
  [ -n "$backup" ] || operations_fail 'Redis major version changes require --backup.'
  "$operations_script_directory/verify-redis-backup.sh" --backup "$backup"
fi

printf 'Upgrade preflight passed: Redis major %s -> %s\n' "$current_major" "$target_major"
