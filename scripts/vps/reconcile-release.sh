#!/bin/sh

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
  fi

  if [ -f "$reconcile_target/.env" ]; then
    rsync -a --delete --safe-links \
      -f 'P .env' \
      -f 'P .runtime/' \
      -f 'P .local/' \
      "$reconcile_source/" "$reconcile_target/"
  else
    rsync -a --delete --safe-links \
      -f 'P .runtime/' \
      -f 'P .local/' \
      "$reconcile_source/" "$reconcile_target/"
  fi

  if find "$reconcile_target" -type l -print -quit | grep -q .; then
    return 1
  fi
}
