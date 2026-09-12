import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const validatorPath = new URL('../../scripts/validate-compose.sh', import.meta.url).pathname;
const temporaryDirectories = [];

const createFixture = async (composeJson, shortLinksEnabled = 'true') => {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-compose-validation-'));
  temporaryDirectories.push(directory);
  const binDirectory = join(directory, 'bin');
  await (await import('node:fs/promises')).mkdir(binDirectory);
  const dockerPath = join(binDirectory, 'docker');
  await writeFile(dockerPath, `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALL_LOG"
case "$*" in
  'compose -f '*" config --quiet" | 'compose --env-file '*" config --quiet") exit 0 ;;
  'compose -f '*" config --format json" | 'compose --env-file '*" config --format json") cat "$COMPOSE_JSON_FIXTURE" ;;
  *) exit 91 ;;
esac
`);
  await (await import('node:fs/promises')).chmod(dockerPath, 0o755);
  const jsonPath = join(directory, 'compose.json');
  await writeFile(jsonPath, JSON.stringify(composeJson));
  const envPath = join(directory, '.env');
  await writeFile(envPath, [
    'APP_DOMAIN=app.validation.test', 'API_DOMAIN=api.validation.test',
    'SHORT_DOMAIN=short.validation.test', 'API_URL=https://api.validation.test',
    `SHORT_LINKS_ENABLED=${shortLinksEnabled}`, 'REDIS_PASSWORD=validation-password',
    'IP_HASH_SECRET=' + '0123456789abcdef'.repeat(4), 'TURNSTILE_SITE_KEY=validation-site-key',
    'TURNSTILE_SECRET_KEY=validation-secret-key', ''
  ].join('\n'));
  return {
    directory,
    env: {
      ...process.env,
      PATH: `${binDirectory}${delimiter}${process.env.PATH}`,
      DOCKER_CALL_LOG: join(directory, 'docker-calls.log'),
      COMPOSE_JSON_FIXTURE: jsonPath,
      COMPOSE_VALIDATION_FILE: 'compose.yaml',
      SHORT_LINKS_ENABLED: shortLinksEnabled,
    },
    envPath,
  };
};

const validCompose = {
  networks: {
    default: {}, 'myurls-data': { internal: true }, 'myurls-edge': { internal: true },
    'redis-policy': { internal: true }, 'subconverter-egress': { internal: true },
  },
  services: {
    gateway: {
      image: 'subweb:local',
      user: '65532:65532',
      ports: [{ target: 8080, published: '18080', host_ip: '127.0.0.1' }],
      networks: { default: {}, 'myurls-edge': {}, 'redis-policy': {}, 'subconverter-egress': {} },
      read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
      environment: {
        TZ: 'Asia/Shanghai',
        EGRESS_LISTEN_ADDR: '0.0.0.0:25502',
        EGRESS_RESTRICTED_LISTEN_ADDR: '0.0.0.0:25503',
        EGRESS_ALLOWED_HOSTS: 'challenges.cloudflare.com',
        SHORT_LINKS_ENABLED: 'true',
        APP_DOMAIN: 'app.validation.test',
        SHORT_DOMAIN: 'short.validation.test',
        MYURLS_UPSTREAM: 'http://myurls-edge:3000',
      },
      depends_on: {
        redis: { condition: 'service_healthy', restart: true },
        'myurls': { condition: 'service_healthy', restart: true },
      },
    },
    redis: {
      image: 'docker.io/library/redis:8.10.1@sha256:298e5b3bc566bade82f46ad5511777a4a07a294097ce16ada2f6a42be5239df5', user: '999:1000', networks: { 'myurls-data': {}, 'redis-policy': {} },
      read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    },
     'myurls': { environment: { NODE_ENV: 'production', HTTPS_PROXY: 'http://gateway:25503', https_proxy: 'http://gateway:25503', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', PUBLIC_BASE_URL: 'https://short.validation.test', TURNSTILE_HOSTNAME: 'app.validation.test', TURNSTILE_ENABLED: 'true', TURNSTILE_MODE: 'cloudflare', TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'secret-key' }, image: 'ghcr.io/keleyaa/myurls:v2.0.8@sha256:441aed70342b9071f4f64bdbb6fe7d659774c23f1f8bfd3db76c33936eb01d36', user: '10001:10001', networks: { 'myurls-data': {}, 'myurls-edge': {} }, read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] },
      subconverter: { image: 'ghcr.io/aethersailor/subconverter-extended:v1.9.4@sha256:8e067383d26d6f3580e9255e13f11a83fd3500e9a3380eb69ae99af54c29f423', user: '0:0', cap_add: ['CHOWN', 'SETUID', 'SETGID'], networks: { 'subconverter-egress': {} }, environment: { HTTPS_PROXY: 'http://gateway:25502' }, depends_on: { gateway: { condition: 'service_healthy', restart: true } }, read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] },
  },
};

const disabledCompose = () => {
  const disabled = structuredClone(validCompose);
  delete disabled.services.redis;
  delete disabled.services['myurls'];
  delete disabled.services.gateway.depends_on;
  disabled.services.gateway.environment.SHORT_LINKS_ENABLED = 'false';
  disabled.services.gateway.networks = { default: {}, 'subconverter-egress': {} };
  delete disabled.networks['myurls-data'];
  delete disabled.networks['myurls-edge'];
  delete disabled.networks['redis-policy'];
  return disabled;
};

const validateFixture = async (composeJson, shortLinksEnabled = 'true', environment = {}) => {
  const fixture = await createFixture(composeJson, shortLinksEnabled);
  const result = spawnSync('sh', [validatorPath], {
    cwd: fixture.directory,
    encoding: 'utf8',
    env: { ...fixture.env, ...environment },
  });
  return { fixture, result };
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('unified Compose validation', () => {
  it.each([
    ['PUBLIC_BASE_URL', 'https://app.validation.test'],
    ['TURNSTILE_HOSTNAME', 'short.validation.test'],
    ['TURNSTILE_ENABLED', 'false'],
    ['TURNSTILE_MODE', 'test'],
    ['TURNSTILE_SECRET_KEY', ''],
    ['NODE_ENV', 'development'],
  ])('rejects invalid single-instance MyUrls %s', async (name, value) => {
    const candidate = structuredClone(validCompose);
    candidate.services.myurls.environment[name] = value;
    const { result } = await validateFixture(candidate);
    expect(result.status).not.toBe(0);
  });

  it('rejects a Gateway pointed outside the sole MyUrls service', async () => {
    const candidate = structuredClone(validCompose);
    candidate.services.gateway.environment.MYURLS_UPSTREAM = 'http://unexpected:3000';
    const { result } = await validateFixture(candidate);
    expect(result.status).not.toBe(0);
  });

  it('validates the four-container production topology', async () => {
    const { result } = await validateFixture(validCompose);
    expect(result.status).toBe(0);
  });

  it('validates the two-service short-links-disabled topology', async () => {
    const { result } = await validateFixture(disabledCompose(), 'false');
    expect(result.status).toBe(0);
  });

  it('derives the disabled profile from rendered Gateway configuration, not its parent shell', async () => {
    const { result } = await validateFixture(disabledCompose(), 'false', { SHORT_LINKS_ENABLED: 'true' });
    expect(result.status).toBe(0);
  });

  it('selects the disabled Compose file from generated configuration without an entrypoint wrapper', async () => {
    const fixture = await createFixture(disabledCompose(), 'false');
    delete fixture.env.COMPOSE_VALIDATION_FILE;
    const result = spawnSync('sh', [validatorPath], {
      cwd: fixture.directory,
      encoding: 'utf8',
      env: fixture.env,
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readFile(fixture.env.DOCKER_CALL_LOG, 'utf8')).toContain(
      'compose -f compose.disabled-short-links.yaml config --format json',
    );
  });

  it('rejects a four-service topology whose rendered Gateway disables short links', async () => {
    const composeJson = structuredClone(validCompose);
    composeJson.services.gateway.environment.SHORT_LINKS_ENABLED = 'false';
    const { result } = await validateFixture(composeJson);
    expect(result.status).not.toBe(0);
  });

  it.each([
    ['an extra service', { ...validCompose, services: { ...validCompose.services, debug: { networks: { default: {} } } } }],
    ['a missing internal service', { ...validCompose, services: { ...validCompose.services, redis: undefined } }],
    ['a second published service', { ...validCompose, services: { ...validCompose.services, debug: { ports: [{ target: 9000, published: '9000' }], networks: { default: {} } } } }],
    ['a published internal service', { ...validCompose, services: { ...validCompose.services, redis: { ...validCompose.services.redis, ports: [{ target: 6379, published: '6379' }] } } }],
  ])('rejects rendered Compose JSON with %s', async (_name, composeJson) => {
    const { result } = await validateFixture(composeJson);
    expect(result.status).not.toBe(0);
  });

  it('rejects an external image that is not from the version lock', async () => {
    const composeJson = structuredClone(validCompose);
    composeJson.services.redis.image = 'docker.io/library/redis:latest@sha256:abc';
    const { result } = await validateFixture(composeJson);
    expect(result.status).not.toBe(0);
  });

  it('rejects a mutable Gateway image', async () => {
    const composeJson = structuredClone(validCompose);
    composeJson.services.gateway.image = 'ghcr.io/example/subweb:latest';
    const { result } = await validateFixture(composeJson);
    expect(result.status).not.toBe(0);
  });

  it('rejects a gateway binding that is not loopback port 8080', async () => {
    const composeJson = structuredClone(validCompose);
    composeJson.services.gateway.ports[0].host_ip = '0.0.0.0';
    const { result } = await validateFixture(composeJson);
    expect(result.status).not.toBe(0);
  });

  it('does not allow a public network for the internal service boundary', async () => {
    const composeJson = structuredClone(validCompose);
    composeJson.networks['myurls-edge'].internal = false;
    const { result } = await validateFixture(composeJson);
    expect(result.status).not.toBe(0);
  });

  it('rejects a root runtime user', async () => {
    const composeJson = structuredClone(validCompose);
    composeJson.services.gateway.user = '0:0';
    const { result } = await validateFixture(composeJson);
    expect(result.status).not.toBe(0);
  });

  it('rejects a reverse Gateway/SubConverter startup dependency', async () => {
    const composeJson = structuredClone(validCompose);
    delete composeJson.services.subconverter.depends_on;
    composeJson.services.gateway.depends_on = {
      subconverter: { condition: 'service_healthy', restart: true },
    };
    const { result } = await validateFixture(composeJson);
    expect(result.status).not.toBe(0);
  });
});
