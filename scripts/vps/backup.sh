#!/bin/sh
set -eu
umask 077

PROJECT_ROOT=${SUBWEB_ROOT:-/opt/subweb}
BACKUP_DIRECTORY=${BACKUP_DIRECTORY:-/var/lib/subweb-backups}
BACKUP_REMOTE_MOUNT=${BACKUP_REMOTE_MOUNT:-}
BACKUP_RETENTION=${BACKUP_RETENTION:-14}
AGE_RECIPIENT=${AGE_RECIPIENT:-}
MIN_FREE_KIB=${MIN_FREE_KIB:-10485760}
ENV_FILE=${SUBWEB_ENV_FILE:-$PROJECT_ROOT/.env}

fail() {
  printf 'VPS backup failed: %s\n' "$1" >&2
  exit 1
}

case "$BACKUP_RETENTION" in
  ''|*[!0-9]*) fail 'BACKUP_RETENTION must be a positive integer.' ;;
esac
[ "$BACKUP_RETENTION" -ge 1 ] || fail 'BACKUP_RETENTION must be at least 1.'
[ -n "$AGE_RECIPIENT" ] || [ -n "$BACKUP_REMOTE_MOUNT" ] \
  || fail 'retention is refused until AGE_RECIPIENT or BACKUP_REMOTE_MOUNT is configured.'
[ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || fail 'production .env must be a regular file.'

if [ -n "$BACKUP_REMOTE_MOUNT" ]; then
  command -v findmnt >/dev/null 2>&1 || fail 'findmnt is required for BACKUP_REMOTE_MOUNT.'
  findmnt -rn --target "$BACKUP_REMOTE_MOUNT" >/dev/null \
    || fail 'BACKUP_REMOTE_MOUNT is not mounted; refusing retention.'
  case "$BACKUP_DIRECTORY/" in
    "$BACKUP_REMOTE_MOUNT"/*) ;;
    *) fail 'BACKUP_DIRECTORY must be under BACKUP_REMOTE_MOUNT; refusing retention.' ;;
  esac
fi

command -v df >/dev/null 2>&1 || fail 'df is required.'
free_kib=$(df -Pk "$BACKUP_DIRECTORY" 2>/dev/null | awk 'NR == 2 { print $4 }')
case "$free_kib" in
  ''|*[!0-9]*) fail 'unable to determine backup filesystem free space.' ;;
esac
[ "$free_kib" -ge "$MIN_FREE_KIB" ] || fail "backup filesystem is below ${MIN_FREE_KIB} KiB."

mkdir -p "$BACKUP_DIRECTORY"
chmod 0700 "$BACKUP_DIRECTORY"
timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
raw_file="$BACKUP_DIRECTORY/.subweb-redis-$timestamp.rdb"
if [ -n "$AGE_RECIPIENT" ]; then
  final_file="$BACKUP_DIRECTORY/subweb-redis-$timestamp.rdb.age"
else
  final_file="$BACKUP_DIRECTORY/subweb-redis-$timestamp.rdb"
fi
checksum_file="$final_file.sha256"
cleanup() { rm -f "$raw_file" "$final_file.tmp" "$checksum_file.tmp"; }
trap cleanup EXIT HUP INT TERM

SUBWEB_ENV_FILE="$ENV_FILE" COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-subweb} \
  "$PROJECT_ROOT/scripts/subweb.sh" backup --output "$raw_file"
[ -s "$raw_file" ] || fail 'Redis backup is empty.'

if [ -n "$AGE_RECIPIENT" ]; then
  command -v age >/dev/null 2>&1 || fail 'age is required when AGE_RECIPIENT is configured.'
  age -r "$AGE_RECIPIENT" -o "$final_file.tmp" "$raw_file" \
    || fail 'age encryption failed.'
  mv "$final_file.tmp" "$final_file"
  rm -f "$raw_file"
else
  mv "$raw_file" "$final_file"
fi

sha256sum "$final_file" >"$checksum_file.tmp" 2>/dev/null \
  || shasum -a 256 "$final_file" >"$checksum_file.tmp"
mv "$checksum_file.tmp" "$checksum_file"
chmod 0600 "$final_file" "$checksum_file"

find "$BACKUP_DIRECTORY" -maxdepth 1 -type f \( -name 'subweb-redis-*.rdb' -o -name 'subweb-redis-*.rdb.age' \) -printf '%T@ %p\n' \
  | sort -nr \
  | awk -v keep="$BACKUP_RETENTION" 'NR > keep { sub(/^[^ ]+ /, ""); print }' \
  | while IFS= read -r old_file; do
      [ -n "$old_file" ] || continue
      rm -f -- "$old_file" "$old_file.sha256"
    done

printf 'Encrypted/off-host Redis backup retained: %s\n' "$final_file"
