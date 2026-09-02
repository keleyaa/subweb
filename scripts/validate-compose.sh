#!/bin/sh
set -eu

fail() {
  printf 'Compose validation error: %s\n' "$1" >&2
  exit 1
}

compose_file=${COMPOSE_VALIDATION_FILE:-compose.yaml}
validation_env_file=""
if [ ! -f .env ]; then
  validation_env_file=$(mktemp "${TMPDIR:-/tmp}/subweb-compose-validation.XXXXXX")
  chmod 600 "$validation_env_file"
  trap 'rm -f "$validation_env_file"' EXIT HUP INT TERM
  {
    printf '%s\n' \
      'APP_DOMAIN=app.validation.test' \
      'API_DOMAIN=api.validation.test' \
      'API_URL=https://api.validation.test' \
      'SHORT_DOMAIN=short.validation.test' \
      'SHORT_LINKS_ENABLED=true' \
      'CUSTOM_BACKEND_ENABLED=true' \
      'REDIS_PASSWORD=compose-validation-redis-password' \
      'IP_HASH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' \
      'TURNSTILE_SITE_KEY=compose-validation-site-key' \
      'TURNSTILE_SECRET_KEY=compose-validation-secret-key'
  } > "$validation_env_file"
fi

compose_config() {
  if [ -n "$validation_env_file" ]; then
    docker compose -f "$compose_file" --env-file "$validation_env_file" "$@"
  else
    docker compose -f "$compose_file" "$@"
  fi
}

compose_config config --quiet
compose_json=$(compose_config config --format json)
short_links_enabled=${SHORT_LINKS_ENABLED:-true}

COMPOSE_JSON=$compose_json node - "$short_links_enabled" <<'NODE'
let config;
try { config = JSON.parse(process.env.COMPOSE_JSON ?? ""); } catch { console.error("Compose validation error: invalid JSON."); process.exit(1); }
{
  const enabled = process.argv[2] !== "false";
  const services = config.services ?? {};
  const expected = enabled
    ? ["gateway", "myurls-app", "myurls-short", "redis", "subconverter"]
    : ["gateway", "subconverter"];
  const actual = Object.keys(services).sort();
  if (actual.join("\n") !== expected.slice().sort().join("\n")) {
    console.error(`Compose validation error: expected services ${expected.join(", ")}.`);
    process.exitCode = 1;
  }
  const hasPorts = (service) => Array.isArray(service?.ports) && service.ports.length > 0;
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
        "myurls-app": ["myurls-data", "myurls-edge"],
        "myurls-short": ["myurls-data", "myurls-edge"],
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
  if (enabled && services.gateway?.environment?.EGRESS_LISTEN_ADDR !== "0.0.0.0:25502") {
    console.error("Compose validation error: gateway egress listener contract is missing.");
    process.exitCode = 1;
  }
  if (enabled && services.subconverter?.environment?.HTTPS_PROXY !== "http://gateway:25502") {
    console.error("Compose validation error: SubConverter must use the Gateway egress proxy.");
    process.exitCode = 1;
  }
}
NODE

printf 'Unified Compose deployment, network, and published-port contracts are valid.\n'
