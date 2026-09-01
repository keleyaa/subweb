#!/bin/sh
set -eu

fail() {
  printf 'Compose validation error: %s\n' "$1" >&2
  exit 1
}

expectedGateway=subweb
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
      'REDIS_PASSWORD=compose-validation-redis-password' \
      'IP_HASH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' \
      'TURNSTILE_SITE_KEY=compose-validation-site-key' \
      'TURNSTILE_SECRET_KEY=compose-validation-secret-key'
  } > "$validation_env_file"
fi

compose_config() {
  if [ -n "$validation_env_file" ]; then
    docker compose --env-file "$validation_env_file" "$@"
  else
    docker compose "$@"
  fi
}

compose_config config --quiet
compose_json=$(compose_config config --format json)
printf '%s\n' "$compose_json" | node -e '
let input = "";
const expectedGateway = process.argv[1];
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let config;
  try { config = JSON.parse(input); } catch { console.error("Compose validation error: invalid JSON."); process.exit(1); }
  const services = config.services ?? {};
  const expectedServices = [expectedGateway, "myurls", "redis"];
  if (Object.keys(services).sort().join("\n") !== expectedServices.sort().join("\n")) {
    console.error("Compose validation error: default deployment must contain only subweb, myurls, and redis.");
    process.exitCode = 1;
  }
  const hasOwnPorts = (service) => service !== null && typeof service === "object" && Object.hasOwn(service, "ports");
  for (const [name, service] of Object.entries(services)) {
    if (hasOwnPorts(service) && !Array.isArray(service.ports)) {
      console.error(`Compose validation error: service ${name} ports must be an array when present.`);
      process.exitCode = 1;
    }
  }
  const publishedServices = Object.entries(services).filter(([, service]) => Array.isArray(service?.ports) && service.ports.length > 0);
  if (publishedServices.length !== 1 || publishedServices[0][0] !== expectedGateway) {
    console.error(`Compose validation error: only ${expectedGateway} may publish ports.`);
    process.exitCode = 1;
  }
  const gatewayPorts = services[expectedGateway]?.ports;
  const gatewayPort = gatewayPorts?.length === 1 ? gatewayPorts[0] : null;
  const portNumber = (value) => /^\d+$/.test(String(value)) && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535;
  if (!gatewayPort || typeof gatewayPort !== "object" || gatewayPort.host_ip !== "127.0.0.1" || gatewayPort.target !== 8080 || !portNumber(gatewayPort.published)) {
    console.error(`Compose validation error: ${expectedGateway} must publish container port 8080 on host loopback.`);
    process.exitCode = 1;
  }
  for (const name of ["redis", "myurls"]) {
    const service = services[name];
    if (!service) {
      console.error(`Compose validation error: required internal service ${name} is missing.`);
      process.exitCode = 1;
    } else if (hasOwnPorts(service) && (!Array.isArray(service.ports) || service.ports.length > 0)) {
      console.error(`Compose validation error: internal service ${name} must not publish ports.`);
      process.exitCode = 1;
    }
  }
  for (const [name, service] of Object.entries(services)) {
    const actualNetworks = Object.keys(service?.networks ?? {}).sort();
    if (actualNetworks.length !== 1 || actualNetworks[0] !== "default") {
      console.error(`Compose validation error: service ${name} must use only the default private network.`);
      process.exitCode = 1;
    }
  }
  const defaultNetwork = config.networks?.default;
  if (defaultNetwork?.internal === true) {
    console.error("Compose validation error: default network must allow outbound access for the bundled converter.");
    process.exitCode = 1;
  }
});
' "$expectedGateway"

printf 'Compose simple deployment, network, and published-port contracts are valid.\n'
