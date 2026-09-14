# VPS Runtime Design

- Status: Accepted and implemented in Phase B
- Scope: Single Linux VPS host integration after repository-level Phase A acceptance
- Depends on: `2026-09-14-repository-formalization-design.md`
- Deployment model: Docker Compose under `/opt/subweb`, external TLS reverse proxy

## 1. Objective

Define the host-level contract that runs the accepted repository deployment predictably on one Linux VPS. The host layer consumes `scripts/subweb.sh` and the locked Compose/release contracts; it does not create a second application deployment implementation.

## 2. Supported host assumptions

- Debian 12 or Ubuntu 24.04 LTS with systemd and a normal ext4/xfs filesystem.
- Docker Engine 27 or newer with Docker Compose v2; the `subweb` system user belongs to the `docker` group.
- Nginx terminates TLS outside the application Compose stack. DNS, SSH hardening, firewall policy, certificate issuance/renewal, and alert delivery remain administrator responsibilities.
- `/opt/subweb` contains a reviewed release checkout. `/opt/subweb/.env` is a regular `0600` file owned by `subweb:subweb`.
- Gateway is selected by release-specific immutable multi-platform manifest digest; mutable tags are not accepted for production.
- `subweb.service` owns start, stop, and restart and calls the repository entrypoint. It uses bounded failure restart limits and never deletes volumes.

## 3. Host layout and security boundaries

- Code: `/opt/subweb`, `root:subweb`, `0750`.
- Runtime scratch: `/opt/subweb/.runtime` and `.local`, `subweb:subweb`, `0700`.
- Backups: `/var/lib/subweb-backups` or a mounted off-host destination, `subweb:subweb`, `0700`.
- Backup policy: `/etc/subweb/backup.env`, `root:root`, `0600`.
- Units: `/etc/systemd/system/subweb*.{service,timer}`.
- Nginx template: `/etc/nginx/sites-available/subweb`, with only loopback `127.0.0.1:18080` as the application upstream.

systemd applies `NoNewPrivileges`, `PrivateTmp`, `ProtectHome`, and `ProtectSystem=strict`; only the application runtime and backup paths are writable. Docker access is an explicit host prerequisite, not a reason to run the application as root.

## 4. Lifecycle and rollback contract

`deploy/systemd/subweb.service` invokes `scripts/subweb.sh up` and `down`. Start failure is bounded by `StartLimitBurst=3` and `StartLimitIntervalSec=10min`. Ordinary stop, restart, upgrade, and systemd failure paths retain named volumes. A destructive reset is never automatic.

`install.sh` installs the units and templates, creates the `subweb` service account, sets permissions, reloads systemd, and enables units without starting the application. `check-host.sh` verifies Docker Compose v2, systemd, `.env` regular-file/`0600` requirements, and free disk space before startup.

A release rollback restores the previous reviewed checkout and restarts the service. Operators capture the failed release tag, immutable digest, systemd status, Compose status, and logs before rollback. Redis data rollback uses the existing explicit `subweb.sh restore --confirm-stop-writes` flow and never uses `down --volumes` as routine recovery.

## 5. Backup, retention, and restore verification

The daily `subweb-backup.timer` calls `scripts/vps/backup.sh` at 03:15 with a bounded random delay. Retention is refused unless either:

- `AGE_RECIPIENT` encrypts the new backup before older copies are removed; or
- `BACKUP_REMOTE_MOUNT` is mounted and `BACKUP_DIRECTORY` is beneath that mount.

The monthly `subweb-backup-verify.timer` calls `scripts/vps/verify-backup.sh`, verifies the SHA-256 sidecar, decrypts encrypted material only to a mode `0600` temporary file, and delegates RDB validation/loading to the locked Redis image through `scripts/operations/verify-redis-backup.sh`. Production restore remains an explicit operator action with a stop-writing confirmation.

## 6. Logs and disk pressure

Compose fixes every service to Docker `json-file` logging with `max-size=10m` and `max-file=3`. The host `logrotate` rule only rotates optional `/var/log/subweb/*.log`; it does not manipulate Docker's data directory. `check-host.sh` requires 10 GiB free by default, configurable through `MIN_FREE_KIB`. Host monitoring must separately alert on `/var/lib/docker`, backup storage, and certificate expiry.

## 7. External TLS proxy

`deploy/nginx/subweb.conf` redirects HTTP to HTTPS and proxies APP, API, and SHORT hosts to `127.0.0.1:18080`, preserving Host and forwarding headers. The template is intentionally outside Compose. Operators must replace example domains/certificate paths, run `nginx -t`, reload Nginx, and configure `TRUSTED_PROXY_CIDR` to the actual proxy network. A public `0.0.0.0` container binding is not supported.

## 8. Operator evidence

First deployment, upgrade, rollback, backup verification, and disaster-recovery rehearsals record: release tag, Git commit, immutable Gateway digest, `.env` permission check, systemd status, Compose status, backup path and SHA-256, verification output, Nginx test output, and UTC timestamp. Secrets, age identity material, Redis credentials, Turnstile secrets, and complete short codes never enter logs or tickets.

## 9. Required artifacts

- `scripts/vps/install.sh` and `scripts/vps/check-host.sh`;
- `scripts/vps/backup.sh` and `scripts/vps/verify-backup.sh`;
- `deploy/systemd/subweb.service`;
- daily backup and monthly verification systemd service/timer units;
- `deploy/logrotate/subweb.conf`;
- `deploy/nginx/subweb.conf`;
- `docs/deployment-vps.md` and host-level contract tests.
