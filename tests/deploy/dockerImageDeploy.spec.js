import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../', import.meta.url);
const temporaryDirectories = [];

const lockedImages = {
  redis: 'docker.io/library/redis:8.10.1@sha256:298e5b3bc566bade82f46ad5511777a4a07a294097ce16ada2f6a42be5239df5',
  myurls: 'ghcr.io/keleyaa/myurls:v2.0.6@sha256:3ccd97bd9b3c5ad6dfea4c414f055698b0cce39a54a47fdb94c5cab7f6526ed3',
  subconverter: 'ghcr.io/aethersailor/subconverter-extended:v1.8.6@sha256:5986d0db938d85482185e51b55be3a0326e56c1ba3e3f8326895e89f31804475',
};

const enabledCompose = {
  networks: {
    default: {},
    'myurls-data': { internal: true },
    'myurls-edge': { internal: true },
    'redis-policy': { internal: true },
    'subconverter-egress': { internal: true },
  },
  services: {
    gateway: {
      image: 'docker.io/keleyaa/subweb:sha-2bf1a9f',
      ports: [{ host_ip: '127.0.0.1', published: '18080', target: 8080 }],
      networks: { default: {}, 'myurls-edge': {}, 'redis-policy': {}, 'subconverter-egress': {} },
      user: '65532:65532', read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
      environment: {
        EGRESS_LISTEN_ADDR: '0.0.0.0:25502',
        SHORT_LINKS_ENABLED: 'true',
      },
      depends_on: {
        redis: { condition: 'service_healthy', restart: true },
        'myurls-app': { condition: 'service_healthy', restart: true },
        'myurls-short': { condition: 'service_healthy', restart: true },
      },
    },
    'myurls-app': {
      image: lockedImages.myurls, networks: { 'myurls-data': {}, 'myurls-edge': {} }, user: '10001:10001',
      read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    },
    'myurls-short': {
      image: lockedImages.myurls, networks: { 'myurls-data': {}, 'myurls-edge': {} }, user: '10001:10001',
      read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    },
    redis: {
      image: lockedImages.redis, networks: { 'myurls-data': {}, 'redis-policy': {} }, user: '999:999',
      read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    },
    subconverter: {
      image: lockedImages.subconverter, networks: { 'subconverter-egress': {} }, user: '101:101',
      read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
      environment: { HTTPS_PROXY: 'http://gateway:25502' },
      depends_on: { gateway: { condition: 'service_healthy', restart: true } },
    },
  },
};

const disabledCompose = {
  networks: { default: {}, 'subconverter-egress': { internal: true } },
  services: {
    gateway: {
      image: 'docker.io/keleyaa/subweb:sha-2bf1a9f',
      ports: [{ host_ip: '127.0.0.1', published: '18080', target: 8080 }],
      networks: { default: {}, 'subconverter-egress': {} }, user: '65532:65532',
      read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
      environment: {
        EGRESS_LISTEN_ADDR: '0.0.0.0:25502',
        SHORT_LINKS_ENABLED: 'false',
      },
    },
    subconverter: {
      image: lockedImages.subconverter, networks: { 'subconverter-egress': {} }, user: '101:101',
      read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
      depends_on: { gateway: { condition: 'service_healthy', restart: true } },
    },
  },
};

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
    'deploy/versions.lock.json',
    'deploy/redis/redis.conf.template',
  ]) {
    await cp(new URL(file, repositoryRoot), join(root, file));
  }
  const enabledJSON = join(root, 'compose-enabled.json');
  const disabledJSON = join(root, 'compose-disabled.json');
  await Promise.all([
    writeFile(enabledJSON, JSON.stringify(enabledCompose)),
    writeFile(disabledJSON, JSON.stringify(disabledCompose)),
  ]);
  const docker = join(root, 'bin/docker');
  await writeFile(docker, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$*" in
  'compose -f '*)
    if [ "\${CAPTURE_SUBWEB_IMAGE-}" = 1 ]; then
      printf 'SUBWEB_IMAGE=%s\\n' "\${SUBWEB_IMAGE-unset}" >> "$DOCKER_LOG"
    fi
    ;;
esac
case "$*" in
  'compose version') exit 0 ;;
  'compose -f compose.yaml config --quiet') exit 0 ;;
  'compose -f compose.yaml config --format json') cat "$COMPOSE_JSON_ENABLED" ;;
  'compose -f compose.yaml pull gateway subconverter myurls-app myurls-short redis') exit "\${DOCKER_PULL_STATUS:-0}" ;;
  'compose -f compose.disabled-short-links.yaml config --quiet') exit 0 ;;
  'compose -f compose.disabled-short-links.yaml config --format json') cat "$COMPOSE_JSON_DISABLED" ;;
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

const runDeploy = (root, extraArgs = [], env = {}, input = 'test-secret-key\n') =>
  spawnSync('sh', [join(root, 'scripts/docker-deploy.sh'),
    '--app-domain', 'example.com',
    '--api-domain', 'api.example.com',
    '--short-domain', 'short.example.com',
    '--turnstile-site-key', 'test-site-key',
    '--turnstile-secret-key-stdin',
    ...extraArgs,
  ], {
    cwd: root,
    encoding: 'utf8',
    input,
    env: {
        ...process.env,
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      DOCKER_LOG: join(root, 'docker.log'),
      COMPOSE_JSON_ENABLED: join(root, 'compose-enabled.json'),
      COMPOSE_JSON_DISABLED: join(root, 'compose-disabled.json'),
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

  it('passes the Turnstile secret through stdin instead of configure argv', async () => {
    const root = await makeFixture();
    const argsLog = join(root, 'configure-args.log');
    const stdinLog = join(root, 'configure-stdin.log');
    await writeFile(join(root, 'scripts/configure.sh'), `#!/bin/sh
set -eu
printf '%s\\n' "$*" > "$CONFIGURE_ARGS_LOG"
cat > "$CONFIGURE_STDIN_LOG"
cat > .env <<'EOF'
APP_DOMAIN=example.com
API_DOMAIN=api.example.com
SHORT_DOMAIN=short.example.com
API_URL=https://api.example.com
SHORT_LINKS_ENABLED=true
CUSTOM_BACKEND_ENABLED=true
TURNSTILE_SITE_KEY=test-site-key
TURNSTILE_SECRET_KEY=test-secret-key
IP_HASH_SECRET=${'a'.repeat(64)}
REDIS_PASSWORD=${'b'.repeat(64)}
EOF
`);
    await chmod(join(root, 'scripts/configure.sh'), 0o755);

    const result = runDeploy(root, ['--image', 'docker.io/keleyaa/subweb:sha-2bf1a9f'], {
      CONFIGURE_ARGS_LOG: argsLog,
      CONFIGURE_STDIN_LOG: stdinLog,
    });

    expect(result.status, `${result.stdout}\\n${result.stderr}`).toBe(0);
    expect(await readFile(argsLog, 'utf8')).toContain('--turnstile-secret-key-stdin');
    expect(await readFile(argsLog, 'utf8')).not.toContain('test-secret-key');
    expect(await readFile(stdinLog, 'utf8')).toBe('test-secret-key\n');
  });

  it('does not let an inherited Gateway image override the selected deployment image', async () => {
    const root = await makeFixture();
    const selectedImage = 'docker.io/keleyaa/subweb:sha-2bf1a9f';
    const result = runDeploy(root, ['--image', selectedImage], {
      CAPTURE_SUBWEB_IMAGE: '1',
      SUBWEB_IMAGE: 'docker.io/attacker/subweb:sha-deadbee',
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readFile(join(root, '.env'), 'utf8')).toContain(`SUBWEB_IMAGE=${selectedImage}\n`);
    const log = await readFile(join(root, 'docker.log'), 'utf8');
    expect(log).toContain('SUBWEB_IMAGE=unset');
    expect(log).not.toContain('SUBWEB_IMAGE=docker.io/attacker/subweb:sha-deadbee');
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
    const result = runDeploy(root, ['--image', 'docker.io/keleyaa/subweb:sha-2bf1a9f', '--disable-short-links'], {}, '');

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
