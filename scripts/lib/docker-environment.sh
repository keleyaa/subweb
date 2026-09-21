#!/bin/sh

# Execute Docker-related commands with an explicit, minimal environment. Compose
# interpolation comes only from SUBWEB_ENV_FILE, while COMPOSE_FILE selects the
# profile chosen by the caller.
run_docker_environment() (
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
    COMPOSE_FILE="${COMPOSE_FILE-}" \
    COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME-}" \
    SUBWEB_ENV_FILE="${SUBWEB_ENV_FILE-}" \
    "$@"
)
