#!/bin/sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

fail() {
  printf 'VPS install failed: %s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail 'run as root.'
command -v install >/dev/null 2>&1 || fail 'install is required.'
command -v systemctl >/dev/null 2>&1 || fail 'systemd is required.'
command -v docker >/dev/null 2>&1 || fail 'Docker Engine is required.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required.'
# shellcheck source=reconcile-release.sh
. "$SCRIPT_DIRECTORY/reconcile-release.sh"

SOURCE_DIRECTORY=${SUBWEB_SOURCE:-}
TARGET_DIRECTORY=${SUBWEB_ROOT:-/opt/subweb}
[ -n "$SOURCE_DIRECTORY" ] || fail 'SUBWEB_SOURCE must point to a checked-out release.'
case "$SOURCE_DIRECTORY" in /*) ;; *) fail 'SUBWEB_SOURCE must be an absolute path.' ;; esac
[ -d "$SOURCE_DIRECTORY" ] && [ ! -L "$SOURCE_DIRECTORY" ] \
  || fail 'SUBWEB_SOURCE must be a directory and not a symlink.'
if find "$SOURCE_DIRECTORY" -type l -print -quit | grep -q .; then
  fail 'release tree must not contain symbolic links.'
fi
[ -f "$SOURCE_DIRECTORY/compose.yaml" ] || fail 'SUBWEB_SOURCE does not look like a Subweb release.'
for state_directory in .runtime .local; do
  [ ! -e "$SOURCE_DIRECTORY/$state_directory" ] && [ ! -L "$SOURCE_DIRECTORY/$state_directory" ] \
    || fail "release tree must not include $state_directory state."
done

[ "$TARGET_DIRECTORY" = /opt/subweb ] \
  || fail 'SUBWEB_ROOT must be /opt/subweb; custom deployment roots are not supported.'
[ ! -L "$TARGET_DIRECTORY" ] || fail 'deployment root must not be a symlink.'
if [ -e "$TARGET_DIRECTORY" ]; then
  [ -d "$TARGET_DIRECTORY" ] || fail 'deployment root must be a directory.'
  if find "$TARGET_DIRECTORY" -type l -print -quit | grep -q .; then
    fail 'existing deployment tree must not contain symbolic links.'
  fi
fi
if [ -e "$TARGET_DIRECTORY/.env" ]; then
  [ -f "$TARGET_DIRECTORY/.env" ] && [ ! -L "$TARGET_DIRECTORY/.env" ] \
    || fail 'installed .env must be a regular file and not a symlink.'
fi
if [ ! -f "$SOURCE_DIRECTORY/.env" ] && [ ! -f "$TARGET_DIRECTORY/.env" ]; then
  fail 'installed .env must be a regular file before installation.'
fi

getent group subweb >/dev/null 2>&1 || groupadd --system subweb
id subweb >/dev/null 2>&1 || useradd --system --gid subweb --home-dir "$TARGET_DIRECTORY" --no-create-home --shell /usr/sbin/nologin subweb

install -d -o root -g subweb -m 0750 "$TARGET_DIRECTORY"
install -d -o subweb -g subweb -m 0700 "$TARGET_DIRECTORY/.runtime" "$TARGET_DIRECTORY/.local"
install -d -o subweb -g subweb -m 0700 /var/lib/subweb-backups
reconcile_release_tree "$SOURCE_DIRECTORY" "$TARGET_DIRECTORY" \
  || fail 'unable to reconcile the installed release tree.'
if find "$TARGET_DIRECTORY" -type l -print -quit | grep -q .; then
  fail 'reconciled deployment tree must not contain symbolic links.'
fi
[ -f "$TARGET_DIRECTORY/.env" ] && [ ! -L "$TARGET_DIRECTORY/.env" ] \
  || fail 'installed .env must be a regular file and not a symlink.'
find "$TARGET_DIRECTORY" \
  \( -path "$TARGET_DIRECTORY/.runtime" -o -path "$TARGET_DIRECTORY/.local" -o -path "$TARGET_DIRECTORY/.env" \) -prune -o \
  -exec chown root:subweb {} +
chown subweb:subweb "$TARGET_DIRECTORY/.env"
chmod 0600 "$TARGET_DIRECTORY/.env"
find "$TARGET_DIRECTORY/scripts" -type f -name '*.sh' -exec chmod 0750 {} +

install -d -o root -g root -m 0755 /etc/subweb
install -m 0644 deploy/systemd/subweb.service /etc/systemd/system/subweb.service
install -m 0644 deploy/systemd/subweb-backup.service /etc/systemd/system/subweb-backup.service
install -m 0644 deploy/systemd/subweb-backup.timer /etc/systemd/system/subweb-backup.timer
install -m 0644 deploy/systemd/subweb-backup-verify.service /etc/systemd/system/subweb-backup-verify.service
install -m 0644 deploy/systemd/subweb-backup-verify.timer /etc/systemd/system/subweb-backup-verify.timer
install -d -m 0755 /etc/nginx/sites-available /etc/nginx/snippets
install -m 0644 nginx/snippets/security-headers.conf /etc/nginx/snippets/security-headers.conf
install -m 0644 deploy/logrotate/subweb.conf /etc/logrotate.d/subweb
install -m 0644 deploy/nginx/subweb.conf /etc/nginx/sites-available/subweb

systemctl daemon-reload
systemctl enable subweb.service
systemctl enable subweb-backup.timer
systemctl enable subweb-backup-verify.timer
printf 'VPS installation prepared at %s. Run scripts/vps/check-host.sh, then systemctl start subweb.service.\n' "$TARGET_DIRECTORY"
