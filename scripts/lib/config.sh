#!/bin/sh

validate_domain() {
  domain=${1-}

  [ -n "$domain" ] || return 1
  [ "${#domain}" -le 253 ] || return 1
  case "$domain" in
    *[!A-Za-z0-9.-]* | .* | *. | *..*) return 1 ;;
  esac

  old_ifs=$IFS
  IFS=.
  set -- $domain
  IFS=$old_ifs
  [ "$#" -ge 2 ] || return 1

  for label do
    [ -n "$label" ] || return 1
    [ "${#label}" -le 63 ] || return 1
    case "$label" in
      -* | *-) return 1 ;;
    esac
  done
}

validate_ipv4() {
  address=${1-}

  printf '%s\n' "$address" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || return 1
  old_ifs=$IFS
  IFS=.
  set -- $address
  IFS=$old_ifs
  [ "$#" -eq 4 ] || return 1

  for octet do
    [ -n "$octet" ] && [ "$octet" -ge 0 ] 2>/dev/null && [ "$octet" -le 255 ] \
      || return 1
  done
}

validate_ipv4_cidr() {
  cidr=${1-}

  printf '%s\n' "$cidr" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$' \
    || return 1
  [ "$cidr" != '0.0.0.0/0' ] || return 1
  validate_ipv4 "${cidr%/*}"
}

validate_container_image() {
  image=${1-}
  [ -n "$image" ] || return 1
  [ "${#image}" -le 512 ] || return 1
  case "$image" in
    *[!A-Za-z0-9._/@:+-]* | -* | */ | *:) return 1 ;;
  esac
  # digest references take precedence: the bare tag branch below would
  # otherwise swallow repo/image@sha256:... without validating the digest.
  case "$image" in
    */*@sha256:*)
      digest=${image##*@sha256:}
      case "$digest" in
        ''|*[!0-9a-f]*) return 1 ;;
      esac
      [ "${#digest}" -eq 64 ] || return 1
      ;;
    */*:*)
      tag=${image##*:}
      case "$tag" in ''|*[!A-Za-z0-9_.-]*) return 1 ;; esac
      ;;
    *) return 1 ;;
  esac
}

load_existing_image() {
  image_file=${1-}
  image_key=${2-}
  [ -f "$image_file" ] || return 1
  [ -n "$image_key" ] || return 2

  image_value=$(awk -v key="$image_key" 'index($0, key "=") == 1 { count += 1; value = substr($0, length(key) + 2) } END { if (count == 1) print value; else if (count > 1) exit 2; else exit 1 }' "$image_file")
  image_status=$?
  [ "$image_status" -eq 0 ] || return "$image_status"
  validate_container_image "$image_value" || return 2
  printf '%s\n' "$image_value"
}

load_existing_secret() {
  secret_file=${1-}
  secret_key=${2-}
  [ -f "$secret_file" ] || return 1

  secret_lines=$(awk -v key="$secret_key" 'index($0, key "=") == 1 { count += 1; value = substr($0, length(key) + 2) } END { if (count == 1) print value; else if (count > 1) exit 2; else exit 1 }' "$secret_file")
  secret_status=$?
  [ "$secret_status" -eq 0 ] || return 2
  printf '%s\n' "$secret_lines" | LC_ALL=C grep -Eq '^[0-9a-f]{64}$' || return 2
  printf '%s\n' "$secret_lines"
}

load_existing_optional_value() {
  value_file=${1-}
  value_key=${2-}
  [ -f "$value_file" ] || return 1
  [ -n "$value_key" ] || return 2

  awk -v key="$value_key" 'index($0, key "=") == 1 { count += 1; value = substr($0, length(key) + 2) } END { if (count == 1) print value; else if (count > 1) exit 2; else exit 1 }' "$value_file"
}

generate_hex_secret() {
  generated_secret=$(openssl rand -hex 32 2>/dev/null) || return 1
  printf '%s\n' "$generated_secret" | LC_ALL=C grep -Eq '^[0-9a-f]{64}$' || return 1
  printf '%s\n' "$generated_secret"
}

write_env_atomically() {
  target_file=${1-}
  [ ! -d "$target_file" ] || return 1
  target_directory=$(dirname "$target_file")
  target_name=$(basename "$target_file")
  CONFIG_TEMP_FILE=$(mktemp "$target_directory/$target_name.tmp.XXXXXX") || return 1
  temp_basename=$(basename "$CONFIG_TEMP_FILE")

  if ! cat > "$CONFIG_TEMP_FILE"; then
    rm -f "$CONFIG_TEMP_FILE"
    CONFIG_TEMP_FILE=
    return 1
  fi
  chmod 600 "$CONFIG_TEMP_FILE" || {
    rm -f "$CONFIG_TEMP_FILE"
    CONFIG_TEMP_FILE=
    return 1
  }
  mv -f "$CONFIG_TEMP_FILE" "$target_file" || {
    rm -f "$CONFIG_TEMP_FILE"
    CONFIG_TEMP_FILE=
    return 1
  }
  CONFIG_TEMP_FILE=

  # The atomic rename already succeeded; only a concurrent directory swap can
  # still lose the file, so keep that as a hard failure and downgrade any
  # other post-write verification mismatch to a warning to avoid the
  # "written but reported failed" in-between state.
  if [ -d "$target_file" ]; then
    CONFIG_MOVED_FILE=$target_file/$temp_basename
    rm -f "$CONFIG_MOVED_FILE"
    CONFIG_MOVED_FILE=
    return 1
  fi
  target_permissions=$(LC_ALL=C ls -ld "$target_file" 2>/dev/null | awk '{ print substr($1, 1, 10) }')
  if [ ! -f "$target_file" ] || [ -L "$target_file" ] || [ "$target_permissions" != '-rw-------' ]; then
    printf 'Warning: written file failed post-write verification: %s\n' "$target_file" >&2
  fi
}
