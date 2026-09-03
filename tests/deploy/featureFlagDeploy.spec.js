import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../', import.meta.url);
const temporaryDirectories = [];

const makeFixture = async (shortLinksEnabled) => {
  const root = await mkdtemp(join(tmpdir(), 'subweb-feature-deploy-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'scripts'), { recursive: true });
  await writeFile(join(root, '.env'), `SHORT_LINKS_ENABLED=${shortLinksEnabled}\n`, { mode: 0o600 });
  await writeFile(join(root, 'scripts/subweb.sh'), await readFile(new URL('scripts/subweb.sh', repositoryRoot), 'utf8'));
  await chmod(join(root, 'scripts/subweb.sh'), 0o755);
  const docker = join(root, 'bin');
  await mkdir(docker);
  await writeFile(join(docker, 'docker'), `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$*" in
  'compose version') exit 0 ;;
  'compose -f compose.yaml up -d --build --pull missing --wait') exit 0 ;;
  'compose -f compose.disabled-short-links.yaml up -d --build --pull missing --wait') exit 0 ;;
  'compose -f compose.disabled-short-links.yaml up -d --no-build --pull never --wait') exit 0 ;;
  'compose -f compose.disabled-short-links.yaml down') exit 0 ;;
  'compose -f compose.disabled-short-links.yaml ps') exit 0 ;;
  'compose -f compose.disabled-short-links.yaml logs') exit 0 ;;
  *) exit 64 ;;
esac
`);
  await chmod(join(docker, 'docker'), 0o755);
  return root;
};

const runCLI = (root, args, environment = {}) => {
  const env = {
    ...process.env,
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    DOCKER_LOG: join(root, 'docker.log'),
    ...environment,
  };
  if (!Object.hasOwn(environment, 'SUBWEB_IMAGE')) delete env.SUBWEB_IMAGE;
  return spawnSync('sh', [join(root, 'scripts/subweb.sh'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('feature-flag deployment entrypoint', () => {
  it('selects the disabled short-link Compose file for lifecycle commands', async () => {
    const root = await makeFixture('false');
    for (const command of ['up', 'down', 'status', 'logs']) {
      const result = runCLI(root, [command]);
      expect(result.status, result.stderr).toBe(0);
    }
    expect(await readFile(join(root, 'docker.log'), 'utf8')).toBe([
      'compose version',
      'compose -f compose.disabled-short-links.yaml up -d --build --pull missing --wait',
      'compose version',
      'compose -f compose.disabled-short-links.yaml down',
      'compose version',
      'compose -f compose.disabled-short-links.yaml ps',
      'compose version',
      'compose -f compose.disabled-short-links.yaml logs',
      '',
    ].join('\n'));
  });

  it('builds the local Gateway and pulls missing images on a fresh source checkout', async () => {
    const root = await makeFixture('true');
    const result = runCLI(root, ['up']);
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(join(root, 'docker.log'), 'utf8')).toContain(
      'compose -f compose.yaml up -d --build --pull missing --wait\n',
    );
  });

  it('does not rebuild an explicitly selected prebuilt Gateway image', async () => {
    const root = await makeFixture('false');
    await writeFile(join(root, '.env'), 'SHORT_LINKS_ENABLED=false\nSUBWEB_IMAGE=ghcr.io/example/subweb:sha-abcdef1\n');
    const result = runCLI(root, ['up'], { SUBWEB_IMAGE: 'ghcr.io/example/subweb:sha-abcdef1' });
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(join(root, 'docker.log'), 'utf8')).toContain(
      'compose -f compose.disabled-short-links.yaml up -d --no-build --pull never --wait\n',
    );
  });

  it('treats an empty exported Gateway image as Compose does', async () => {
    const root = await makeFixture('false');
    await writeFile(join(root, '.env'), 'SHORT_LINKS_ENABLED=false\nSUBWEB_IMAGE=ghcr.io/example/subweb:sha-abcdef1\n');
    const result = runCLI(root, ['up'], { SUBWEB_IMAGE: '' });
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(join(root, 'docker.log'), 'utf8')).toContain(
      'compose -f compose.disabled-short-links.yaml up -d --build --pull missing --wait\n',
    );
  });

  it('refuses restore for disabled short links or without explicit stop-write confirmation', async () => {
    const disabledRoot = await makeFixture('false');
    const disabledResult = runCLI(disabledRoot, ['restore', '--backup', '/tmp/verified.rdb', '--confirm-stop-writes']);
    expect(disabledResult.status).not.toBe(0);
    expect(disabledResult.stderr).toContain('restore requires SHORT_LINKS_ENABLED=true');

    const enabledRoot = await makeFixture('true');
    const missingConfirmation = runCLI(enabledRoot, ['restore', '--backup', '/tmp/verified.rdb']);
    expect(missingConfirmation.status).not.toBe(0);
    expect(missingConfirmation.stderr).toContain('--confirm-stop-writes');
  });

  it('forwards an explicitly confirmed absolute backup to the enabled-profile restore command', async () => {
    const root = await makeFixture('true');
    await mkdir(join(root, 'scripts', 'operations'));
    await writeFile(
      join(root, 'scripts', 'operations', 'restore-redis.sh'),
      '#!/bin/sh\nprintf "compose=%s args=%s\\n" "$COMPOSE_FILE" "$*" >> "$RESTORE_LOG"\n',
    );
    await chmod(join(root, 'scripts', 'operations', 'restore-redis.sh'), 0o755);

    const backup = join(root, 'verified.rdb');
    await writeFile(backup, 'verified backup');
    const result = spawnSync(
      'sh',
      [join(root, 'scripts/subweb.sh'), 'restore', '--backup', backup, '--confirm-stop-writes'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          DOCKER_LOG: join(root, 'docker.log'),
          RESTORE_LOG: join(root, 'restore.log'),
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(join(root, 'restore.log'), 'utf8')).toBe(
      `compose=compose.yaml args=--backup ${backup} --confirm-stop-writes\n`,
    );
  });
});
