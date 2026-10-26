#!/bin/sh
set -eu
umask 077

# shellcheck source=lib.sh
. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)/lib.sh"

input=
dry_run=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --input) [ "$#" -ge 2 ] || operations_fail '--input requires a value.'; input=$2; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) operations_fail "unknown argument: $1" ;;
  esac
done

[ -n "$input" ] || operations_fail '--input is required.'
require_absolute_regular_file "$input" 'input'
require_docker

if [ "$dry_run" -eq 1 ]; then
  scanned=0
  invalid=0
  tab=$(printf '\t')
  while IFS="$tab" read -r code url expires; do
    [ -n "${code}${url}${expires}" ] || continue
    scanned=$((scanned + 1))
    case "$code" in
      ''|*[!A-Za-z0-9_-]*) invalid=$((invalid + 1)); continue ;;
    esac
    [ -n "$url" ] || invalid=$((invalid + 1))
    case "$expires" in
      ''|*[!0-9]*) invalid=$((invalid + 1)) ;;
    esac
  done < "$input"
  printf 'dry-run scanned=%d invalid=%d\n' "$scanned" "$invalid"
  [ "$invalid" -eq 0 ] || exit 1
  exit 0
fi

cd "$operations_project_root"
compose run --rm --no-deps \
  -v "$input":/backup/links.tsv:ro \
  gateway --import-links \
  -db /data/links.db \
  -input /backup/links.tsv

printf 'Short-link migration finished for %s.\n' "$input"
