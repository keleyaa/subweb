#!/bin/sh
set -eu
umask 077

PROJECT_ROOT=${SUBWEB_ROOT:-/opt/subweb}
BACKUP_DIRECTORY=${BACKUP_DIRECTORY:-/var/lib/subweb-backups}
AGE_IDENTITY_FILE=${AGE_IDENTITY_FILE:-}
backup=${1-}
fail() {
  printf 'VPS backup verification failed: %s\n' "$1" >&2
  exit 1
}

case "$backup" in /*) ;; *) fail 'backup path must be absolute.' ;; esac
[ -f "$backup" ] && [ ! -L "$backup" ] || fail 'backup must be a regular file.'
case "$backup" in
  "$BACKUP_DIRECTORY"/*) ;;
  *) fail 'backup must be inside BACKUP_DIRECTORY.' ;;
esac
[ -f "$backup.sha256" ] || fail 'backup checksum sidecar is missing.'
sha256sum -c "$backup.sha256" >/dev/null 2>&1 \
  || shasum -a 256 -c "$backup.sha256" >/dev/null 2>&1 \
  || fail 'backup checksum does not match.'

verified_backup=$backup
temporary=
cleanup() { [ -z "$temporary" ] || rm -f "$temporary"; }
trap cleanup EXIT HUP INT TERM
case "$backup" in
  *.age)
    [ -n "$AGE_IDENTITY_FILE" ] || fail 'AGE_IDENTITY_FILE is required for encrypted backup verification.'
    [ -f "$AGE_IDENTITY_FILE" ] && [ ! -L "$AGE_IDENTITY_FILE" ] || fail 'AGE_IDENTITY_FILE must be a regular file.'
    identity_permissions=$(stat -c '%a' "$AGE_IDENTITY_FILE" 2>/dev/null || stat -f '%Lp' "$AGE_IDENTITY_FILE" 2>/dev/null) \
      || fail 'unable to inspect AGE_IDENTITY_FILE permissions.'
    [ "$identity_permissions" = 600 ] || fail 'AGE_IDENTITY_FILE must be mode 0600.'
    command -v age >/dev/null 2>&1 || fail 'age is required for encrypted backup verification.'
    temporary=$(mktemp "$BACKUP_DIRECTORY/.verify.XXXXXX")
    chmod 0600 "$temporary"
    age --decrypt --identity "$AGE_IDENTITY_FILE" -o "$temporary" "$backup" \
      || fail 'unable to decrypt backup.'
    verified_backup=$temporary
    ;;
esac

COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-subweb} \
  "$PROJECT_ROOT/scripts/operations/verify-redis-backup.sh" --backup "$verified_backup"
printf 'Redis backup restore verification passed: %s\n' "$backup"
