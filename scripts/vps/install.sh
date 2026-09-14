#!/bin/sh
set -eu

fail() {
  printf 'VPS install failed: %s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail 'run as root.'
command -v install >/dev/null 2>&1 || fail 'install is required.'
command -v systemctl >/dev/null 2>&1 || fail 'systemd is required.'
command -v docker >/dev/null 2>&1 || fail 'Docker Engine is required.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required.'

SOURCE_DIRECTORY=${SUBWEB_SOURCE:-}
TARGET_DIRECTORY=${SUBWEB_ROOT:-/opt/subweb}
[ -n "$SOURCE_DIRECTORY" ] || fail 'SUBWEB_SOURCE must point to a checked-out release.'
case "$SOURCE_DIRECTORY" in /*) ;; *) fail 'SUBWEB_SOURCE must be an absolute path.' ;; esac
[ -d "$SOURCE_DIRECTORY" ] || fail 'SUBWEB_SOURCE must be a directory.'

if ! getent group subweb >/dev/null 2>&1; then
  groupadd --system subweb
fi
if ! id subweb >/dev/null 2>&1; then
  useradd --system --gid subweb --home-dir "$TARGET_DIRECTORY" --no-create-home --shell /usr/sbin/nologin subweb
fi
if ! id -nG subweb | tr ' ' '\n' | grep -qx docker; then
  usermod -aG docker subweb
fi

install -d -o root -g subweb -m 0750 "$TARGET_DIRECTORY"
install -d -o subweb -g subweb -m 0700 "$TARGET_DIRECTORY/.runtime" "$TARGET_DIRECTORY/.local"
install -d -o subweb -g subweb -m 0700 /var/lib/subweb-backups
cp -a "$SOURCE_DIRECTORY/." "$TARGET_DIRECTORY/"
chown -R root:subweb "$TARGET_DIRECTORY"
find "$TARGET_DIRECTORY/scripts" -type f -name '*.sh' -exec chmod 0750 {} +
if [ -f "$TARGET_DIRECTORY/.env" ]; then
  chown subweb:subweb "$TARGET_DIRECTORY/.env"
  chmod 0600 "$TARGET_DIRECTORY/.env"
fi

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
