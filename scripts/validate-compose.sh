#!/bin/sh
set -eu

fail() {
  printf 'Compose validation error: %s\n' "$1" >&2
  exit 1
}

expectedGateway="gateway"

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
  for (const name of ["redis", "myurls-app", "myurls-short", "subconverter"]) {
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
