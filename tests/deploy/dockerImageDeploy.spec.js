import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../', import.meta.url);
const temporaryDirectories = [];

const lockedImages = {
  redis: 'docker.io/library/redis:7.4.11-alpine@sha256:520775a41a63e77e06c73e35d2fd9cc15921a609516818796b4ecbb813078bc7',
  myurls: 'ghcr.io/keleyaa/myurls:v2.0.8@sha256:441aed70342b9071f4f64bdbb6fe7d659774c23f1f8bfd3db76c33936eb01d36',
  subconverter: 'ghcr.io/aethersailor/subconverter-extended:v1.9.4@sha256:8e067383d26d6f3580e9255e13f11a83fd3500e9a3380eb69ae99af54c29f423',
};
const releaseVersion = 'v1.2.3';
const releaseDigest = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const dockerHubImage = `docker.io/keleyaa/subweb@sha256:${releaseDigest}`;
const ghcrImage = `ghcr.io/keleyaa/subweb@sha256:${releaseDigest}`;
const registryPortImage = `registry.example:5000/repository@sha256:${releaseDigest}`;
const taggedDigestImage = `docker.io/keleyaa/subweb:sha-2bf1a9f@sha256:${releaseDigest}`;
const immutableDigestError = 'Docker deployment error: --image must use an immutable sha256 digest.\n';
const disabledProfileImage = `ghcr.io/keleyaa/subweb@sha256:${'1'.repeat(64)}`;
const composeInterpolationVariables = [
  'API_DOMAIN', 'API_URL', 'APP_DOMAIN', 'CONVERSION_DNS_TIMEOUT_MS',
  'CONVERSION_EGRESS_CONNECT_TIMEOUT_MS', 'CONVERSION_MAX_CONCURRENCY',
  'CONVERSION_MAX_CONCURRENCY_PER_IP', 'CONVERSION_MAX_REQUEST_BYTES',
  'CONVERSION_MAX_RESPONSE_BYTES', 'CONVERSION_RATE_LIMIT',
  'CONVERSION_RATE_WINDOW_SECONDS', 'CONVERSION_REQUEST_TIMEOUT_MS',
  'CUSTOM_BACKEND_ENABLED', 'EGRESS_ALLOWED_HOSTS', 'IP_HASH_SECRET',
  'LOG_LEVEL', 'MYURLS_GATEWAY_IP', 'MYURLS_IMAGE', 'MYURLS_IP',
  'MYURLS_LOG_LEVEL', 'MYURLS_NETWORK_SUBNET', 'MYURLS_TRUST_PROXY_CIDR',
  'REDIS_IMAGE', 'REDIS_PASSWORD', 'SHORT_DOMAIN', 'SHORT_LINKS_ENABLED',
  'SUBCONVERTER_IMAGE', 'SUBWEB_IMAGE', 'SUBWEB_PORT', 'TRUSTED_PROXY_CIDR',
  'TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY',
];

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
      image: dockerHubImage,
      ports: [{ host_ip: '127.0.0.1', published: '18080', target: 8080 }],
      networks: { default: {}, 'myurls-edge': {}, 'redis-policy': {}, 'subconverter-egress': {} },
      user: '65532:65532', read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
      environment: {
        EGRESS_LISTEN_ADDR: '0.0.0.0:25502',
        EGRESS_RESTRICTED_LISTEN_ADDR: '0.0.0.0:25503',
        EGRESS_ALLOWED_HOSTS: 'challenges.cloudflare.com',
        SHORT_LINKS_ENABLED: 'true',
        APP_DOMAIN: 'app.example.com',
        SHORT_DOMAIN: 'short.example.com',
        MYURLS_UPSTREAM: 'http://myurls-edge:3000',
      },
      depends_on: {
        redis: { condition: 'service_healthy', restart: true },
        'myurls': { condition: 'service_healthy', restart: true },
      },
    },
    'myurls': {
      environment: { NODE_ENV: 'production', HTTPS_PROXY: 'http://gateway:25503', https_proxy: 'http://gateway:25503', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', PUBLIC_BASE_URL: 'https://short.example.com', TURNSTILE_HOSTNAME: 'app.example.com', TURNSTILE_ENABLED: 'true', TURNSTILE_MODE: 'cloudflare', TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'secret-key' },
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
      image: dockerHubImage,
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
     'scripts/runtime-image-contract.mjs',
     'scripts/verify-version-locks.mjs',
       'scripts/lib/config.sh',
       'scripts/lib/release-image.sh',
      'compose.yaml',
      'compose.common-services.yaml',
      'compose.disabled-short-links.yaml',
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
render_compose() {
  compose_json=$1
  gateway_image=$(awk -F= '$1 == "SUBWEB_IMAGE" { print substr($0, index($0, "=") + 1); exit }' .env)
  if [ "\${CAPTURE_COMPOSE_GATEWAY_IMAGE-}" = 1 ]; then
    printf 'COMPOSE_GATEWAY_IMAGE=%s\\n' "$gateway_image" >> "$DOCKER_LOG"
  fi
  node -e '
const { readFileSync } = require("node:fs");
const [composePath, gatewayImage] = process.argv.slice(1);
const compose = JSON.parse(readFileSync(composePath, "utf8"));
process.stdout.write(JSON.stringify({
  ...compose,
  services: {
    ...compose.services,
    gateway: { ...compose.services.gateway, image: gatewayImage },
  },
}));
' "$compose_json" "$gateway_image"
}
case "$*" in
  'buildx version') exit "\${DOCKER_BUILDX_STATUS:-0}" ;;
  'buildx imagetools inspect ghcr.io/keleyaa/subweb:'*' --format {{.Manifest.Digest}}')
     if [ "\${DOCKER_INSPECT_READ_STDIN-}" = 1 ]; then
       inspect_stdin=$(cat)
       printf 'BUILDX_INSPECT_STDIN=%s\\n' "\${inspect_stdin:-<none>}" >> "$DOCKER_LOG"
     fi
     [ "\${DOCKER_RESOLVE_STATUS:-0}" -eq 0 ] || exit "\${DOCKER_RESOLVE_STATUS}"
     printf 'sha256:%s' "\${DOCKER_RELEASE_DIGEST-}"
    ;;
  'compose version') exit 0 ;;
  'compose -f compose.yaml --env-file '*" config --quiet") exit 0 ;;
   'compose -f compose.yaml --env-file '*" config --format json")
      render_compose "$COMPOSE_JSON_ENABLED"
      ;;
  'compose -f compose.yaml pull gateway subconverter myurls redis') exit "\${DOCKER_PULL_STATUS:-0}" ;;
   'compose -f compose.disabled-short-links.yaml --env-file '*" config --quiet") exit 0 ;;
    'compose -f compose.disabled-short-links.yaml --env-file '*" config --format json")
      render_compose "$COMPOSE_JSON_DISABLED"
      ;;
  'compose -f compose.disabled-short-links.yaml pull gateway subconverter') exit "\${DOCKER_PULL_STATUS:-0}" ;;
  'compose -f compose.disabled-short-links.yaml up -d --no-build --pull never --remove-orphans --wait') exit 0 ;;
  'compose -f compose.disabled-short-links.yaml ps') exit 0 ;;
  'compose -f compose.yaml up -d --no-build --pull never --remove-orphans --wait') exit 0 ;;
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

const readDockerLog = async (root) => {
  try {
    return await readFile(join(root, 'docker.log'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('Docker image quick deployment', () => {
  it('resolves shared services in the image-deployment fixture', async () => {
    const root = await makeFixture();
    const envPath = join(root, 'compose.env');
    await writeFile(envPath, [
      'APP_DOMAIN=example.com',
      'API_DOMAIN=api.example.com',
      'API_URL=https://api.example.com',
      'SHORT_DOMAIN=short.example.com',
      'SHORT_LINKS_ENABLED=true',
      'CUSTOM_BACKEND_ENABLED=true',
      `SUBWEB_IMAGE=${dockerHubImage}`,
      `REDIS_IMAGE=${lockedImages.redis}`,
      `SUBCONVERTER_IMAGE=${lockedImages.subconverter}`,
      `MYURLS_IMAGE=${lockedImages.myurls}`,
      `IP_HASH_SECRET=${'a'.repeat(64)}`,
      `REDIS_PASSWORD=${'b'.repeat(64)}`,
      'TURNSTILE_SITE_KEY=test-site-key',
      'TURNSTILE_SECRET_KEY=test-secret-key',
      '',
    ].join('\n'));
    const environment = { ...process.env };
    for (const name of [
      'APP_DOMAIN', 'API_DOMAIN', 'API_URL', 'SHORT_DOMAIN', 'SHORT_LINKS_ENABLED',
      'CUSTOM_BACKEND_ENABLED', 'SUBWEB_IMAGE', 'REDIS_IMAGE', 'SUBCONVERTER_IMAGE',
      'MYURLS_IMAGE', 'IP_HASH_SECRET', 'REDIS_PASSWORD', 'TURNSTILE_SITE_KEY',
      'TURNSTILE_SECRET_KEY',
    ]) delete environment[name];

    const result = spawnSync(
      'docker',
      ['compose', '-f', 'compose.yaml', '--env-file', envPath, 'config', '--format', 'json'],
      { cwd: root, encoding: 'utf8', env: environment },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).services.subconverter.image).toBe(lockedImages.subconverter);
  });

  it('persists the selected image and pulls the three default services', async () => {
    const root = await makeFixture();
    const image = dockerHubImage;

    const result = runDeploy(root, ['--image', image]);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
     const environment = await readFile(join(root, '.env'), 'utf8');
     expect(environment).toContain(`SUBWEB_IMAGE=${image}\n`);
     expect(environment).toContain('REDIS_IMAGE=docker.io/library/redis:7.4.11-alpine@sha256:520775a41a63e77e06c73e35d2fd9cc15921a609516818796b4ecbb813078bc7\n');
     expect(environment).toContain('SUBCONVERTER_IMAGE=ghcr.io/aethersailor/subconverter-extended:v1.9.4@sha256:8e067383d26d6f3580e9255e13f11a83fd3500e9a3380eb69ae99af54c29f423\n');
     expect(environment).toContain('MYURLS_IMAGE=ghcr.io/keleyaa/myurls:v2.0.8@sha256:441aed70342b9071f4f64bdbb6fe7d659774c23f1f8bfd3db76c33936eb01d36\n');
    const dockerLog = await readFile(join(root, 'docker.log'), 'utf8');
    expect(dockerLog.trim().split('\n')).toEqual([
      'compose version',
      expect.stringMatching(/^compose -f compose\.yaml --env-file .+ config --quiet$/u),
      expect.stringMatching(/^compose -f compose\.yaml --env-file .+ config --format json$/u),
      'compose -f compose.yaml pull gateway subconverter myurls redis',
      'compose -f compose.yaml up -d --no-build --pull never --remove-orphans --wait',
      'compose -f compose.yaml ps',
    ]);
  });

  it.each([
    ['with short links enabled', []],
    ['with short links disabled', ['--disable-short-links']],
  ])('renders each direct digest %s without release resolution', async (_profile, profileArgs) => {
    const directImages = [dockerHubImage, ghcrImage, registryPortImage, taggedDigestImage];

    for (const image of directImages) {
      const root = await makeFixture();
      const result = runDeploy(root, ['--image', image, ...profileArgs], {
        CAPTURE_COMPOSE_GATEWAY_IMAGE: '1',
      });

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(await readFile(join(root, '.env'), 'utf8')).toContain(
        `SUBWEB_IMAGE=${image}\n`,
      );
      const log = await readDockerLog(root);
      expect(log).toContain(`COMPOSE_GATEWAY_IMAGE=${image}`);
      expect(log).not.toContain('buildx imagetools inspect');
    }
  });

  it('resolves a release version once and deploys the immutable digest', async () => {
    const root = await makeFixture();

    const result = runDeploy(root, ['--version', releaseVersion], {
      CAPTURE_COMPOSE_GATEWAY_IMAGE: '1',
      DOCKER_RELEASE_DIGEST: releaseDigest,
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readFile(join(root, '.env'), 'utf8')).toContain(
      `SUBWEB_IMAGE=ghcr.io/keleyaa/subweb@sha256:${releaseDigest}\n`,
    );
    const log = await readDockerLog(root);
    expect(log).toContain(
      `buildx imagetools inspect ghcr.io/keleyaa/subweb:${releaseVersion} --format {{.Manifest.Digest}}`,
    );
    expect(log.match(/^buildx version$/gm)).toHaveLength(1);
    expect(log.match(/^buildx imagetools inspect /gm)).toHaveLength(1);
    expect(log).toContain(`COMPOSE_GATEWAY_IMAGE=ghcr.io/keleyaa/subweb@sha256:${releaseDigest}`);
  });

  it('does not pass the Turnstile secret to release image resolution', async () => {
    const root = await makeFixture();

    const result = runDeploy(root, ['--version', releaseVersion], {
      DOCKER_INSPECT_READ_STDIN: '1',
      DOCKER_RELEASE_DIGEST: releaseDigest,
    });

    expect(result.status, `${result.stdout}\\n${result.stderr}`).toBe(0);
    const log = await readDockerLog(root);
    expect(log).toContain('BUILDX_INSPECT_STDIN=<none>');
    expect(log).not.toContain('BUILDX_INSPECT_STDIN=test-secret-key');
  });

  it('rejects --version together with --image before deployment or secret input', async () => {
    const root = await makeFixture();

    const result = runDeploy(root, [
      '--version', releaseVersion,
      '--image', dockerHubImage,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--version and --image may not be used together.');
    expect(await readFile(join(root, '.env'), 'utf8').catch(() => '')).toBe('');
    expect(await readDockerLog(root)).toBe('');
  });

  it('stops before secret input or deployment when release resolution fails', async () => {
    const root = await makeFixture();

    const result = runDeploy(root, ['--version', releaseVersion], {
      DOCKER_RESOLVE_STATUS: '23',
    }, '');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Unable to resolve release image: ghcr.io/keleyaa/subweb:${releaseVersion}`);
    expect(await readFile(join(root, '.env'), 'utf8').catch(() => '')).toBe('');
    const log = await readDockerLog(root);
    expect(log).not.toMatch(/compose|pull|up/);
  });

  it('rejects a malformed release digest before secret input or deployment', async () => {
    const root = await makeFixture();

    const result = runDeploy(root, ['--version', releaseVersion], {
      DOCKER_RELEASE_DIGEST: 'not-a-valid-digest',
    }, '');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `Unable to resolve immutable digest for: ghcr.io/keleyaa/subweb:${releaseVersion}`,
    );
    expect(result.stderr).not.toContain('Turnstile secret key must be provided on stdin');
    expect(await readFile(join(root, '.env'), 'utf8').catch(() => '')).toBe('');
    const log = await readDockerLog(root);
    expect(log).toBe([
      'buildx version',
      `buildx imagetools inspect ghcr.io/keleyaa/subweb:${releaseVersion} --format {{.Manifest.Digest}}`,
      '',
    ].join('\n'));
    expect(log).not.toMatch(/compose|pull|up/);
  });

  it('rejects duplicate or missing --version values before invoking Docker', async () => {
    const root = await makeFixture();

    const duplicate = runDeploy(root, ['--version', releaseVersion, '--version', 'v2.3.4']);
    const missing = runDeploy(root, ['--version']);

    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain('--version may be provided only once.');
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('--version requires a value.');
    expect(await readDockerLog(root)).toBe('');
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
SUBWEB_IMAGE=${dockerHubImage}
TURNSTILE_SITE_KEY=test-site-key
TURNSTILE_SECRET_KEY=test-secret-key
IP_HASH_SECRET=${'a'.repeat(64)}
REDIS_PASSWORD=${'b'.repeat(64)}
EOF
`);
    await chmod(join(root, 'scripts/configure.sh'), 0o755);

    const result = runDeploy(root, ['--image', dockerHubImage], {
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
    const selectedImage = dockerHubImage;
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

  it('requires an immutable Gateway digest instead of silently deploying a tag', async () => {
    const root = await makeFixture();

    const missing = runDeploy(root);
    const mutable = runDeploy(root, ['--image', 'docker.io/keleyaa/subweb:latest']);

    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toBe(
      'Docker deployment error: --image is required and must use an immutable sha256 digest.\n',
    );
    expect(mutable.status).not.toBe(0);
    expect(mutable.stderr).toBe(immutableDigestError);
    const invalidProxy = runDeploy(root, [
      '--image', dockerHubImage,
      '--trusted-proxy-cidr', '0.0.0.0/0',
    ]);
    expect(invalidProxy.status).not.toBe(0);
    expect(invalidProxy.stderr).toContain('TRUSTED_PROXY_CIDR');
    const invalidProxyLog = await readFile(join(root, 'docker.log'), 'utf8');
    expect(invalidProxyLog).toBe('compose version\n');
  });

  it.each([
    ['sha tag', 'docker.io/keleyaa/subweb:sha-2bf1a9f'],
    ['latest tag', 'docker.io/keleyaa/subweb:latest'],
    ['malformed registry port', `registry.example:not-a-port/repository@sha256:${releaseDigest}`],
    ['registry port 0', `registry.example:0/repository@sha256:${releaseDigest}`],
    ['registry port 65536', `registry.example:65536/repository@sha256:${releaseDigest}`],
  ])('rejects a %s before reading Turnstile input or starting deployment', async (_kind, image) => {
    const root = await makeFixture();

    const result = runDeploy(root, ['--image', image], {}, '');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe(immutableDigestError);
    expect(result.stderr).not.toContain('Turnstile secret key must be provided on stdin.');
    expect(await readFile(join(root, '.env'), 'utf8').catch(() => '')).toBe('');
    expect(await readDockerLog(root)).toBe('');
  });

  it('renders the selected direct image through the real disabled Compose profile after fake deployment', async () => {
    const root = await makeFixture();
    const deployment = runDeploy(root, [
      '--image', disabledProfileImage,
      '--disable-short-links',
    ], {}, '');

    expect(deployment.status, `${deployment.stdout}\n${deployment.stderr}`).toBe(0);
    const environment = { ...process.env };
    for (const name of composeInterpolationVariables) delete environment[name];
    const rendered = spawnSync('docker', [
      'compose', '-f', 'compose.disabled-short-links.yaml', '--env-file',
      '.env', 'config', '--format', 'json',
    ], { cwd: root, encoding: 'utf8', env: environment });

    expect(rendered.status, rendered.stderr).toBe(0);
    const config = JSON.parse(rendered.stdout);
    expect(Object.keys(config.services).sort()).toEqual(['gateway', 'subconverter']);
    expect(config.services.gateway.image).toBe(disabledProfileImage);
  });

  it('deploys only Gateway and SubConverter when short links are disabled', async () => {
    const root = await makeFixture();
    const result = runDeploy(root, ['--image', dockerHubImage, '--disable-short-links'], {}, '');

    expect(result.status, `${result.stdout}\\n${result.stderr}`).toBe(0);
    const env = await readFile(join(root, '.env'), 'utf8');
    expect(env).toContain('SHORT_LINKS_ENABLED=false\n');
    expect(env).not.toMatch(/(?:SHORT_DOMAIN|TURNSTILE_|IP_HASH_SECRET|REDIS_PASSWORD)=/);
    const log = await readFile(join(root, 'docker.log'), 'utf8');
    expect(log).toContain('compose -f compose.disabled-short-links.yaml pull gateway subconverter');
    expect(log).toContain('compose -f compose.disabled-short-links.yaml up -d --no-build --pull never --remove-orphans --wait');
    expect(log).not.toContain('compose -f compose.yaml pull');
  });

  it('overrides a stale disabled profile when short links are explicitly enabled', async () => {
    const root = await makeFixture();
    await writeFile(join(root, '.env'), 'SHORT_LINKS_ENABLED=false\n');

    const result = runDeploy(root, [
      '--image', dockerHubImage,
      '--short-links-enabled', 'true',
    ]);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readFile(join(root, '.env'), 'utf8')).toContain(
      'SHORT_LINKS_ENABLED=true\n',
    );
    const log = await readDockerLog(root);
    expect(log).toContain('compose -f compose.yaml pull gateway subconverter myurls redis');
    expect(log).toContain('compose -f compose.yaml up -d --no-build --pull never --remove-orphans --wait');
    expect(log).not.toContain('compose -f compose.disabled-short-links.yaml pull');
  });

  it('does not start containers when pulling an image fails', async () => {
    const root = await makeFixture();

    const result = runDeploy(root, ['--image', dockerHubImage], { DOCKER_PULL_STATUS: '23' });

    expect(result.status).not.toBe(0);
    const log = await readFile(join(root, 'docker.log'), 'utf8');
    expect(log).toContain('compose -f compose.yaml pull gateway subconverter myurls redis');
    expect(log).not.toContain('compose up');
  });
});
