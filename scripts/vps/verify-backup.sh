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

BACKUP_DIRECTORY=$(backup_normalize_path "$BACKUP_DIRECTORY")
backup_expected_mount_identity=
verification_directory=
verified_backup=
verified_backup_identity=
cleanup() {
  [ -z "$verification_directory" ] || rm -rf -- "$verification_directory"
}
trap cleanup EXIT HUP INT TERM

snapshot_regular_file() {
  snapshot_source=$1
  snapshot_destination=$2
  snapshot_label=$3
  [ -f "$snapshot_source" ] && [ ! -L "$snapshot_source" ] \
    || fail "$snapshot_label must be a regular, non-symlink file."
  snapshot_identity=$(backup_file_identity "$snapshot_source") \
    || fail "unable to identify $snapshot_label before snapshotting."
  exec 6< "$snapshot_source" \
    || fail "unable to open $snapshot_label for snapshotting."
  cat <&6 > "$snapshot_destination" \
    || fail "unable to snapshot $snapshot_label."
  exec 6<&-
  snapshot_current_identity=$(backup_file_identity "$snapshot_source") \
    || fail "unable to identify $snapshot_label after snapshotting."
  [ "$snapshot_current_identity" = "$snapshot_identity" ] \
    || fail "$snapshot_label changed while it was being snapshotted."
  cmp -s "$snapshot_destination" "$snapshot_source" \
    || fail "$snapshot_label changed while it was being snapshotted."
  [ -f "$snapshot_destination" ] && [ ! -L "$snapshot_destination" ] \
    || fail "$snapshot_label snapshot is invalid."
  chmod 0600 "$snapshot_destination" \
    || fail "unable to protect $snapshot_label snapshot."
}

validate_backup_destination() {
  require_supported_backup_path BACKUP_DIRECTORY "$BACKUP_DIRECTORY"
  if [ -n "${backup_directory_handle:-}" ]; then
    backup_handle_identity=$(backup_file_identity "$backup_directory_handle") \
      || fail 'unable to inspect BACKUP_DIRECTORY handle; refusing verification.'
    backup_path_identity=$(backup_file_identity "$BACKUP_DIRECTORY") \
      || fail 'unable to inspect BACKUP_DIRECTORY; refusing verification.'
    [ "$backup_handle_identity" = "$backup_path_identity" ] \
      || fail 'BACKUP_DIRECTORY identity changed; refusing verification.'
  fi
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
backup_hold_directory "$BACKUP_DIRECTORY" \
  || fail 'unable to hold BACKUP_DIRECTORY open; refusing verification.'
backup_directory_handle=$(backup_directory_handle_path) \
  || fail 'unable to resolve BACKUP_DIRECTORY handle; refusing verification.'
backup_directory_handle_identity=$(backup_file_identity "$backup_directory_handle") \
  || fail 'unable to inspect BACKUP_DIRECTORY handle; refusing verification.'
backup_directory_path_identity=$(backup_file_identity "$BACKUP_DIRECTORY") \
  || fail 'unable to inspect BACKUP_DIRECTORY; refusing verification.'
[ "$backup_directory_handle_identity" = "$backup_directory_path_identity" ] \
  || fail 'BACKUP_DIRECTORY changed while opening its handle; refusing verification.'
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
checksum_sidecar=$(backup_canonical_child_path "$BACKUP_DIRECTORY" "$BACKUP_DIRECTORY/${backup##*/}.sha256") \
  || fail 'backup checksum sidecar must resolve inside BACKUP_DIRECTORY without symlink components.'

verification_directory=$(mktemp -d /tmp/subweb-backup-verify.XXXXXX) \
  || fail 'unable to create a private backup verification workspace.'
chmod 0700 "$verification_directory" \
  || fail 'unable to protect the backup verification workspace.'
case "$backup" in
  *.age) backup_snapshot=$verification_directory/backup.age ;;
  *) backup_snapshot=$verification_directory/backup ;;
esac
checksum_snapshot=$verification_directory/checksum
snapshot_regular_file "$backup" "$backup_snapshot" backup
snapshot_regular_file "$checksum_sidecar" "$checksum_snapshot" 'backup checksum sidecar'

checksum_record=$(sed -n '1p' "$checksum_snapshot") \
  || fail 'unable to read backup checksum sidecar.'
[ "$(wc -l <"$checksum_snapshot")" -eq 1 ] \
  || fail 'backup checksum sidecar must contain exactly one record for the selected backup.'
expected_checksum=${checksum_record%% *}
expected_path=${checksum_record#"$expected_checksum"}
expected_path=${expected_path# }
expected_path=${expected_path# }
expected_path=$(backup_canonical_child_path "$BACKUP_DIRECTORY" "$expected_path") \
  || fail 'backup checksum sidecar must identify the selected backup.'
[ "$expected_path" = "$backup" ] \
  || fail 'backup checksum sidecar must identify the selected backup.'
printf '%s\n' "$expected_checksum" | LC_ALL=C grep -Eq '^[0-9a-fA-F]{64}$' \
  || fail 'backup checksum sidecar contains an invalid SHA-256 digest.'
if command -v sha256sum >/dev/null 2>&1; then
  actual_checksum=$(sha256sum "$backup_snapshot" 2>/dev/null | awk 'NR == 1 { print $1 }') \
    || fail 'unable to calculate backup checksum.'
elif command -v shasum >/dev/null 2>&1; then
  actual_checksum=$(shasum -a 256 "$backup_snapshot" 2>/dev/null | awk 'NR == 1 { print $1 }') \
    || fail 'unable to calculate backup checksum.'
else
  fail 'sha256sum or shasum is required to calculate backup checksum.'
fi
printf '%s\n' "$actual_checksum" | LC_ALL=C grep -Eq '^[0-9a-fA-F]{64}$' \
  || fail 'backup checksum tool returned an invalid SHA-256 digest.'
[ "$actual_checksum" = "$expected_checksum" ] || fail 'backup checksum does not match.'
validate_backup_destination

verified_backup=$backup_snapshot
case "$backup" in
  *.age)
    [ -n "$AGE_IDENTITY_FILE" ] || fail 'AGE_IDENTITY_FILE is required for encrypted backup verification.'
    [ -f "$AGE_IDENTITY_FILE" ] && [ ! -L "$AGE_IDENTITY_FILE" ] || fail 'AGE_IDENTITY_FILE must be a regular file.'
    identity_permissions=$(stat -c '%a' "$AGE_IDENTITY_FILE" 2>/dev/null || stat -f '%Lp' "$AGE_IDENTITY_FILE" 2>/dev/null) \
      || fail 'unable to inspect AGE_IDENTITY_FILE permissions.'
    [ "$identity_permissions" = 600 ] || fail 'AGE_IDENTITY_FILE must be mode 0600.'
    command -v age >/dev/null 2>&1 || fail 'age is required for encrypted backup verification.'
    validate_backup_destination
    verified_backup=$verification_directory/decrypted.rdb
    age --decrypt --identity "$AGE_IDENTITY_FILE" -o "$verified_backup" "$backup_snapshot" \
      || fail 'unable to decrypt backup.'
    [ -f "$verified_backup" ] && [ ! -L "$verified_backup" ] \
      || fail 'decrypted backup must be a regular file.'
    chmod 0600 "$verified_backup" \
      || fail 'unable to protect the decrypted backup.'
    ;;
esac
verified_backup_identity=$(backup_file_identity "$verified_backup") \
  || fail 'unable to identify the verified backup.'

# This is the final check before the verified path reaches Docker as a bind mount.
validate_backup_destination
current_verified_backup_identity=$(backup_file_identity "$verified_backup") \
  || fail 'unable to identify the verified backup before binding it into Docker.'
[ "$current_verified_backup_identity" = "$verified_backup_identity" ] \
  || fail 'verified backup changed before it could be bound into Docker.'
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-subweb} \
  "$PROJECT_ROOT/scripts/operations/verify-redis-backup.sh" --backup "$verified_backup"
printf 'Redis backup restore verification passed: %s\n' "$backup"
