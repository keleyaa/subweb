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

const runCLI = (root, args) => spawnSync('sh', [join(root, 'scripts/subweb.sh'), ...args], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, DOCKER_LOG: join(root, 'docker.log') },
});

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
      'compose -f compose.disabled-short-links.yaml up -d --no-build --pull never --wait',
      'compose version',
      'compose -f compose.disabled-short-links.yaml down',
      'compose version',
      'compose -f compose.disabled-short-links.yaml ps',
      'compose version',
      'compose -f compose.disabled-short-links.yaml logs',
      '',
    ].join('\n'));
  });

  it('uses the production Compose file when short links are enabled', async () => {
    const root = await makeFixture('true');
    const result = runCLI(root, ['up']);
    expect(result.status).not.toBe(0);
    expect(await readFile(join(root, 'docker.log'), 'utf8')).toContain('compose version\n');
    expect(await readFile(join(root, 'docker.log'), 'utf8')).not.toContain('compose.disabled-short-links.yaml');
  });
});
