#!/bin/sh
set -eu

fail() {
  printf 'Compose validation error: %s\n' "$1" >&2
  exit 1
}

script_directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
. "$script_directory/lib/path-lock.sh"

validation_env_file=
validation_source_env_file=
validation_version_lock_snapshot=
validation_env_lock_directory=
validation_env_lock_owned=0
validation_version_lock_directory=
validation_version_lock_owned=0
cleanup() {
  [ -z "$validation_env_file" ] || rm -f "$validation_env_file"
  [ -z "$validation_source_env_file" ] || rm -f "$validation_source_env_file"
  [ -z "$validation_version_lock_snapshot" ] || rm -f "$validation_version_lock_snapshot"
  if [ "$validation_version_lock_owned" -eq 1 ]; then
    release_path_lock "$validation_version_lock_directory" || true
  fi
  if [ "$validation_env_lock_owned" -eq 1 ]; then
    release_path_lock "$validation_env_lock_directory" || true
  fi
}
trap cleanup 0
trap 'cleanup; exit 1' HUP INT TERM

source_env_file=
if [ "${SUBWEB_ENV_FILE+x}" = x ]; then
  source_env_file=$SUBWEB_ENV_FILE
  [ -n "$source_env_file" ] || fail 'SUBWEB_ENV_FILE must not be empty when explicitly set.'
  case "$source_env_file" in
    /*) ;;
    *)
      source_directory=$(CDPATH='' cd -- "$(dirname -- "$source_env_file")" && pwd -P) \
        || fail 'SUBWEB_ENV_FILE parent directory is unavailable.'
      source_env_file=$source_directory/$(basename -- "$source_env_file")
      ;;
  esac
elif [ -e .env ]; then
  source_env_file=$(pwd -P)/.env
fi

version_lock_file=${VERSION_LOCK_FILE:-$script_directory/../deploy/versions.lock.json}
if [ "${SUBWEB_ENV_LOCK_HELD:-0}" != 1 ] && [ -n "$source_env_file" ]; then
  acquire_path_lock "$source_env_file" || fail 'could not lock the Compose environment.'
  validation_env_lock_directory=$PATH_LOCK_DIRECTORY
  validation_env_lock_owned=1
elif [ -n "$source_env_file" ]; then
  validation_env_lock_target=${SUBWEB_ENV_LOCK_TARGET:-$source_env_file}
  expected_env_lock_directory=$(path_lock_directory_for_target "$validation_env_lock_target") \
    || fail 'invalid Compose environment lock handoff.'
  [ "${SUBWEB_ENV_LOCK_DIRECTORY:-}" = "$expected_env_lock_directory" ] \
    || fail 'invalid Compose environment lock handoff.'
  validate_path_lock_handoff "$SUBWEB_ENV_LOCK_DIRECTORY" "${SUBWEB_ENV_LOCK_TOKEN:-}" \
    || fail 'invalid Compose environment lock handoff.'
fi
if [ "${SUBWEB_VERSION_LOCK_HELD:-0}" != 1 ]; then
  acquire_path_lock "$version_lock_file" || fail 'could not lock deploy/versions.lock.json.'
  validation_version_lock_directory=$PATH_LOCK_DIRECTORY
  validation_version_lock_owned=1
else
  expected_version_lock_directory=$(path_lock_directory_for_target "$version_lock_file") \
    || fail 'invalid version lock handoff.'
  [ "${SUBWEB_VERSION_LOCK_DIRECTORY:-}" = "$expected_version_lock_directory" ] \
    || fail 'invalid version lock handoff.'
  validate_path_lock_handoff "$SUBWEB_VERSION_LOCK_DIRECTORY" "${SUBWEB_VERSION_LOCK_TOKEN:-}" \
    || fail 'invalid version lock handoff.'
fi

[ -f "$version_lock_file" ] && [ ! -L "$version_lock_file" ] \
  || fail "version lock file must be a regular, non-symlink file: $version_lock_file"
if [ -n "$source_env_file" ]; then
  [ -f "$source_env_file" ] && [ ! -L "$source_env_file" ] \
    || fail 'SUBWEB_ENV_FILE must be a regular, non-symlink file.'
fi

validation_file_identity() {
  if validation_identity=$(stat -Lc '%d:%i' "$1" 2>/dev/null); then
    case "$validation_identity" in *[!0-9:]*|*::*|:*) return 1 ;; esac
  else
    validation_identity=$(stat -Lf '%i' "$1") || return 1
    case "$validation_identity" in *[!0-9]*|'') return 1 ;; esac
  fi
  printf '%s\n' "$validation_identity"
}

version_lock_identity=$(validation_file_identity "$version_lock_file") \
  || fail 'could not identify deploy/versions.lock.json.'
exec 8< "$version_lock_file" || fail 'could not open deploy/versions.lock.json.'
[ "$(validation_file_identity /dev/fd/8)" = "$version_lock_identity" ] \
  || fail 'deploy/versions.lock.json changed before it could be opened.'

validation_version_lock_snapshot=$(mktemp "${TMPDIR:-/tmp}/subweb-version-lock.XXXXXX") \
  || fail 'could not create a version lock snapshot.'
chmod 600 "$validation_version_lock_snapshot" \
  || fail 'could not protect the version lock snapshot.'
cat <&8 > "$validation_version_lock_snapshot" \
  || fail 'could not snapshot deploy/versions.lock.json.'
cmp -s "$validation_version_lock_snapshot" "$version_lock_file" \
  || fail 'deploy/versions.lock.json changed while it was being snapshotted.'
exec 8<&-
[ "$(validation_file_identity "$version_lock_file")" = "$version_lock_identity" ] \
  || fail 'deploy/versions.lock.json changed while it was being snapshotted.'
version_lock_file=$validation_version_lock_snapshot

if [ -n "$source_env_file" ]; then
  validation_source_env_file=$(mktemp "${TMPDIR:-/tmp}/subweb-compose-source.XXXXXX") \
    || fail 'could not create a Compose environment snapshot.'
  chmod 600 "$validation_source_env_file" \
    || fail 'could not protect the Compose environment snapshot.'
  source_env_identity=$(validation_file_identity "$source_env_file") \
    || fail 'could not identify the Compose environment.'
  exec 9< "$source_env_file" || fail 'could not open the Compose environment.'
  [ "$(validation_file_identity /dev/fd/9)" = "$source_env_identity" ] \
    || fail 'Compose environment changed before it could be opened.'
  cat <&9 > "$validation_source_env_file" \
    || fail 'could not snapshot the Compose environment.'
  cmp -s "$validation_source_env_file" "$source_env_file" \
    || fail 'Compose environment changed while it was being snapshotted.'
  exec 9<&-
  [ "$(validation_file_identity "$source_env_file")" = "$source_env_identity" ] \
    || fail 'Compose environment changed while it was being snapshotted.'
  source_env_file=$validation_source_env_file
fi

compose_file=${COMPOSE_VALIDATION_FILE:-}
if [ -z "$compose_file" ]; then
  compose_file=compose.yaml
  if [ -n "$source_env_file" ]; then
    if short_links_enabled=$(awk -F= '$1 == "SHORT_LINKS_ENABLED" { count += 1; value = $2 } END { if (count == 1) print value; else exit (count > 1 ? 2 : 1) }' "$source_env_file"); then
      :
    else
      fail 'selected environment must contain exactly one SHORT_LINKS_ENABLED value.'
    fi
    case "$short_links_enabled" in
      true) ;;
      false) compose_file=compose.disabled-short-links.yaml ;;
      *) fail 'SHORT_LINKS_ENABLED must be true or false.' ;;
    esac
  fi
fi
runtime_image_env=$(node "$script_directory/runtime-image-contract.mjs" env --lock "$version_lock_file") \
  || fail "could not derive external runtime images from $version_lock_file"
for name in REDIS_IMAGE SUBCONVERTER_IMAGE MYURLS_IMAGE; do
  printf '%s\n' "$runtime_image_env" | grep -q "^$name=" \
    || fail 'runtime image contract is incomplete.'
done

validation_env_file=$(mktemp "${TMPDIR:-/tmp}/subweb-compose-validation.XXXXXX") \
  || fail 'could not create a Compose validation environment.'
chmod 600 "$validation_env_file" || fail 'could not protect a Compose validation environment.'

if [ -n "$source_env_file" ]; then
  redis_image=$(printf '%s\n' "$runtime_image_env" | sed -n 's/^REDIS_IMAGE=//p')
  subconverter_image=$(printf '%s\n' "$runtime_image_env" | sed -n 's/^SUBCONVERTER_IMAGE=//p')
  myurls_image=$(printf '%s\n' "$runtime_image_env" | sed -n 's/^MYURLS_IMAGE=//p')
  awk \
    -v "redis_image=$redis_image" \
    -v "subconverter_image=$subconverter_image" \
    -v "myurls_image=$myurls_image" '
      BEGIN {
        expected["REDIS_IMAGE"] = "REDIS_IMAGE=" redis_image
        expected["SUBCONVERTER_IMAGE"] = "SUBCONVERTER_IMAGE=" subconverter_image
        expected["MYURLS_IMAGE"] = "MYURLS_IMAGE=" myurls_image
      }
      /^[[:space:]]*(export[[:space:]]+)?(REDIS_IMAGE|SUBCONVERTER_IMAGE|MYURLS_IMAGE)[[:space:]]*=/ {
        name = $0
        sub(/^[[:space:]]*(export[[:space:]]+)?/, "", name)
        sub(/[[:space:]]*=.*/, "", name)
        gsub(/[[:space:]]/, "", name)
        if ($0 != expected[name] || ++seen[name] > 1) exit 1
        next
      }
      { print }
    ' "$source_env_file" > "$validation_env_file" \
    || fail 'Compose environment must not define managed runtime image variables.'
else
  validation_ip_hash_secret=$(printf '%064d' 0)
  {
    printf '%s\n' \
      'APP_DOMAIN=app.validation.test' \
      'API_DOMAIN=api.validation.test' \
      'API_URL=https://api.validation.test' \
      'SHORT_DOMAIN=short.validation.test' \
      'SHORT_LINKS_ENABLED=true' \
      'CUSTOM_BACKEND_ENABLED=true' \
       'REDIS_PASSWORD=compose-validation-redis-password' \
       "IP_HASH_SECRET=$validation_ip_hash_secret" \
       'TURNSTILE_SITE_KEY=compose-validation-site-key' \
      'TURNSTILE_SECRET_KEY=compose-validation-secret-key'
  } > "$validation_env_file"
fi

printf '%s\n' "$runtime_image_env" >> "$validation_env_file" \
  || fail 'could not write locked runtime images to Compose validation environment.'

compose_config() (
  env -i \
    PATH="$PATH" \
    HOME="${HOME-}" \
    TMPDIR="${TMPDIR-}" \
    DOCKER_API_VERSION="${DOCKER_API_VERSION-}" \
    DOCKER_CERT_PATH="${DOCKER_CERT_PATH-}" \
    DOCKER_CONFIG="${DOCKER_CONFIG-}" \
    DOCKER_CONTEXT="${DOCKER_CONTEXT-}" \
    DOCKER_HOST="${DOCKER_HOST-}" \
    DOCKER_TLS="${DOCKER_TLS-}" \
    DOCKER_TLS_VERIFY="${DOCKER_TLS_VERIFY-}" \
    SSH_AUTH_SOCK="${SSH_AUTH_SOCK-}" \
    docker compose -f "$compose_file" --env-file "$validation_env_file" "$@"
)

compose_config config --quiet
compose_json=$(compose_config config --format json)

COMPOSE_JSON=$compose_json VERSION_LOCK_FILE=$version_lock_file node <<'NODE'
const fs = require("node:fs");
let config;
let lock;
try { config = JSON.parse(process.env.COMPOSE_JSON ?? ""); } catch { console.error("Compose validation error: invalid JSON."); process.exit(1); }
try { lock = JSON.parse(fs.readFileSync(process.env.VERSION_LOCK_FILE, "utf8")); } catch { console.error("Compose validation error: invalid version lock file."); process.exit(1); }
{
  const services = config.services ?? {};
  const shortLinksEnabled = services.gateway?.environment?.SHORT_LINKS_ENABLED;
  if (shortLinksEnabled !== "true" && shortLinksEnabled !== "false") {
    console.error("Compose validation error: gateway must set SHORT_LINKS_ENABLED to true or false.");
    process.exit(1);
  }
  const enabled = shortLinksEnabled === "true";
  const gatewayImage = services.gateway?.image;
  const immutableGatewayImage = (image) =>
    image === "subweb:local" || /@sha256:[0-9a-f]{64}$/u.test(String(image));
  if (!immutableGatewayImage(gatewayImage)) {
    console.error("Compose validation error: gateway must use subweb:local or an immutable sha256 image.");
    process.exitCode = 1;
  }
  const expected = enabled
    ? ["gateway", "myurls", "redis", "subconverter"]
    : ["gateway", "subconverter"];
  if (enabled) {
    const gateway = services.gateway?.environment ?? {};
    const myurls = services.myurls?.environment ?? {};
    if (!gateway.APP_DOMAIN || !gateway.SHORT_DOMAIN || gateway.APP_DOMAIN === gateway.SHORT_DOMAIN ||
        gateway.MYURLS_UPSTREAM !== "http://myurls-edge:3000" ||
        myurls.NODE_ENV !== "production" ||
        myurls.PUBLIC_BASE_URL !== `https://${gateway.SHORT_DOMAIN}` ||
        myurls.TURNSTILE_HOSTNAME !== gateway.APP_DOMAIN ||
        myurls.TURNSTILE_ENABLED !== "true" || myurls.TURNSTILE_MODE !== "cloudflare" ||
        !myurls.TURNSTILE_SITE_KEY || !myurls.TURNSTILE_SECRET_KEY) {
      console.error("Compose validation error: single MyUrls must use the SHORT base URL and APP production Turnstile contract.");
      process.exitCode = 1;
    }
  }
  const actual = Object.keys(services).sort();
  if (actual.join("\n") !== expected.slice().sort().join("\n")) {
    console.error(`Compose validation error: expected services ${expected.join(", ")}.`);
    process.exitCode = 1;
  }
  if (services.gateway?.depends_on?.subconverter) {
    console.error("Compose validation error: gateway must not wait for SubConverter; SubConverter uses the Gateway egress proxy.");
    process.exitCode = 1;
  }
  if (services.subconverter?.depends_on?.gateway?.condition !== "service_healthy") {
    console.error("Compose validation error: SubConverter must wait for a healthy Gateway egress proxy.");
    process.exitCode = 1;
  }
  const hasPorts = (service) => Array.isArray(service?.ports) && service.ports.length > 0;
  const expectedImage = (name) => {
    const image = lock.services?.[name]?.image;
    return image?.reference && image?.digest ? `${image.reference}@${image.digest}` : null;
  };
  for (const name of (enabled ? ["redis", 'myurls', "subconverter"] : ["subconverter"])) {
    if (services[name]?.image !== expectedImage(name)) {
      console.error(`Compose validation error: service ${name} must use its locked image.`);
      process.exitCode = 1;
    }
  }
  const published = Object.entries(services).filter(([, service]) => hasPorts(service));
  if (published.length !== 1 || published[0][0] !== "gateway") {
    console.error("Compose validation error: only gateway may publish ports.");
    process.exitCode = 1;
  }
  const gatewayPort = services.gateway?.ports?.length === 1 ? services.gateway.ports[0] : null;
  const validPort = (value) => /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 65535;
  if (!gatewayPort || gatewayPort.host_ip !== "127.0.0.1" || gatewayPort.target !== 8080 || !validPort(gatewayPort.published)) {
    console.error("Compose validation error: gateway must publish container port 8080 on host loopback.");
    process.exitCode = 1;
  }
  for (const [name, service] of Object.entries(services)) {
    const bootstrapCapabilities = [...(service?.cap_add ?? [])].sort();
    const isSubconverterBootstrap = name === "subconverter"
      && String(service?.user ?? "") === "0:0"
      && JSON.stringify(bootstrapCapabilities) === JSON.stringify(["CHOWN", "SETGID", "SETUID"]);
    if (!isSubconverterBootstrap && (service?.user === undefined || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(String(service.user)))) {
      console.error(`Compose validation error: service ${name} must run as a non-root user.`);
      process.exitCode = 1;
    }
    if (bootstrapCapabilities.length > 0 && !isSubconverterBootstrap) {
      console.error(`Compose validation error: service ${name} has unapproved capabilities.`);
      process.exitCode = 1;
    }
    if (service?.read_only !== true || !service.cap_drop?.includes("ALL") || !service.security_opt?.includes("no-new-privileges:true")) {
      console.error(`Compose validation error: service ${name} is missing runtime security defaults.`);
      process.exitCode = 1;
    }
    if (name !== "gateway" && hasPorts(service)) {
      console.error(`Compose validation error: internal service ${name} must not publish ports.`);
      process.exitCode = 1;
    }
  }
  const expectedNetworks = enabled
    ? {
        gateway: ["default", "myurls-edge", "redis-policy", "subconverter-egress"],
        redis: ["myurls-data", "redis-policy"],
        "myurls": ["myurls-data", "myurls-edge"],
        subconverter: ["subconverter-egress"],
      }
    : { gateway: ["default", "subconverter-egress"], subconverter: ["subconverter-egress"] };
  for (const [name, expectedNames] of Object.entries(expectedNetworks)) {
    const actualNames = Object.keys(services[name]?.networks ?? {}).sort();
    if (actualNames.join("\n") !== expectedNames.slice().sort().join("\n")) {
      console.error(`Compose validation error: service ${name} has unexpected networks.`);
      process.exitCode = 1;
    }
  }
  for (const name of ["myurls-data", "myurls-edge", "redis-policy", "subconverter-egress"]) {
    const shouldExist = enabled || name === "subconverter-egress";
    if (shouldExist && config.networks?.[name]?.internal !== true) {
      console.error(`Compose validation error: network ${name} must be internal.`);
      process.exitCode = 1;
    }
    if (!shouldExist && Object.hasOwn(config.networks ?? {}, name)) {
      console.error(`Compose validation error: network ${name} must be absent when short links are disabled.`);
      process.exitCode = 1;
    }
  }
  if (services.gateway?.environment?.EGRESS_LISTEN_ADDR !== "0.0.0.0:25502") {
    console.error("Compose validation error: gateway egress listener contract is missing.");
    process.exitCode = 1;
  }
  if (enabled && services.subconverter?.environment?.HTTPS_PROXY !== "http://gateway:25502") {
    console.error("Compose validation error: SubConverter must use the Gateway egress proxy.");
    process.exitCode = 1;
  }
  if (enabled && services.gateway?.environment?.EGRESS_RESTRICTED_LISTEN_ADDR !== "0.0.0.0:25503") {
    console.error("Compose validation error: gateway restricted egress listener contract is missing.");
    process.exitCode = 1;
  }
  const restrictedHosts = String(services.gateway?.environment?.EGRESS_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  if (enabled && !restrictedHosts.includes("challenges.cloudflare.com")) {
    console.error("Compose validation error: the restricted egress allowlist must contain challenges.cloudflare.com for MyUrls Turnstile verification.");
    process.exitCode = 1;
  }
  if (enabled && services.myurls?.environment?.HTTPS_PROXY !== "http://gateway:25503") {
    console.error("Compose validation error: MyUrls must use the host-allowlisted Gateway egress proxy.");
    process.exitCode = 1;
  }
}
NODE

printf 'Unified Compose deployment, network, and published-port contracts are valid.\n'
