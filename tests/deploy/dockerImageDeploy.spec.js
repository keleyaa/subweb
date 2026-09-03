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
  'compose -f compose.yaml config --quiet') exit 0 ;;
  'compose -f compose.yaml config --format json')
      printf '%s\n' '{"networks":{"default":{},"myurls-data":{"internal":true},"myurls-edge":{"internal":true},"redis-policy":{"internal":true},"subconverter-egress":{"internal":true}},"services":{"gateway":{"ports":[{"host_ip":"127.0.0.1","published":"18080","target":8080}],"networks":{"default":{},"myurls-edge":{},"redis-policy":{},"subconverter-egress":{}},"user":"65532:65532","read_only":true,"cap_drop":["ALL"],"security_opt":["no-new-privileges:true"],"environment":{"EGRESS_LISTEN_ADDR":"0.0.0.0:25502"}},"myurls-app":{"networks":{"myurls-data":{},"myurls-edge":{}},"user":"10001:10001","read_only":true,"cap_drop":["ALL"],"security_opt":["no-new-privileges:true"]},"myurls-short":{"networks":{"myurls-data":{},"myurls-edge":{}},"user":"10001:10001","read_only":true,"cap_drop":["ALL"],"security_opt":["no-new-privileges:true"]},"redis":{"networks":{"myurls-data":{},"redis-policy":{}},"user":"999:999","read_only":true,"cap_drop":["ALL"],"security_opt":["no-new-privileges:true"]},"subconverter":{"networks":{"subconverter-egress":{}},"user":"101:101","read_only":true,"cap_drop":["ALL"],"security_opt":["no-new-privileges:true"],"environment":{"HTTPS_PROXY":"http://gateway:25502"}}}}'
    ;;
  'compose -f compose.yaml pull gateway subconverter myurls-app myurls-short redis') exit "\${DOCKER_PULL_STATUS:-0}" ;;
  'compose -f compose.disabled-short-links.yaml config --quiet') exit 0 ;;
  'compose -f compose.disabled-short-links.yaml config --format json')
      printf '%s\n' '{"networks":{"default":{},"subconverter-egress":{"internal":true}},"services":{"gateway":{"ports":[{"host_ip":"127.0.0.1","published":"18080","target":8080}],"networks":{"default":{},"subconverter-egress":{}},"user":"65532:65532","read_only":true,"cap_drop":["ALL"],"security_opt":["no-new-privileges:true"],"environment":{"EGRESS_LISTEN_ADDR":"0.0.0.0:25502"}},"subconverter":{"networks":{"subconverter-egress":{}},"user":"101:101","read_only":true,"cap_drop":["ALL"],"security_opt":["no-new-privileges:true"]}}}'
    ;;
  'compose -f compose.disabled-short-links.yaml pull gateway subconverter') exit "\${DOCKER_PULL_STATUS:-0}" ;;
  'compose -f compose.disabled-short-links.yaml up -d --no-build --pull never --wait') exit 0 ;;
  'compose -f compose.disabled-short-links.yaml ps') exit 0 ;;
  'compose -f compose.yaml up -d --no-build --pull never --wait') exit 0 ;;
  'compose -f compose.yaml ps') exit 0 ;;
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
  it('documents a runnable prebuilt-image installation command', async () => {
    const documentation = await readFile(new URL('docs/deployment-docker.md', repositoryRoot), 'utf8');

    expect(documentation).toContain('./scripts/subweb.sh install \\\n');
    expect(documentation).not.toContain('./scripts/docker-deploy.sh install');
    expect(documentation).toContain('./scripts/configure.sh \\\n  --short-links-enabled false');
    expect(documentation).not.toContain('SHORT_LINKS_ENABLED=false ./scripts/configure.sh');
  });

  it('persists the selected image and pulls the three default services', async () => {
    const root = await makeFixture();
    const image = 'docker.io/keleyaa/subweb:sha-2bf1a9f';

    const result = runDeploy(root, ['--image', image]);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readFile(join(root, '.env'), 'utf8')).toContain(`SUBWEB_IMAGE=${image}\n`);
    expect(await readFile(join(root, 'docker.log'), 'utf8')).toBe([
      'compose version',
      'compose -f compose.yaml config --quiet',
      'compose -f compose.yaml config --format json',
      'compose -f compose.yaml pull gateway subconverter myurls-app myurls-short redis',
      'compose -f compose.yaml up -d --no-build --pull never --wait',
      'compose -f compose.yaml ps',
      '',
    ].join('\n'));
  });

  it('requires an immutable Gateway image instead of silently deploying latest', async () => {
    const root = await makeFixture();

    const missing = runDeploy(root);
    const mutable = runDeploy(root, ['--image', 'docker.io/keleyaa/subweb:latest']);

    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('--image is required');
    expect(mutable.status).not.toBe(0);
    expect(mutable.stderr).toContain('immutable sha-* tag or sha256 digest');
    const invalidProxy = runDeploy(root, ['--image', 'docker.io/keleyaa/subweb:sha-2bf1a9f', '--trusted-proxy-cidr', '0.0.0.0/0']);
    expect(invalidProxy.status).not.toBe(0);
    expect(invalidProxy.stderr).toContain('TRUSTED_PROXY_CIDR');
    const invalidProxyLog = await readFile(join(root, 'docker.log'), 'utf8');
    expect(invalidProxyLog).toBe('compose version\n');
  });

  it('deploys only Gateway and SubConverter when short links are disabled', async () => {
    const root = await makeFixture();
    const result = runDeploy(root, ['--image', 'docker.io/keleyaa/subweb:sha-2bf1a9f', '--disable-short-links']);

    expect(result.status, `${result.stdout}\\n${result.stderr}`).toBe(0);
    const env = await readFile(join(root, '.env'), 'utf8');
    expect(env).toContain('SHORT_LINKS_ENABLED=false\n');
    expect(env).not.toMatch(/(?:SHORT_DOMAIN|TURNSTILE_|IP_HASH_SECRET|REDIS_PASSWORD)=/);
    const log = await readFile(join(root, 'docker.log'), 'utf8');
    expect(log).toContain('compose -f compose.disabled-short-links.yaml pull gateway subconverter');
    expect(log).toContain('compose -f compose.disabled-short-links.yaml up -d --no-build --pull never --wait');
    expect(log).not.toContain('compose -f compose.yaml pull');
  });

  it('does not start containers when pulling an image fails', async () => {
    const root = await makeFixture();

    const result = runDeploy(root, ['--image', 'docker.io/keleyaa/subweb:sha-2bf1a9f'], { DOCKER_PULL_STATUS: '23' });

    expect(result.status).not.toBe(0);
    const log = await readFile(join(root, 'docker.log'), 'utf8');
    expect(log).toContain('compose -f compose.yaml pull gateway subconverter myurls-app myurls-short redis');
    expect(log).not.toContain('compose up');
  });
});
