#!/bin/sh

backup_path_has_symlink_component() {
  backup_root=$1
  backup_path=$2
  backup_candidate=$backup_root
  backup_relative=${backup_path#"$backup_root"}

  [ ! -L "$backup_root" ] || return 0
  while [ -n "$backup_relative" ]; do
    backup_relative=${backup_relative#/}
    [ -n "$backup_relative" ] || break
    case "$backup_relative" in
      */*)
        backup_component=${backup_relative%%/*}
        backup_relative=${backup_relative#*/}
        ;;
      *)
        backup_component=$backup_relative
        backup_relative=
        ;;
    esac
    [ -n "$backup_component" ] || continue
    backup_candidate=$backup_candidate/$backup_component
    [ ! -L "$backup_candidate" ] || return 0
  done
  return 1
}

backup_path_without_trailing_slashes() {
  backup_normalized_path=$1
  while [ "$backup_normalized_path" != / ] \
    && [ "${backup_normalized_path%/}" != "$backup_normalized_path" ]; do
    backup_normalized_path=${backup_normalized_path%/}
  done
  printf '%s\n' "$backup_normalized_path"
}

backup_path_has_navigation_component() {
  case "$1" in
    *'/../'*|*/..|*'/./'*|*/.) return 0 ;;
    *) return 1 ;;
  esac
}

backup_canonical_child_path() {
  backup_root=$1
  backup_path=$2
  backup_path_is_within "$backup_root" "$backup_path" || return 1
  backup_path_has_navigation_component "$backup_path" && return 1
  backup_path_has_symlink_component "$backup_root" "$backup_path" && return 1

  backup_name=${backup_path##*/}
  backup_parent=${backup_path%/*}
  [ -n "$backup_name" ] && [ -n "$backup_parent" ] || return 1
  backup_canonical_root=$(CDPATH='' cd -- "$backup_root" && pwd -P) || return 1
  backup_canonical_parent=$(CDPATH='' cd -- "$backup_parent" && pwd -P) || return 1
  backup_canonical_path=$backup_canonical_parent/$backup_name
  backup_path_is_within "$backup_canonical_root" "$backup_canonical_path" || return 1
  printf '%s\n' "$backup_canonical_path"
}

backup_mount_is_distinct() {
  backup_mount_path=$(backup_path_without_trailing_slashes "$1") || return 1
  [ "$backup_mount_path" != / ] || return 1
  backup_mount_target=$(findmnt -rn --mountpoint "$backup_mount_path" -o TARGET 2>/dev/null) || return 1
  [ "$backup_mount_target" = "$backup_mount_path" ]
}

backup_mount_identity() {
  backup_mount_path=$(backup_path_without_trailing_slashes "$1") || return 1
  [ "$backup_mount_path" != / ] || return 1
  backup_mount_source=$(findmnt -rn --mountpoint "$backup_mount_path" -o SOURCE 2>/dev/null) || return 1
  backup_mount_fstype=$(findmnt -rn --mountpoint "$backup_mount_path" -o FSTYPE 2>/dev/null) || return 1
  backup_mount_device=$(findmnt -rn --mountpoint "$backup_mount_path" -o MAJ:MIN 2>/dev/null) || return 1
  [ -n "$backup_mount_source" ] && [ -n "$backup_mount_fstype" ] && [ -n "$backup_mount_device" ] || return 1
  printf '%s|%s|%s\n' "$backup_mount_source" "$backup_mount_fstype" "$backup_mount_device"
}

backup_hold_mount() {
  backup_mount_path=$(backup_path_without_trailing_slashes "$1") || return 1
  [ -d "$backup_mount_path" ] || return 1
  exec 8<"$backup_mount_path" || return 1
}

backup_path_is_within() {
  backup_parent_path=$(backup_path_without_trailing_slashes "$1") || return 1
  backup_child_path=$(backup_path_without_trailing_slashes "$2") || return 1
  case "$backup_child_path" in
    "$backup_parent_path"|"$backup_parent_path"/*) return 0 ;;
    *) return 1 ;;
  esac
}

backup_path_is_supported() {
  case "$1" in
    /var/lib/subweb-backups|/var/lib/subweb-backups/*)
      backup_root=/var/lib/subweb-backups
      ;;
    /mnt/subweb-backups|/mnt/subweb-backups/*)
      backup_root=/mnt/subweb-backups
      ;;
    *) return 1 ;;
  esac
  backup_path_has_navigation_component "$1" && return 1
  backup_path_has_symlink_component "$backup_root" "$1" && return 1
  return 0
}

require_supported_backup_path() {
  path_label=$1
  path_value=$2
  case "$path_value" in
    /*) ;;
    *) fail "$path_label must be an absolute path under a systemd ReadWritePaths entry." ;;
  esac
  backup_path_is_supported "$path_value" \
    || fail "$path_label must be under a systemd ReadWritePaths entry."
}
