#!/bin/sh
set -eu

fail() {
  printf 'Compose validation error: %s\n' "$1" >&2
  exit 1
}

expectedGateway="gateway"

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
    publishedServices[0][0] !== expectedGateway
  ) {
    console.error(`Compose validation error: only ${expectedGateway} may publish ports.`);
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
' "$expectedGateway"

printf 'Compose single-gateway and published-port contract are valid.\n'
