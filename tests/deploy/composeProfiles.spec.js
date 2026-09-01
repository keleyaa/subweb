import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const validatorPath = fileURLToPath(new URL('../../scripts/validate-compose.sh', import.meta.url));
const temporaryDirectories = [];
const validCompose = {
  networks: { default: {} },
  services: {
    subweb: {
      ports: [{ target: 8080, published: '18080', host_ip: '127.0.0.1' }],
      networks: { default: {} },
    },
    redis: { image: 'redis', networks: { default: {} } },
    myurls: { image: 'myurls', networks: { default: {} } },
  },
};

const createFixture = async (composeJson) => {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-compose-simple-'));
  temporaryDirectories.push(directory);
  const binDirectory = join(directory, 'bin');
  await (await import('node:fs/promises')).mkdir(binDirectory);
  const dockerPath = join(binDirectory, 'docker');
  await writeFile(dockerPath, `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALL_LOG"
case "$*" in
  'compose config --quiet' | 'compose --env-file '*" config --quiet") exit 0 ;;
  'compose config --format json' | 'compose --env-file '*" config --format json") cat "$COMPOSE_JSON_FIXTURE" ;;
  *) exit 91 ;;
esac
`);
  await chmod(dockerPath, 0o755);
  const jsonPath = join(directory, 'compose.json');
  await writeFile(jsonPath, JSON.stringify(composeJson));
  return {
    directory,
    env: {
      ...process.env,
      PATH: `${binDirectory}${delimiter}${process.env.PATH}`,
      DOCKER_CALL_LOG: join(directory, 'docker-calls.log'),
      COMPOSE_JSON_FIXTURE: jsonPath,
    },
  };
};

const validateFixture = async (composeJson) => {
  const fixture = await createFixture(composeJson);
  const { spawnSync } = await import('node:child_process');
  return {
    fixture,
    result: spawnSync('sh', [validatorPath], { cwd: fixture.directory, encoding: 'utf8', env: fixture.env }),
  };
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('simple Compose validation', () => {
  it('validates the three-service default with generated non-secret placeholders when .env is absent', async () => {
    const { fixture, result } = await validateFixture(validCompose);

    expect(result.status).toBe(0);
    expect(await readFile(fixture.env.DOCKER_CALL_LOG, 'utf8')).toMatch(/^compose --env-file .+ config --quiet\ncompose --env-file .+ config --format json\n$/u);
  });

  it.each([
    ['an extra service', { ...validCompose, services: { ...validCompose.services, debug: { networks: { default: {} } } } }],
    ['a missing internal service', { services: { subweb: validCompose.services.subweb, redis: validCompose.services.redis } }],
    ['a missing public service', { services: { redis: validCompose.services.redis, myurls: validCompose.services.myurls } }],
    ['a second published service', { ...validCompose, services: { ...validCompose.services, debug: { ports: [{ target: 9000, published: '9000' }], networks: { default: {} } } } }],
    ['a published internal service', { ...validCompose, services: { ...validCompose.services, redis: { ports: [{ target: 6379, published: '6379' }], networks: { default: {} } } } }],
  ])('rejects rendered Compose JSON with %s', async (_name, composeJson) => {
    const { result } = await validateFixture(composeJson);
    expect(result.status).not.toBe(0);
  });

  it.each([
    ['string', '8080'], ['object', { target: 8080 }], ['null', null], ['empty array', []],
  ])('rejects subweb ports expressed as %s', async (_name, ports) => {
    const composeJson = structuredClone(validCompose);
    composeJson.services.subweb.ports = ports;
    const { result } = await validateFixture(composeJson);
    expect(result.status).not.toBe(0);
  });

  it.each([
    ['wrong target', (port) => { port.target = 80; }],
    ['wildcard host', (port) => { port.host_ip = '0.0.0.0'; }],
    ['missing host binding', (port) => { delete port.host_ip; }],
    ['invalid published port', (port) => { port.published = '65536'; }],
  ])('rejects an unsafe subweb binding: %s', async (_name, mutate) => {
    const composeJson = structuredClone(validCompose);
    mutate(composeJson.services.subweb.ports[0]);
    const { result } = await validateFixture(composeJson);
    expect(result.status).not.toBe(0);
  });

  it.each([
    ['a missing default network', (composeJson) => { delete composeJson.services.myurls.networks.default; }],
    ['an extra network', (composeJson) => { composeJson.services.redis.networks.private = {}; }],
    ['an internal default network', (composeJson) => { composeJson.networks.default.internal = true; }],
  ])('rejects an unsafe simple network topology: %s', async (_name, mutate) => {
    const composeJson = structuredClone(validCompose);
    mutate(composeJson);
    const { result } = await validateFixture(composeJson);
    expect(result.status).not.toBe(0);
  });
});
