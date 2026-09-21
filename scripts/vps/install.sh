#!/bin/sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)

fail() {
  printf 'VPS install failed: %s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail 'run as root.'
command -v install >/dev/null 2>&1 || fail 'install is required.'
command -v readlink >/dev/null 2>&1 || fail 'readlink is required.'
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

release_tree_has_unsafe_modes() {
  release_tree=$1
  release_tree_entry=$(find "$release_tree" \
    \( -type f -o -type d \) \
    \( -perm -020 -o -perm -002 \) -print -quit) || return 2
  [ -n "$release_tree_entry" ]
}

if release_tree_has_unsafe_modes "$SOURCE_DIRECTORY"; then
  fail 'release tree must not contain group- or other-writable entries.'
else
  release_tree_mode_status=$?
  case "$release_tree_mode_status" in
    1) ;;
    *) fail 'unable to validate release tree modes.' ;;
  esac
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

HOST_ASSET_BACKUP=''
HOST_ASSET_MANIFEST=''
UNIT_ENABLEMENT_SNAPSHOT=''
NGINX_SITE_LINK_CREATED=0
INSTALLATION_COMMITTED=0

reconcile_host_assets() {
  printf '%s|%s\n' "$SOURCE_DIRECTORY/deploy/systemd/subweb.service" /etc/systemd/system/subweb.service
  printf '%s|%s\n' "$SOURCE_DIRECTORY/deploy/systemd/subweb-backup.service" /etc/systemd/system/subweb-backup.service
  printf '%s|%s\n' "$SOURCE_DIRECTORY/deploy/systemd/subweb-backup.timer" /etc/systemd/system/subweb-backup.timer
  printf '%s|%s\n' "$SOURCE_DIRECTORY/deploy/systemd/subweb-backup-verify.service" /etc/systemd/system/subweb-backup-verify.service
  printf '%s|%s\n' "$SOURCE_DIRECTORY/deploy/systemd/subweb-backup-verify.timer" /etc/systemd/system/subweb-backup-verify.timer
  printf '%s|%s\n' "$SOURCE_DIRECTORY/nginx/snippets/security-headers.conf" /etc/nginx/snippets/security-headers.conf
  printf '%s|%s\n' "$SOURCE_DIRECTORY/deploy/logrotate/subweb.conf" /etc/logrotate.d/subweb
  printf '%s|%s\n' "$SOURCE_DIRECTORY/deploy/nginx/subweb.conf" /etc/nginx/sites-available/subweb
}

reconcile_preflight_nginx_site_link() {
  nginx_site_link=/etc/nginx/sites-enabled/subweb
  if [ -e "$nginx_site_link" ] || [ -L "$nginx_site_link" ]; then
    [ -L "$nginx_site_link" ] || return 1
    [ "$(readlink "$nginx_site_link")" = /etc/nginx/sites-available/subweb ] || return 1
  fi
}

reconcile_preflight_host_assets() {
  reconcile_host_assets | while IFS='|' read -r host_asset_source host_asset_target; do
    [ -f "$host_asset_source" ] && [ ! -L "$host_asset_source" ] || return 1
    [ ! -e "$host_asset_target" ] && [ ! -L "$host_asset_target" ] && continue
    [ -f "$host_asset_target" ] && [ ! -L "$host_asset_target" ] || return 1
  done
  reconcile_preflight_nginx_site_link
}

reconcile_managed_units() {
  printf '%s\n' subweb.service subweb-backup.timer subweb-backup-verify.timer
}

reconcile_snapshot_managed_unit_enablement() {
  UNIT_ENABLEMENT_SNAPSHOT="$HOST_ASSET_BACKUP/unit-enablement"
  reconcile_managed_units | while IFS= read -r managed_unit; do
    if systemctl is-enabled --quiet "$managed_unit"; then
      printf 'enabled|%s\n' "$managed_unit" >> "$UNIT_ENABLEMENT_SNAPSHOT" || return 1
    else
      printf 'disabled|%s\n' "$managed_unit" >> "$UNIT_ENABLEMENT_SNAPSHOT" || return 1
    fi
  done
}

reconcile_restore_managed_unit_enablement() {
  [ -n "$UNIT_ENABLEMENT_SNAPSHOT" ] && [ -f "$UNIT_ENABLEMENT_SNAPSHOT" ] || return 0
  while IFS='|' read -r unit_enablement managed_unit; do
    case "$unit_enablement" in
      enabled) systemctl enable "$managed_unit" || return 1 ;;
      disabled) systemctl disable "$managed_unit" || return 1 ;;
      *) return 1 ;;
    esac
  done < "$UNIT_ENABLEMENT_SNAPSHOT"
}

reconcile_snapshot_host_assets() {
  install -d -o root -g root -m 0755 \
    /etc/subweb /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/snippets \
    || return 1
  HOST_ASSET_BACKUP=$(mktemp -d /etc/subweb/.install-assets.XXXXXX) || return 1
  HOST_ASSET_MANIFEST="$HOST_ASSET_BACKUP/manifest"
  reconcile_host_assets | while IFS='|' read -r host_asset_source host_asset_target; do
    if [ -e "$host_asset_target" ]; then
      host_asset_backup="$HOST_ASSET_BACKUP$host_asset_target"
      install -d -m 0700 "$(dirname -- "$host_asset_backup")" || return 1
      cp -p "$host_asset_target" "$host_asset_backup" || return 1
      printf 'present|%s\n' "$host_asset_target" >> "$HOST_ASSET_MANIFEST" || return 1
    else
      printf 'absent|%s\n' "$host_asset_target" >> "$HOST_ASSET_MANIFEST" || return 1
    fi
  done
}

reconcile_restore_host_assets() {
  [ -n "$HOST_ASSET_MANIFEST" ] && [ -f "$HOST_ASSET_MANIFEST" ] || return 0
  while IFS='|' read -r host_asset_state host_asset_target; do
    case "$host_asset_state" in
      present)
        host_asset_backup="$HOST_ASSET_BACKUP$host_asset_target"
        [ -f "$host_asset_backup" ] && [ ! -L "$host_asset_backup" ] || return 1
        rm -f -- "$host_asset_target" || return 1
        cp -p "$host_asset_backup" "$host_asset_target" || return 1
        ;;
      absent) rm -f -- "$host_asset_target" || return 1 ;;
      *) return 1 ;;
    esac
  done < "$HOST_ASSET_MANIFEST"
}

reconcile_discard_host_asset_snapshot() {
  [ -n "$HOST_ASSET_BACKUP" ] || return 0
  rm -rf -- "$HOST_ASSET_BACKUP" || return 1
  HOST_ASSET_BACKUP=''
  HOST_ASSET_MANIFEST=''
}

reconcile_install_host_assets() {
  reconcile_host_assets | while IFS='|' read -r host_asset_source host_asset_target; do
    install -m 0644 "$host_asset_source" "$host_asset_target" || return 1
  done
  nginx_site_link=/etc/nginx/sites-enabled/subweb
  if [ ! -e "$nginx_site_link" ] && [ ! -L "$nginx_site_link" ]; then
    ln -s /etc/nginx/sites-available/subweb "$nginx_site_link" || return 1
    NGINX_SITE_LINK_CREATED=1
  fi
}

cleanup_installation() {
  cleanup_status=$1
  trap - 0 HUP INT TERM
  if [ "$INSTALLATION_COMMITTED" -eq 0 ]; then
    if ! reconcile_restore_host_assets >/dev/null 2>&1; then
      printf 'VPS install rollback failed: unable to restore host assets.\n' >&2
      cleanup_status=1
    fi
    if [ "$NGINX_SITE_LINK_CREATED" -eq 1 ] \
      && ! rm -f -- /etc/nginx/sites-enabled/subweb >/dev/null 2>&1; then
      printf 'VPS install rollback failed: unable to remove the Nginx site link.\n' >&2
      cleanup_status=1
    fi
    if ! systemctl daemon-reload >/dev/null 2>&1; then
      printf 'VPS install rollback failed: unable to reload systemd.\n' >&2
      cleanup_status=1
    fi
    if ! reconcile_restore_managed_unit_enablement >/dev/null 2>&1; then
      printf 'VPS install rollback failed: unable to restore unit enablement.\n' >&2
      cleanup_status=1
    fi
    if ! reconcile_release_abort >/dev/null 2>&1; then
      printf 'VPS install rollback failed: unable to restore the previous release.\n' >&2
      cleanup_status=1
    fi
    if ! resume_paused_release_timers >/dev/null 2>&1; then
      printf 'VPS install rollback failed: unable to restore backup timers.\n' >&2
      cleanup_status=1
    fi
  fi
  reconcile_discard_host_asset_snapshot >/dev/null 2>&1 || true
  return "$cleanup_status"
}

if release_trees_overlap "$SOURCE_DIRECTORY" "$TARGET_DIRECTORY"; then
  fail 'SUBWEB_SOURCE must not overlap the deployment root.'
else
  release_overlap_status=$?
  [ "$release_overlap_status" -eq 1 ] \
    || fail 'unable to resolve the release source and deployment root.'
fi
reconcile_preflight_host_assets || fail 'selected release host assets are missing or unsafe.'
trap 'cleanup_installation "$?"' 0
trap 'exit 1' HUP INT TERM
reconcile_snapshot_host_assets || fail 'unable to snapshot existing host assets.'
reconcile_snapshot_managed_unit_enablement || fail 'unable to snapshot unit enablement.'
pause_enabled_release_timers \
  || fail 'unable to pause enabled backup or verification timers.'
install -d -o subweb -g subweb -m 0700 /var/lib/subweb-backups
reconcile_release_tree "$SOURCE_DIRECTORY" "$TARGET_DIRECTORY" \
  || fail 'unable to stage and cut over the installed release tree.'
install -d -o subweb -g subweb -m 0700 "$TARGET_DIRECTORY/.runtime" "$TARGET_DIRECTORY/.local"
if find "$TARGET_DIRECTORY" -type l -print -quit | grep -q .; then
  fail 'reconciled deployment tree must not contain symbolic links.'
fi
[ -f "$TARGET_DIRECTORY/.env" ] && [ ! -L "$TARGET_DIRECTORY/.env" ] \
  || fail 'installed .env must be a regular file and not a symlink.'
normalize_installed_release_tree() {
  installed_tree=$1
  find "$installed_tree" \
    \( -path "$installed_tree/.runtime" -o -path "$installed_tree/.local" -o -path "$installed_tree/.env" \) -prune -o \
    -type d -exec chown root:subweb {} + -exec chmod 0750 {} + || return 1
  find "$installed_tree" \
    \( -path "$installed_tree/.runtime" -o -path "$installed_tree/.local" -o -path "$installed_tree/.env" \) -prune -o \
    -type f -exec chown root:subweb {} + -exec chmod 0640 {} + || return 1
  chown subweb:subweb "$installed_tree/.env" || return 1
  chmod 0600 "$installed_tree/.env" || return 1
  find "$installed_tree/scripts" -type f -name '*.sh' -exec chmod 0750 {} + || return 1
}
normalize_installed_release_tree "$TARGET_DIRECTORY" \
  || fail 'unable to secure the installed release tree.'

reconcile_install_host_assets || fail 'unable to install selected release host assets.'
systemctl daemon-reload || fail 'unable to reload systemd after installing host assets.'
systemctl enable subweb.service
systemctl enable subweb-backup.timer
systemctl enable subweb-backup-verify.timer
reconcile_release_start_prior_service \
  || fail 'unable to start the prior active service from the selected release.'
resume_paused_release_timers \
  || fail 'unable to resume active backup or verification timers.'
reconcile_release_commit || fail 'unable to commit the selected release.'
INSTALLATION_COMMITTED=1
NGINX_SITE_LINK_CREATED=0
trap - 0 HUP INT TERM
reconcile_discard_host_asset_snapshot || fail 'unable to discard host asset snapshot.'
printf 'VPS installation prepared at %s. Run scripts/vps/check-host.sh, then systemctl start subweb.service.\n' "$TARGET_DIRECTORY"
