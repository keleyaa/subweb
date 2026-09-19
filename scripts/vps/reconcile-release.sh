#!/bin/sh

PAUSED_RELEASE_ACTIVE_TIMERS=''
PAUSED_RELEASE_ACTIVE_SERVICES=''
RECONCILE_RELEASE_STAGE=''
RECONCILE_RELEASE_OLD=''
RECONCILE_RELEASE_TARGET=''
RECONCILE_RELEASE_SERVICE_WAS_ACTIVE=0
RECONCILE_RELEASE_OLD_IS_TREE=0
RECONCILE_RELEASE_NEW_TREE_LIVE=0
RECONCILE_RELEASE_CUTOVER_PENDING=0

reconcile_resolve_tree_path() {
  reconcile_path=$1
  if [ -e "$reconcile_path" ] || [ -L "$reconcile_path" ]; then
    CDPATH='' cd -P -- "$reconcile_path" && pwd -P
    return
  fi

  reconcile_parent=$(dirname -- "$reconcile_path") || return 1
  reconcile_name=$(basename -- "$reconcile_path") || return 1
  reconcile_parent=$(CDPATH='' cd -P -- "$reconcile_parent" && pwd -P) || return 1
  printf '%s/%s\n' "$reconcile_parent" "$reconcile_name"
}

release_trees_overlap() {
  reconcile_source_path=$(reconcile_resolve_tree_path "$1") || return 2
  reconcile_target_path=$(reconcile_resolve_tree_path "$2") || return 2

  case "$reconcile_source_path" in
    "$reconcile_target_path"|"$reconcile_target_path"/*) return 0 ;;
  esac
  case "$reconcile_target_path" in
    "$reconcile_source_path"/*) return 0 ;;
  esac
  return 1
}

# Linux mountinfo encodes the mount point in field five when findmnt is absent.
reconcile_mountinfo_stream() {
  cat /proc/self/mountinfo
}

reconcile_target_has_nested_mount() {
  reconcile_target=$1
  if command -v findmnt >/dev/null 2>&1; then
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
  fi

  reconcile_mounts=$(reconcile_mountinfo_stream 2>/dev/null) || return 0
  [ -n "$reconcile_mounts" ] || return 0
  while IFS= read -r reconcile_mountinfo; do
    set -- $reconcile_mountinfo
    [ "$#" -ge 5 ] || return 0
    reconcile_mount=$(printf '%b\n' "$5") || return 0
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
  reconcile_timer_was_enabled=0
  reconcile_timer_was_active=0
  reconcile_service_was_active=0

  if systemctl is-enabled --quiet "$reconcile_timer"; then
    reconcile_timer_was_enabled=1
  fi
  if systemctl is-active --quiet "$reconcile_timer"; then
    reconcile_timer_was_active=1
    PAUSED_RELEASE_ACTIVE_TIMERS="${PAUSED_RELEASE_ACTIVE_TIMERS}${PAUSED_RELEASE_ACTIVE_TIMERS:+ }${reconcile_timer}"
  fi
  if systemctl is-active --quiet "$reconcile_service"; then
    reconcile_service_was_active=1
    PAUSED_RELEASE_ACTIVE_SERVICES="${PAUSED_RELEASE_ACTIVE_SERVICES}${PAUSED_RELEASE_ACTIVE_SERVICES:+ }${reconcile_service}"
  fi

  if [ "$reconcile_timer_was_enabled" -eq 1 ] || [ "$reconcile_timer_was_active" -eq 1 ]; then
    systemctl stop "$reconcile_timer" || return 1
  fi
  [ "$reconcile_service_was_active" -eq 0 ] || systemctl stop "$reconcile_service"
}

pause_enabled_release_timers() {
  pause_enabled_release_timer subweb-backup.timer subweb-backup.service || return 1
  pause_enabled_release_timer subweb-backup-verify.timer subweb-backup-verify.service || return 1
}

resume_paused_release_timers() {
  for reconcile_service in $PAUSED_RELEASE_ACTIVE_SERVICES; do
    systemctl start "$reconcile_service" || return 1
  done
  for reconcile_timer in $PAUSED_RELEASE_ACTIVE_TIMERS; do
    systemctl start "$reconcile_timer" || return 1
  done
  PAUSED_RELEASE_ACTIVE_TIMERS=''
  PAUSED_RELEASE_ACTIVE_SERVICES=''
}

reconcile_tree_is_safe() {
  reconcile_tree=$1
  [ -d "$reconcile_tree" ] && [ ! -L "$reconcile_tree" ] || return 1
  reconcile_link=$(find "$reconcile_tree" -type l -print -quit) || return 1
  [ -z "$reconcile_link" ]
}

reconcile_validate_runtime_state() {
  reconcile_tree=$1
  for reconcile_state_name in .runtime .local; do
    [ -d "$reconcile_tree/$reconcile_state_name" ] && [ ! -L "$reconcile_tree/$reconcile_state_name" ] || return 1
  done
  if [ -e "$reconcile_tree/.env" ] || [ -L "$reconcile_tree/.env" ]; then
    [ -f "$reconcile_tree/.env" ] && [ ! -L "$reconcile_tree/.env" ] || return 1
  fi
}

reconcile_copy_selected_release() {
  reconcile_source=$1
  reconcile_stage=$2

  for reconcile_entry in "$reconcile_source"/* "$reconcile_source"/.[!.]* "$reconcile_source"/..?*; do
    [ -e "$reconcile_entry" ] || [ -L "$reconcile_entry" ] || continue
    reconcile_name=${reconcile_entry##*/}
    case "$reconcile_name" in
      .env|.runtime|.local) continue ;;
    esac
    cp -pR "$reconcile_entry" "$reconcile_stage/$reconcile_name" || return 1
  done
}

reconcile_copy_runtime_state() {
  reconcile_source=$1
  reconcile_target=$2
  reconcile_stage=$3

  if [ -e "$reconcile_target/.env" ] || [ -L "$reconcile_target/.env" ]; then
    [ -f "$reconcile_target/.env" ] && [ ! -L "$reconcile_target/.env" ] || return 1
    cp -p "$reconcile_target/.env" "$reconcile_stage/.env" || return 1
  elif [ -e "$reconcile_source/.env" ] || [ -L "$reconcile_source/.env" ]; then
    [ -f "$reconcile_source/.env" ] && [ ! -L "$reconcile_source/.env" ] || return 1
    cp -p "$reconcile_source/.env" "$reconcile_stage/.env" || return 1
  fi

  for reconcile_state_name in .runtime .local; do
    if [ -e "$reconcile_target/$reconcile_state_name" ] || [ -L "$reconcile_target/$reconcile_state_name" ]; then
      [ -d "$reconcile_target/$reconcile_state_name" ] && [ ! -L "$reconcile_target/$reconcile_state_name" ] || return 1
      cp -pR "$reconcile_target/$reconcile_state_name" "$reconcile_stage/$reconcile_state_name" || return 1
    else
      mkdir "$reconcile_stage/$reconcile_state_name" || return 1
    fi
  done
}

reconcile_paths_share_filesystem() {
  reconcile_left_device=$(df -P "$1" 2>/dev/null | awk 'NR == 2 { print $1; exit }') || return 1
  reconcile_right_device=$(df -P "$2" 2>/dev/null | awk 'NR == 2 { print $1; exit }') || return 1
  [ -n "$reconcile_left_device" ] && [ "$reconcile_left_device" = "$reconcile_right_device" ]
}

reconcile_create_work_path() {
  reconcile_work_parent=$1
  reconcile_work_name=$2
  reconcile_work_kind=$3
  reconcile_work_path=$(mktemp -d "$reconcile_work_parent/.${reconcile_work_name}.${reconcile_work_kind}.XXXXXX") || return 1
  rmdir "$reconcile_work_path" || return 1
  printf '%s\n' "$reconcile_work_path"
}

reconcile_remove_work_path() {
  reconcile_work_path=$1
  [ -n "$reconcile_work_path" ] || return 0
  case "$reconcile_work_path" in
    "${RECONCILE_RELEASE_TARGET%/*}"/."${RECONCILE_RELEASE_TARGET##*/}".stage.*|"${RECONCILE_RELEASE_TARGET%/*}"/."${RECONCILE_RELEASE_TARGET##*/}".old.*|"${RECONCILE_RELEASE_TARGET%/*}"/."${RECONCILE_RELEASE_TARGET##*/}".failed.*) ;;
    *) return 1 ;;
  esac
  [ ! -L "$reconcile_work_path" ] || return 1
  if [ -d "$reconcile_work_path" ]; then
    rm -rf -- "$reconcile_work_path"
  elif [ -e "$reconcile_work_path" ]; then
    rm -f -- "$reconcile_work_path"
  fi
}

reconcile_restore_old_tree() {
  if [ "$RECONCILE_RELEASE_OLD_IS_TREE" -eq 0 ] && [ "$RECONCILE_RELEASE_NEW_TREE_LIVE" -eq 0 ]; then
    reconcile_remove_work_path "$RECONCILE_RELEASE_OLD" || return 1
    RECONCILE_RELEASE_OLD=''
    RECONCILE_RELEASE_CUTOVER_PENDING=0
    return 0
  fi

  reconcile_restore_parent=${RECONCILE_RELEASE_TARGET%/*}
  reconcile_restore_name=${RECONCILE_RELEASE_TARGET##*/}
  reconcile_failed=$(reconcile_create_work_path "$reconcile_restore_parent" "$reconcile_restore_name" failed) || return 1

  if [ "$RECONCILE_RELEASE_NEW_TREE_LIVE" -eq 1 ]; then
    mv "$RECONCILE_RELEASE_TARGET" "$reconcile_failed" || {
      reconcile_remove_work_path "$reconcile_failed" || true
      return 1
    }
    RECONCILE_RELEASE_STAGE=$reconcile_failed
  else
    reconcile_remove_work_path "$reconcile_failed" || return 1
  fi

  if [ "$RECONCILE_RELEASE_OLD_IS_TREE" -eq 1 ]; then
    mv "$RECONCILE_RELEASE_OLD" "$RECONCILE_RELEASE_TARGET" || return 1
    RECONCILE_RELEASE_OLD=''
    RECONCILE_RELEASE_OLD_IS_TREE=0
  fi
  RECONCILE_RELEASE_NEW_TREE_LIVE=0
  RECONCILE_RELEASE_CUTOVER_PENDING=0
}

reconcile_restore_prior_service() {
  [ "$RECONCILE_RELEASE_SERVICE_WAS_ACTIVE" -eq 1 ] || return 0
  systemctl start subweb.service
}

reconcile_release_abort() {
  reconcile_abort_status=0
  if [ "$RECONCILE_RELEASE_CUTOVER_PENDING" -eq 1 ]; then
    reconcile_restore_old_tree || reconcile_abort_status=1
    if [ "$reconcile_abort_status" -eq 0 ]; then
      reconcile_restore_prior_service || reconcile_abort_status=1
    fi
  fi
  if [ "$reconcile_abort_status" -eq 0 ]; then
    reconcile_remove_work_path "$RECONCILE_RELEASE_STAGE" || reconcile_abort_status=1
    reconcile_remove_work_path "$RECONCILE_RELEASE_OLD" || reconcile_abort_status=1
    RECONCILE_RELEASE_STAGE=''
    RECONCILE_RELEASE_OLD=''
  fi
  return "$reconcile_abort_status"
}

reconcile_release_tree() {
  reconcile_source=$1
  reconcile_target=$2

  [ -d "$reconcile_source" ] && [ ! -L "$reconcile_source" ] || return 1
  reconcile_tree_is_safe "$reconcile_source" || return 1
  [ ! -L "$reconcile_target" ] || return 1
  if [ -e "$reconcile_target" ]; then
    reconcile_tree_is_safe "$reconcile_target" || return 1
  fi

  if release_trees_overlap "$reconcile_source" "$reconcile_target"; then
    return 1
  else
    reconcile_overlap_status=$?
    [ "$reconcile_overlap_status" -eq 1 ] || return 1
  fi
  reconcile_target_has_nested_mount "$reconcile_target" && return 1

  reconcile_target=$(reconcile_resolve_tree_path "$reconcile_target") || return 1
  reconcile_target_parent=${reconcile_target%/*}
  reconcile_target_name=${reconcile_target##*/}
  RECONCILE_RELEASE_TARGET=$reconcile_target
  RECONCILE_RELEASE_STAGE=$(mktemp -d "$reconcile_target_parent/.${reconcile_target_name}.stage.XXXXXX") || return 1

  reconcile_copy_selected_release "$reconcile_source" "$RECONCILE_RELEASE_STAGE" \
    && reconcile_copy_runtime_state "$reconcile_source" "$reconcile_target" "$RECONCILE_RELEASE_STAGE" \
    && reconcile_tree_is_safe "$RECONCILE_RELEASE_STAGE" \
    && reconcile_validate_runtime_state "$RECONCILE_RELEASE_STAGE" || {
      reconcile_release_abort || true
      return 1
    }

  if [ -e "$reconcile_target" ]; then
    reconcile_paths_share_filesystem "$reconcile_target" "$RECONCILE_RELEASE_STAGE" || {
      reconcile_release_abort || true
      return 1
    }
  else
    reconcile_paths_share_filesystem "$reconcile_target_parent" "$RECONCILE_RELEASE_STAGE" || {
      reconcile_release_abort || true
      return 1
    }
  fi

  RECONCILE_RELEASE_CUTOVER_PENDING=1
  if systemctl is-active --quiet subweb.service; then
    RECONCILE_RELEASE_SERVICE_WAS_ACTIVE=1
    systemctl stop subweb.service || {
      reconcile_release_abort || true
      return 1
    }
  fi

  if [ -e "$reconcile_target" ]; then
    RECONCILE_RELEASE_OLD=$(reconcile_create_work_path "$reconcile_target_parent" "$reconcile_target_name" old) || {
      reconcile_release_abort || true
      return 1
    }
    mv "$reconcile_target" "$RECONCILE_RELEASE_OLD" || {
      reconcile_release_abort || true
      return 1
    }
    RECONCILE_RELEASE_OLD_IS_TREE=1
  fi

  mv "$RECONCILE_RELEASE_STAGE" "$reconcile_target" || {
    reconcile_release_abort || true
    return 1
  }
  RECONCILE_RELEASE_STAGE=''
  RECONCILE_RELEASE_NEW_TREE_LIVE=1

  if [ "$RECONCILE_RELEASE_SERVICE_WAS_ACTIVE" -eq 1 ] && ! systemctl start subweb.service; then
    systemctl stop subweb.service || true
    reconcile_release_abort || true
    return 1
  fi

  reconcile_remove_work_path "$RECONCILE_RELEASE_OLD" || {
    reconcile_release_abort || true
    return 1
  }
  RECONCILE_RELEASE_OLD=''
  RECONCILE_RELEASE_OLD_IS_TREE=0
  RECONCILE_RELEASE_NEW_TREE_LIVE=0
  RECONCILE_RELEASE_CUTOVER_PENDING=0
  RECONCILE_RELEASE_SERVICE_WAS_ACTIVE=0
  RECONCILE_RELEASE_STAGE=''
}
