#!/bin/sh
set -eu

fail() {
  printf 'Compose validation error: %s\n' "$1" >&2
  exit 1
}

read_profile_from_env_file() {
  [ -f .env ] || return 1
  awk 'index($0, "COMPOSE_PROFILES=") == 1 { count += 1; value = substr($0, 18) } END { if (count == 1) print value; else exit 1 }' .env
}

if [ "${COMPOSE_PROFILES+x}" = x ]; then
  compose_profiles=$COMPOSE_PROFILES
else
  compose_profiles=$(read_profile_from_env_file) || fail 'COMPOSE_PROFILES must appear exactly once in .env.'
fi

case "$compose_profiles" in
  behind-proxy) expected_gateway=gateway-http ;;
  direct-tls) expected_gateway=gateway-tls ;;
  *) fail 'COMPOSE_PROFILES must be exactly behind-proxy or direct-tls.' ;;
esac

docker compose config --quiet

compose_json=$(docker compose config --format json)
printf '%s\n' "$compose_json" | node -e '
let input = "";
const expectedGateway = process.argv[1];
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let config;
  try {
    config = JSON.parse(input);
  } catch {
    console.error("Compose validation error: docker compose returned invalid JSON.");
    process.exit(1);
  }
  const services = config.services ?? {};
  const gatewayNames = ["gateway-http", "gateway-tls"];
  const hasOwnPorts = (service) =>
    service !== null &&
    typeof service === "object" &&
    Object.prototype.hasOwnProperty.call(service, "ports");
  for (const [name, service] of Object.entries(services)) {
    if (hasOwnPorts(service) && !Array.isArray(service.ports)) {
      console.error(`Compose validation error: service ${name} ports must be an array when present.`);
      process.exitCode = 1;
    }
  }
  const publishedServices = Object.entries(services).filter(
    ([, service]) => Array.isArray(service?.ports) && service.ports.length > 0,
  );
  if (
    publishedServices.length !== 1 ||
    publishedServices[0][0] !== expectedGateway ||
    !gatewayNames.includes(publishedServices[0][0])
  ) {
    console.error(`Compose validation error: only ${expectedGateway} may publish ports for the selected profile.`);
    process.exitCode = 1;
  }
  for (const name of ["redis", "myurls", "subconverter"]) {
    if (!services[name]) {
      console.error(`Compose validation error: required internal service ${name} is missing.`);
      process.exitCode = 1;
    } else if (
      hasOwnPorts(services[name]) &&
      (!Array.isArray(services[name].ports) || services[name].ports.length > 0)
    ) {
      console.error(`Compose validation error: internal service ${name} must not publish ports.`);
      process.exitCode = 1;
    }
  }
});
' "$expected_gateway"

printf 'Compose profile and published-port contract are valid.\n'
