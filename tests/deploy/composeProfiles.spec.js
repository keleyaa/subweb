import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
      environment: { TZ: 'Asia/Shanghai', EGRESS_LISTEN_ADDR: '0.0.0.0:25502' },
    },
    redis: {
      image: 'redis@sha256:abc', user: '999:1000', networks: { 'myurls-data': {}, 'redis-policy': {} },
      read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    },
     'myurls-app': { image: 'myurls@sha256:abc', user: '10001:10001', networks: { 'myurls-data': {}, 'myurls-edge': {} }, read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] },
     'myurls-short': { image: 'myurls@sha256:abc', user: '10001:10001', networks: { 'myurls-data': {}, 'myurls-edge': {} }, read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] },
     subconverter: { image: 'subconverter@sha256:abc', user: '101:101', networks: { 'subconverter-egress': {} }, environment: { HTTPS_PROXY: 'http://gateway:25502' }, read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] },
  },
};

const validateFixture = async (composeJson, shortLinksEnabled = 'true') => {
  const fixture = await createFixture(composeJson, shortLinksEnabled);
  const result = spawnSync('sh', [validatorPath], { cwd: fixture.directory, encoding: 'utf8', env: fixture.env });
  return { fixture, result };
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('unified Compose validation', () => {
  it('validates the five-container production topology', async () => {
    const { result } = await validateFixture(validCompose);
    expect(result.status).toBe(0);
  });

  it('validates the two-service short-links-disabled topology', async () => {
    const disabled = structuredClone(validCompose);
    delete disabled.services.redis;
    delete disabled.services['myurls-app'];
    delete disabled.services['myurls-short'];
    disabled.services.gateway.networks = { default: {}, 'subconverter-egress': {} };
    delete disabled.networks['myurls-data'];
    delete disabled.networks['myurls-edge'];
    delete disabled.networks['redis-policy'];
    const { result } = await validateFixture(disabled, 'false');
    expect(result.status).toBe(0);
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
});
