#!/bin/sh
set -eu
umask 077

SCRIPT_DIRECTORY=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
PROJECT_ROOT=${SUBWEB_ROOT:-/opt/subweb}
BACKUP_DIRECTORY=${BACKUP_DIRECTORY:-/var/lib/subweb-backups}
BACKUP_REMOTE_MOUNT=${BACKUP_REMOTE_MOUNT:-}
AGE_IDENTITY_FILE=${AGE_IDENTITY_FILE:-}
backup=${1-}
fail() {
  printf 'VPS backup verification failed: %s\n' "$1" >&2
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
    || fail 'BACKUP_REMOTE_MOUNT must be a distinct mounted filesystem; refusing verification.'
  backup_path_is_within "$BACKUP_REMOTE_MOUNT" "$BACKUP_DIRECTORY" \
    || fail 'BACKUP_DIRECTORY must be under BACKUP_REMOTE_MOUNT; refusing verification.'
  backup_observed_mount_identity=$(backup_mount_identity "$BACKUP_REMOTE_MOUNT") \
    || fail 'unable to determine BACKUP_REMOTE_MOUNT identity.'
  case "$backup_expected_mount_identity" in
    '') backup_expected_mount_identity=$backup_observed_mount_identity ;;
    "$backup_observed_mount_identity") ;;
    *) fail 'BACKUP_REMOTE_MOUNT identity changed; refusing verification.' ;;
  esac
}

validate_backup_destination
if [ -n "$BACKUP_REMOTE_MOUNT" ]; then
  # Keep the validated directory open and revalidate its mount before use.
  backup_hold_mount "$BACKUP_REMOTE_MOUNT" \
    || fail 'unable to hold BACKUP_REMOTE_MOUNT open; refusing verification.'
  validate_backup_destination
fi

case "$backup" in /*) ;; *) fail 'backup path must be absolute.' ;; esac
backup=$(backup_canonical_child_path "$BACKUP_DIRECTORY" "$backup") \
  || fail 'backup must resolve inside BACKUP_DIRECTORY without symlink components.'
[ -f "$backup" ] && [ ! -L "$backup" ] || fail 'backup must be a regular file.'
checksum_sidecar=$backup.sha256
[ -f "$checksum_sidecar" ] && [ ! -L "$checksum_sidecar" ] \
  || fail 'backup checksum sidecar must be a regular, non-symlink file.'
checksum_sidecar=$(backup_canonical_child_path "$BACKUP_DIRECTORY" "$checksum_sidecar") \
  || fail 'backup checksum sidecar must resolve inside BACKUP_DIRECTORY without symlink components.'
expected_checksum=$(awk -v selected_backup="$backup" '
  $2 == selected_backup && NF == 2 { count += 1; checksum = $1 }
  END { if (count == 1) print checksum; else exit 1 }
' "$checksum_sidecar") \
  || fail 'backup checksum sidecar must contain exactly one record for the selected backup.'
printf '%s\n' "$expected_checksum" | LC_ALL=C grep -Eq '^[0-9a-f]{64}$' \
  || fail 'backup checksum sidecar contains an invalid SHA-256 digest.'
actual_checksum=$(sha256sum "$backup" 2>/dev/null | awk 'NR == 1 { print $1 }') \
  || actual_checksum=$(shasum -a 256 "$backup" 2>/dev/null | awk 'NR == 1 { print $1 }') \
  || fail 'unable to calculate backup checksum.'
[ "$actual_checksum" = "$expected_checksum" ] || fail 'backup checksum does not match.'
validate_backup_destination

verified_backup=$backup
temporary=
cleanup() { [ -z "$temporary" ] || rm -f -- "$temporary"; }
trap cleanup EXIT HUP INT TERM
case "$backup" in
  *.age)
    [ -n "$AGE_IDENTITY_FILE" ] || fail 'AGE_IDENTITY_FILE is required for encrypted backup verification.'
    [ -f "$AGE_IDENTITY_FILE" ] && [ ! -L "$AGE_IDENTITY_FILE" ] || fail 'AGE_IDENTITY_FILE must be a regular file.'
    identity_permissions=$(stat -c '%a' "$AGE_IDENTITY_FILE" 2>/dev/null || stat -f '%Lp' "$AGE_IDENTITY_FILE" 2>/dev/null) \
      || fail 'unable to inspect AGE_IDENTITY_FILE permissions.'
    [ "$identity_permissions" = 600 ] || fail 'AGE_IDENTITY_FILE must be mode 0600.'
    command -v age >/dev/null 2>&1 || fail 'age is required for encrypted backup verification.'
    validate_backup_destination
    temporary=$(mktemp "$BACKUP_DIRECTORY/.verify.XXXXXX")
    chmod 0600 "$temporary"
    age --decrypt --identity "$AGE_IDENTITY_FILE" -o "$temporary" "$backup" \
      || fail 'unable to decrypt backup.'
    verified_backup=$temporary
    ;;
esac

# This is the final check before the verified path reaches Docker as a bind mount.
validate_backup_destination
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-subweb} \
  "$PROJECT_ROOT/scripts/operations/verify-redis-backup.sh" --backup "$verified_backup"
printf 'Redis backup restore verification passed: %s\n' "$backup"
