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

backup_mount_is_distinct() {
  backup_mount_path=$1
  while [ "$backup_mount_path" != / ] && [ "${backup_mount_path%/}" != "$backup_mount_path" ]; do
    backup_mount_path=${backup_mount_path%/}
  done
  [ "$backup_mount_path" != / ] || return 1
  backup_mount_target=$(findmnt -rn --mountpoint "$backup_mount_path" -o TARGET 2>/dev/null) || return 1
  [ "$backup_mount_target" = "$backup_mount_path" ]
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
  case "$1" in
    *'/../'*|*/..|*'/./'*|*/.) return 1 ;;
  esac
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
