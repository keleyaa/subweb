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
  else
    mkdir -p "$reconcile_target" || return 1
  fi

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
}
