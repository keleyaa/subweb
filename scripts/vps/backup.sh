#!/bin/sh
set -eu
umask 077

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
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

# shellcheck source=backup-path.sh
. "$SCRIPT_DIRECTORY/backup-path.sh"

backup_expected_mount_identity=

validate_backup_destination() {
  require_supported_backup_path BACKUP_DIRECTORY "$BACKUP_DIRECTORY"
  if [ -z "$BACKUP_REMOTE_MOUNT" ]; then
    return 0
  fi

  require_supported_backup_path BACKUP_REMOTE_MOUNT "$BACKUP_REMOTE_MOUNT"
  command -v findmnt >/dev/null 2>&1 || fail 'findmnt is required for BACKUP_REMOTE_MOUNT.'
  backup_mount_is_distinct "$BACKUP_REMOTE_MOUNT" \
    || fail 'BACKUP_REMOTE_MOUNT must be a distinct mounted filesystem; refusing retention.'
  backup_observed_mount_identity=$(backup_mount_identity "$BACKUP_REMOTE_MOUNT") \
    || fail 'unable to determine BACKUP_REMOTE_MOUNT identity.'
  case "$backup_expected_mount_identity" in
    '') backup_expected_mount_identity=$backup_observed_mount_identity ;;
    "$backup_observed_mount_identity") ;;
    *) fail 'BACKUP_REMOTE_MOUNT identity changed; refusing backup.' ;;
  esac
  backup_path_is_within "$BACKUP_REMOTE_MOUNT" "$BACKUP_DIRECTORY" \
    || fail 'BACKUP_DIRECTORY must be under BACKUP_REMOTE_MOUNT; refusing retention.'
}

validate_backup_destination

case "$BACKUP_RETENTION" in
  ''|*[!0-9]*) fail 'BACKUP_RETENTION must be a positive integer.' ;;
esac
[ "$BACKUP_RETENTION" -ge 1 ] || fail 'BACKUP_RETENTION must be at least 1.'
case "$MIN_FREE_KIB" in
  ''|*[!0-9]*) fail 'MIN_FREE_KIB must be a non-negative decimal integer.' ;;
esac
[ -n "$AGE_RECIPIENT" ] || [ -n "$BACKUP_REMOTE_MOUNT" ] \
  || fail 'retention is refused until AGE_RECIPIENT or BACKUP_REMOTE_MOUNT is configured.'
[ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || fail 'production .env must be a regular file.'

mkdir -p "$BACKUP_DIRECTORY"
validate_backup_destination
chmod 0700 "$BACKUP_DIRECTORY"
command -v flock >/dev/null 2>&1 || fail 'flock is required to serialize backups.'
validate_backup_destination
exec 9>"$BACKUP_DIRECTORY/.backup.lock" || fail 'unable to open the backup lock.'
flock -n 9 || fail 'another backup is already running.'

command -v df >/dev/null 2>&1 || fail 'df is required.'
free_kib=$(df -Pk "$BACKUP_DIRECTORY" 2>/dev/null | awk 'NR == 2 { print $4 }')
case "$free_kib" in
  ''|*[!0-9]*) fail 'unable to determine backup filesystem free space.' ;;
esac
awk -v free_kib="$free_kib" -v min_free_kib="$MIN_FREE_KIB" \
  'BEGIN { exit !(free_kib >= min_free_kib) }' \
  || fail "backup filesystem is below ${MIN_FREE_KIB} KiB."

validate_backup_destination
work_directory=$(mktemp -d "$BACKUP_DIRECTORY/.subweb-backup.XXXXXX") \
  || fail 'unable to create a unique backup workspace.'
chmod 0700 "$work_directory"
run_id=${work_directory##*.subweb-backup.}
timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
raw_file="$work_directory/raw.rdb"
if [ -n "$AGE_RECIPIENT" ]; then
  final_file="$BACKUP_DIRECTORY/subweb-redis-$timestamp-$run_id.rdb.age"
else
  final_file="$BACKUP_DIRECTORY/subweb-redis-$timestamp-$run_id.rdb"
fi
checksum_file="$final_file.sha256"
final_temporary="$work_directory/final"
checksum_temporary="$work_directory/checksum"
completed=0
cleanup() {
  if [ "$completed" -ne 1 ]; then
    [ -z "${final_file:-}" ] || rm -f -- "$final_file"
    [ -z "${checksum_file:-}" ] || rm -f -- "$checksum_file"
  fi
  [ -z "${work_directory:-}" ] || rm -rf -- "$work_directory"
}
trap cleanup EXIT HUP INT TERM

SUBWEB_ENV_FILE="$ENV_FILE" COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-subweb} \
  "$PROJECT_ROOT/scripts/subweb.sh" backup --output "$raw_file"
[ -s "$raw_file" ] || fail 'Redis backup is empty.'

if [ -n "$AGE_RECIPIENT" ]; then
  command -v age >/dev/null 2>&1 || fail 'age is required when AGE_RECIPIENT is configured.'
  age -r "$AGE_RECIPIENT" -o "$final_temporary" "$raw_file" \
    || fail 'age encryption failed.'
else
  mv "$raw_file" "$final_temporary"
fi
validate_backup_destination
mv "$final_temporary" "$final_file"

sha256sum "$final_file" >"$checksum_temporary" 2>/dev/null \
  || shasum -a 256 "$final_file" >"$checksum_temporary"
validate_backup_destination
mv "$checksum_temporary" "$checksum_file"
validate_backup_destination
chmod 0600 "$final_file" "$checksum_file"

validate_backup_destination
find "$BACKUP_DIRECTORY" -maxdepth 1 -type f \( -name 'subweb-redis-*.rdb' -o -name 'subweb-redis-*.rdb.age' \) -printf '%T@ %p\n' \
  | sort -nr \
  | awk -v keep="$BACKUP_RETENTION" 'NR > keep { sub(/^[^ ]+ /, ""); print }' \
  | while IFS= read -r old_file; do
      [ -n "$old_file" ] || continue
      rm -f -- "$old_file" "$old_file.sha256"
    done

completed=1
printf 'Encrypted/off-host Redis backup retained: %s\n' "$final_file"
