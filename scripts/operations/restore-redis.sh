#!/bin/sh
set -eu
umask 077

# shellcheck source=lib.sh
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/lib.sh"

backup=
confirmed=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup) [ "$#" -ge 2 ] || operations_fail '--backup requires a value.'; backup=$2; shift 2 ;;
    --confirm-stop-writes) confirmed=1; shift ;;
    *) operations_fail "unknown argument: $1" ;;
  esac
done

[ "$confirmed" -eq 1 ] || operations_fail '--confirm-stop-writes is required.'
[ -n "$backup" ] || operations_fail '--backup is required.'
require_absolute_regular_file "$backup" 'backup'
require_docker
"$operations_script_directory/verify-redis-backup.sh" --backup "$backup"

runtime_backup_directory=${SUBWEB_OPERATIONS_RUNTIME_DIR:-$operations_project_root/.runtime/redis-backups}
case "$runtime_backup_directory" in /*) ;; *) operations_fail 'operations runtime directory must be absolute.' ;; esac
mkdir -p "$runtime_backup_directory"
chmod 0700 "$runtime_backup_directory"
rollback_backup=$runtime_backup_directory/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).rdb
"$operations_script_directory/backup-redis.sh" --output "$rollback_backup"
restore_staging=$(mktemp "$runtime_backup_directory/.restore-staging.XXXXXX") \
  || operations_fail 'unable to create restore staging file'
trap 'rm -f "$restore_staging"' EXIT HUP INT TERM

cd "$operations_project_root"
docker compose stop gateway myurls-app myurls-short >/dev/null 2>&1 || true
docker compose stop redis >/dev/null

install_snapshot() {
  snapshot=$1
  install -m 0644 "$snapshot" "$restore_staging" || return 1
  if docker compose run --rm --no-deps \
    -v "$restore_staging:/restore.rdb:ro" \
    --entrypoint sh redis -eu -c \
    'rm -rf /data/appendonlydir
     cp /restore.rdb /data/dump.rdb
     chmod 0600 /data/dump.rdb
     redis-server --daemonize yes --port 0 --unixsocket /run/redis/restore.sock \
       --pidfile /run/redis/restore.pid --dir /data --dbfilename dump.rdb \
       --appendonly no --protected-mode no
     attempts=0
     until redis-cli -s /run/redis/restore.sock ping >/dev/null 2>&1; do
       attempts=$((attempts + 1))
       [ "$attempts" -lt 50 ] || exit 1
     done
     redis-cli -s /run/redis/restore.sock CONFIG SET appendonly yes >/dev/null
     attempts=0
     while :; do
       persistence=$(redis-cli -s /run/redis/restore.sock --raw INFO persistence)
       printf "%s\n" "$persistence" | grep -q "^aof_enabled:1" \
         && printf "%s\n" "$persistence" | grep -q "^aof_rewrite_in_progress:0" \
         && printf "%s\n" "$persistence" | grep -q "^aof_rewrite_scheduled:0" \
         && break
       attempts=$((attempts + 1))
       [ "$attempts" -lt 100 ] || exit 1
     done
     redis-cli -s /run/redis/restore.sock SHUTDOWN NOSAVE >/dev/null 2>&1 || true'; then
    result=0
  else
    result=$?
  fi
  rm -f "$restore_staging"
  return "$result"
}

if ! install_snapshot "$backup" || ! docker compose up -d --wait; then
  printf '%s\n' 'Restore failed; attempting rollback to the pre-restore snapshot.' >&2
  docker compose stop gateway myurls-app myurls-short redis >/dev/null 2>&1 || true
  install_snapshot "$rollback_backup" || operations_fail "rollback snapshot installation failed; writes remain stopped. Backup: $rollback_backup"
  docker compose up -d --wait || operations_fail "rollback startup failed; writes remain stopped. Backup: $rollback_backup"
  operations_fail "restore failed and the previous snapshot was reloaded. Backup retained: $rollback_backup"
fi

printf 'Redis restore completed. Pre-restore backup retained: %s\n' "$rollback_backup"
