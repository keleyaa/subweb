#!/bin/sh

PAUSED_RELEASE_TIMERS=''

release_trees_overlap() {
  reconcile_source_path=$(CDPATH='' cd -P -- "$1" && pwd -P) || return 2
  reconcile_target_path=$(CDPATH='' cd -P -- "$2" && pwd -P) || return 2

  case "$reconcile_source_path" in
    "$reconcile_target_path"|"$reconcile_target_path"/*) return 0 ;;
  esac
  case "$reconcile_target_path" in
    "$reconcile_source_path"/*) return 0 ;;
  esac
  return 1
}

reconcile_target_has_nested_mount() {
  reconcile_target=$1
  if ! command -v findmnt >/dev/null 2>&1; then
    [ -r /proc/self/mountinfo ] && return 0
    return 1
  fi

  reconcile_mounts=$(findmnt -rn -o TARGET 2>/dev/null) || return 0
  while IFS= read -r reconcile_mount; do
    [ -n "$reconcile_mount" ] || continue
    case "$reconcile_mount" in
      "$reconcile_target"/*) return 0 ;;
    esac
  done <<EOF
$reconcile_mounts
EOF
  return 1
}

pause_enabled_release_timer() {
  reconcile_timer=$1
  reconcile_service=$2
  systemctl is-enabled --quiet "$reconcile_timer" || return 0
  if systemctl is-active --quiet "$reconcile_timer"; then
    PAUSED_RELEASE_TIMERS="${PAUSED_RELEASE_TIMERS}${PAUSED_RELEASE_TIMERS:+ }${reconcile_timer}"
  fi
  systemctl stop "$reconcile_timer" || return 1
  systemctl stop "$reconcile_service" || return 1
}

pause_enabled_release_timers() {
  pause_enabled_release_timer subweb-backup.timer subweb-backup.service || return 1
  pause_enabled_release_timer subweb-backup-verify.timer subweb-backup-verify.service || return 1
}

resume_paused_release_timers() {
  for reconcile_timer in $PAUSED_RELEASE_TIMERS; do
    systemctl start "$reconcile_timer" || return 1
  done
  PAUSED_RELEASE_TIMERS=''
}

reconcile_release_tree() {
  reconcile_source=$1
  reconcile_target=$2

  [ -d "$reconcile_source" ] && [ ! -L "$reconcile_source" ] || return 1
  if find "$reconcile_source" -type l -print -quit | grep -q .; then
    return 1
  fi
  [ ! -L "$reconcile_target" ] || return 1
  if [ -e "$reconcile_target" ]; then
    [ -d "$reconcile_target" ] || return 1
    if find "$reconcile_target" -type l -print -quit | grep -q .; then
      return 1
    fi
  else
    mkdir -p "$reconcile_target" || return 1
  fi

  if release_trees_overlap "$reconcile_source" "$reconcile_target"; then
    return 1
  else
    reconcile_overlap_status=$?
    [ "$reconcile_overlap_status" -eq 1 ] || return 1
  fi
  reconcile_target_has_nested_mount "$reconcile_target" && return 1

  find "$reconcile_target" -mindepth 1 -maxdepth 1 \
    ! -name .env ! -name .runtime ! -name .local \
    -exec rm -rf -- {} + || return 1

  for reconcile_entry in "$reconcile_source"/* "$reconcile_source"/.[!.]* "$reconcile_source"/..?*; do
    [ -e "$reconcile_entry" ] || [ -L "$reconcile_entry" ] || continue
    reconcile_name=${reconcile_entry##*/}
    case "$reconcile_name" in
      .env|.runtime|.local) continue ;;
    esac
    [ ! -L "$reconcile_entry" ] || return 1
    cp -pR "$reconcile_entry" "$reconcile_target/$reconcile_name" || return 1
  done

  if [ ! -e "$reconcile_target/.env" ] && [ -f "$reconcile_source/.env" ]; then
    cp -p "$reconcile_source/.env" "$reconcile_target/.env" || return 1
  fi

  if find "$reconcile_target" -type l -print -quit | grep -q .; then
    return 1
  fi
  return 0
}
