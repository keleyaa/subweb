#!/bin/sh
set -eu

base_path=${SUBCONVERTER_BASE_PATH:-/base}

# Docker copies the image's root-owned /base tree into a new named volume.
# Bootstrap its directory once, then run the actual converter process as UID 101.
if [ "${SUBWEB_PRIVILEGE_DROPPED:-}" != "1" ]; then
  [ "$(id -u)" = "0" ] || {
    printf '%s\n' 'SubConverter bootstrap requires root before dropping privileges.' >&2
    exit 1
  }
  chown 101:101 "$base_path"
  exec su -s /bin/sh -c 'exec env SUBWEB_PRIVILEGE_DROPPED=1 /bin/sh /usr/local/bin/subweb-subconverter-entrypoint' subweb
fi

pref_path=${PREF_PATH:-$base_path/pref.subweb.toml}
temporary_pref="$pref_path.tmp.$$"
trap 'rm -f "$temporary_pref"' EXIT HUP INT TERM

[ -f "$base_path/pref.example.toml" ] || {
  printf '%s\n' 'SubConverter bundled preference template is missing' >&2
  exit 1
}

# Always derive a fresh privacy policy so an old named volume cannot re-enable
# verbose request logging. The rest of the upstream defaults remain intact.
sed -E \
  -e 's/^[[:space:]]*log_level[[:space:]]*=.*/log_level = "warn"/' \
  -e 's/^[[:space:]]*print_debug_info[[:space:]]*=.*/print_debug_info = false/' \
  -e 's|^[[:space:]]*default_external_config[[:space:]]*=.*|default_external_config = "config/example_external_config.ini"|' \
  "$base_path/pref.example.toml" > "$temporary_pref"
chmod 0600 "$temporary_pref"
mv -f "$temporary_pref" "$pref_path"
trap - EXIT HUP INT TERM

export PREF_PATH=$pref_path
export SUBWEB_LOG_RUNTIME_DIR=${SUBWEB_LOG_RUNTIME_DIR:-/run/subconverter}
export SUBWEB_LOG_FILTER=${SUBWEB_LOG_FILTER:-/usr/local/bin/subweb-log-filter.awk}
exec /usr/local/bin/subweb-log-supervisor /usr/local/bin/start-subconverter
