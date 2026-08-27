import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../', import.meta.url);
const temporaryDirectories = [];

const makeFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'subweb-image-deploy-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'scripts/lib'), { recursive: true });
  await mkdir(join(root, 'deploy/redis'), { recursive: true });
  await mkdir(join(root, 'bin'), { recursive: true });
  for (const file of [
    'scripts/docker-deploy.sh',
    'scripts/configure.sh',
    'scripts/validate-compose.sh',
    'scripts/lib/config.sh',
    'compose.yaml',
    'deploy/redis/redis.conf.template',
  ]) {
    await cp(new URL(file, repositoryRoot), join(root, file));
  }
  const docker = join(root, 'bin/docker');
  await writeFile(docker, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$*" in
  'compose version') exit 0 ;;
  'compose config --quiet') exit 0 ;;
  'compose config --format json')
    printf '%s\\n' '{"services":{"gateway":{"ports":[{"published":"18080"}]},"redis":{},"myurls-app":{},"myurls-short":{},"subconverter":{}}}'
    ;;
  'compose pull') exit "\${DOCKER_PULL_STATUS:-0}" ;;
  'compose up -d --no-build --pull always --wait') exit 0 ;;
  'compose ps') exit 0 ;;
  *) exit 64 ;;
esac
`);
  await chmod(docker, 0o755);
  return root;
};

const runDeploy = (root, extraArgs = [], env = {}) =>
  spawnSync('sh', [join(root, 'scripts/docker-deploy.sh'),
    '--app-domain', 'example.com',
    '--api-domain', 'api.example.com',
    '--short-domain', 'short.example.com',
    '--turnstile-site-key', 'test-site-key',
    '--turnstile-secret-key', 'test-secret-key',
    ...extraArgs,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      DOCKER_LOG: join(root, 'docker.log'),
      ...env,
    },
  });

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('Docker image quick deployment', () => {
  it('persists the selected image, pulls it, and starts without building', async () => {
    const root = await makeFixture();
    const image = 'docker.io/keleyaa/subweb:sha-2bf1a9f';

    const result = runDeploy(root, ['--image', image, '--trusted-proxy-cidr', '172.18.0.1/32']);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readFile(join(root, '.env'), 'utf8')).toContain(`SUBWEB_IMAGE=${image}\n`);
    expect(await readFile(join(root, '.env'), 'utf8')).toContain('TRUSTED_PROXY_CIDR=172.18.0.1/32\n');
    expect(await readFile(join(root, 'docker.log'), 'utf8')).toBe([
      'compose version',
      'compose config --quiet',
      'compose config --format json',
      'compose pull',
      'compose up -d --no-build --pull always --wait',
      'compose ps',
      '',
    ].join('\n'));
  });

  it('does not start containers when pulling an image fails', async () => {
    const root = await makeFixture();

    const result = runDeploy(root, [], { DOCKER_PULL_STATUS: '23' });

    expect(result.status).not.toBe(0);
    const log = await readFile(join(root, 'docker.log'), 'utf8');
    expect(log).toContain('compose pull');
    expect(log).not.toContain('compose up');
  });
});
