#!/bin/sh

backup_path_is_supported() {
  case "$1" in
    /var/lib/subweb-backups|/var/lib/subweb-backups/*|/mnt/subweb-backups|/mnt/subweb-backups/*)
      case "$1" in
        *'/../'*|*/..|*'/./'*|*/.) return 1 ;;
        *) return 0 ;;
      esac
      ;;
    *) return 1 ;;
  esac
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
