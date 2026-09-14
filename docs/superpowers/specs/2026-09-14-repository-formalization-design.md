# Repository Formalization Design

- Status: Draft for review
- Scope: Phase A of the Linux VPS formalization
- Target: one Linux VPS running Docker Compose behind an external TLS reverse proxy
- Release authority: Git tag `vX.Y.Z`

## 1. Objective

Make the repository a predictable production delivery unit. A maintainer should be able to configure, validate, start, inspect, upgrade, back up, restore, and roll back the service through documented commands with reproducible CI evidence.

Phase A covers repository behavior, release contracts, CI/CD, tests, and documentation. Phase B will add VPS host integration such as systemd, `/opt/subweb`, scheduled backups, log rotation, and host-level proxy templates.

## 2. Non-goals and fixed decisions

- Do not implement Redis 8 to Redis 7 data migration.
- Do not silently delete or rewrite persistent data during startup or upgrade.
- Do not make `latest` a production deployment input.
- Do not add a broad automatic Redis major-version migration guard in this phase.
- Do not require Kubernetes, Ansible, a database server outside Compose, or multi-host deployment.
- Keep external TLS termination outside the Compose stack.
- Use the Git release tag as the only product release-version authority. `package.json` remains Node tooling metadata and is not used to decide what is released.

## 3. Production command contract

`scripts/subweb.sh` remains the canonical production interface:

- `install`: create a protected `.env`, validate inputs, and install the selected immutable Gateway image.
- `up`: validate configuration and Compose contracts, then start the locked runtime.
- `down`: stop the stack without deleting named data volumes.
- `status`: show service state and health.
- `logs`: expose service logs without printing secrets.
- `verify`: validate the selected deployment contract without changing data.
- `backup`: create a regular, permission-protected Redis backup at an operator-selected absolute path.
- `restore`: require an explicit backup path and explicit stop-writes confirmation.
- `upgrade`: validate the release image and runtime lock before starting; report failure if health or runtime drift checks fail.

Any operation that removes persistent data must be separate from `down`, require an explicit confirmation, and state exactly which volume is affected. Phase A must not turn an ordinary failed `up` or `upgrade` into a destructive reset.

Configuration behavior is strict:

- Production commands require a regular, non-symlink `.env` with required values.
- Secrets are passed through environment files or stdin, never command-line arguments.
- The default production profile contains exactly `gateway`, `subconverter`, `myurls`, and `redis` when short links are enabled.
- The disabled profile contains only `gateway` and `subconverter`.

Redis remains pinned to the approved `7.4.11-alpine` image and digest from `deploy/versions.lock.json`. If a Redis 7 process encounters an incompatible Redis 8 RDB, the operation must fail clearly and point operators to backup, restore, or explicit reset procedures; it must not claim a successful upgrade.

## 4. Version and release contract

`deploy/versions.lock.json` is the source of truth for third-party runtime images, source commits, manifest digests, and platform digests. The release tag is the source of truth for the Subweb product version.

The release workflow must:

1. Accept only a valid existing `vX.Y.Z` tag for a release.
2. Verify that the tag resolves to the exact commit validated by the quality job.
3. Build the Gateway image from that commit for the supported platforms.
4. Scan the exact immutable image references that will be published.
5. Publish only after quality, integration, documentation, lock, Compose, and security gates pass.
6. Emit a rollback manifest and deployment evidence tied to the same source commit and image digests.

The repository must document that `package.json` is not the release authority. A release must never derive its production identity from an unrelated working-tree version.

## 5. CI/CD contract

The repository will expose two related workflow layers:

### Pull request and main quality

The quality workflow runs deterministic repository checks and reports separate named results for:

- dependency installation with the lock file;
- unit and contract tests;
- lint and build;
- Compose, production-readiness, version-lock, and documentation checks;
- Shell and workflow syntax checks;
- Docker integration and Redis operation recovery where the runner supports Docker.

The workflow must use least-privilege permissions, pinned third-party actions, no secret values in logs, and explicit timeouts for long-running integration work.

### Release

The release workflow consumes the quality result for the same Git tag commit. It must not rebuild or publish a different commit after quality has passed. A moved tag, missing tag, mismatched SHA, failed health check, failed scan, or incomplete evidence blocks publication.

Required GitHub branch protection and environment-approval settings are documented as administrator actions. They cannot be guaranteed solely by files in the repository.

## 6. Test and evidence contract

Tests remain layered and independently runnable:

- Unit tests cover Gateway policy, parsing, limits, privacy, and frontend behavior.
- Contract tests cover Compose files, deployment scripts, version locks, workflow structure, and documentation claims.
- Docker integration tests cover the real four-service profile and the disabled profile.
- Redis operation tests cover backup, restore, restart, authentication, and persistence behavior.
- Browser E2E tests cover the critical conversion and short-link user flow.

Each CI job prints a clear pass/fail marker. A truncated log, a container that was merely created, or a partial smoke test is not release evidence. The release verifier must finish with an unambiguous success marker.

## 7. Documentation contract

The following must describe one current system consistently:

- README and architecture assets;
- deployment and local-development guides;
- configuration and security guides;
- maintenance and operations runbooks;
- validation and third-party source documents;
- Compose service names, profile behavior, image versions, and release commands.

Automated documentation checks must reject retired service names, stale service counts, Redis 8 references, mutable production tags, and dual-MyUrls descriptions in user-facing documents and architecture assets.

## 8. Acceptance criteria

Phase A is complete when all of the following are true:

1. A fresh Linux VPS with no `.env` fails with a precise configuration message and makes no partial production claim.
2. A generated configuration starts the correct profile with immutable images and healthy services.
3. `down` stops services without deleting Redis or other named data volumes.
4. Backup and restore require explicit paths and confirmations and leave an auditable result.
5. Redis 8 RDB incompatibility is reported as a data-format problem, without automatic migration or destructive fallback.
6. A pull request receives deterministic quality results, including relevant Docker checks.
7. A release cannot publish if the tag commit differs from the commit validated by quality.
8. Published image references, rollback manifest, evidence, and documentation all identify the same release tag and commit.
9. No current user-facing document or architecture asset contains stale Redis 8, dual-MyUrls, or obsolete container-count claims.
10. The complete repository verification suite passes with a clean diff.

## 9. Phase B handoff

After Phase A is accepted, Phase B will define the host contract for a single Linux VPS:

- standard application directory and ownership;
- systemd service lifecycle and restart policy;
- scheduled encrypted/off-host backup handling and retention;
- Docker log rotation and disk-pressure checks;
- external Nginx/Caddy TLS proxy templates;
- first-deploy, upgrade, rollback, and disaster-recovery runbooks.

Phase B must consume the Phase A command contract rather than create a second deployment implementation.
