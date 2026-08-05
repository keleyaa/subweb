#!/bin/sh
set -eu

pref_path=/base/pref.subweb.toml
temporary_pref="$pref_path.tmp.$$"
trap 'rm -f "$temporary_pref"' EXIT HUP INT TERM

[ -f /base/pref.example.toml ] || {
  printf '%s\n' 'SubConverter bundled preference template is missing' >&2
  exit 1
}

# Always derive a fresh privacy policy so an old named volume cannot re-enable
# verbose request logging. The rest of the upstream defaults remain intact.
sed -E \
  -e 's/^[[:space:]]*log_level[[:space:]]*=.*/log_level = "warn"/' \
  -e 's/^[[:space:]]*print_debug_info[[:space:]]*=.*/print_debug_info = false/' \
  /base/pref.example.toml > "$temporary_pref"
chmod 0600 "$temporary_pref"
mv -f "$temporary_pref" "$pref_path"
trap - EXIT HUP INT TERM

export PREF_PATH=$pref_path
export SUBWEB_LOG_RUNTIME_DIR=/run/subconverter
export SUBWEB_LOG_FILTER=/usr/local/bin/subweb-log-filter.awk
exec /usr/local/bin/subweb-log-supervisor /usr/local/bin/start-subconverter
