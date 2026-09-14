# VPS Runtime Design

- Status: Draft for Phase B review
- Scope: Single Linux VPS host integration after repository-level Phase A acceptance
- Depends on: `2026-09-14-repository-formalization-design.md`
- Deployment model: Docker Compose under `/opt/subweb`, external TLS reverse proxy

## 1. Objective

Define the host-level contract that runs the accepted repository deployment predictably on one Linux VPS. The host layer must consume `scripts/subweb.sh` and the locked Compose/release contracts; it must not create a second application deployment implementation.

## 2. Fixed boundaries

- Keep TLS termination outside the Compose application stack.
- Keep Redis data in the named Compose volume and never delete it during ordinary service, restart, or upgrade operations.
- Require a real `/opt/subweb/.env` file with mode `0600`; do not support a symlink as the production environment file.
- Use an immutable Gateway image reference selected from a validated release.
- Any destructive data reset remains an explicit operator action after backup and confirmation.
- Backups must be encrypted or transferred to an off-host destination before retention cleanup can remove older copies.

## 3. Design questions to resolve

1. What Linux distribution, service user, Docker Engine/Compose versions, and filesystem layout are supported?
2. Which systemd unit owns startup, shutdown, restart, and health-failure behavior, and what restart limits prevent loops?
3. Where are backup artifacts staged, encrypted, transferred, retained, and verified?
4. Which Docker log-driver settings and host disk-pressure thresholds are mandatory?
5. Which Nginx or Caddy template terminates TLS and forwards only the intended public routes?
6. What first-deploy, upgrade, rollback, and disaster-recovery evidence must be captured?
7. Which firewall, SSH, DNS, monitoring, and alerting prerequisites are administrator responsibilities?

## 4. Required deliverables

- systemd service and install/update procedure;
- `/opt/subweb` ownership, permissions, and release layout;
- backup timer/service with retention and restore verification;
- Docker log rotation and disk-pressure checks;
- external TLS proxy template and header/upstream contract;
- first-deploy, upgrade, rollback, and disaster-recovery runbooks;
- host-level tests or shell contracts that fail before destructive actions.

## 5. Acceptance gate

Phase B implementation may begin only after the questions above have explicit answers, the host contract names the supported assumptions, and every new destructive or privileged operation has a testable confirmation and rollback path.
