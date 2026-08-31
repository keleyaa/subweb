import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const validatorPath = fileURLToPath(new URL('../../scripts/validate-compose.sh', import.meta.url));
const temporaryDirectories = [];
const validCompose = {
  networks: {
    default: {},
    'myurls-data': { internal: true },
    'myurls-edge': { internal: true },
    'redis-policy': { internal: true },
    'subconverter-egress': { internal: true },
  },
  services: {
    gateway: {
      ports: [{ target: 8080, published: '18080', host_ip: '127.0.0.1' }],
      networks: { default: {}, 'myurls-edge': {} },
    },
    redis: { image: 'redis', networks: { 'myurls-data': {}, 'redis-policy': {} } },
    'myurls-app': { image: 'myurls', networks: { 'myurls-data': {}, 'myurls-edge': {} } },
    'myurls-short': { image: 'myurls', networks: { 'myurls-data': {}, 'myurls-edge': {} } },
    subconverter: { image: 'subconverter', networks: { 'subconverter-egress': {} } },
    'request-policy': { image: 'request-policy', networks: { default: {}, 'redis-policy': {}, 'subconverter-egress': {} } },
  },
};

const createFixture = async (composeJson) => {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-compose-single-'));
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
  return { directory, env: { ...process.env, PATH: `${binDirectory}${delimiter}${process.env.PATH}`, DOCKER_CALL_LOG: join(directory, 'docker-calls.log'), COMPOSE_JSON_FIXTURE: jsonPath } };
};

afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('single gateway Compose validation', () => {
  it('validates the fixed gateway with generated non-secret placeholders when .env is absent', async () => {
    const fixture = await createFixture(validCompose);
    const result = await import('node:child_process').then(({ spawnSync }) => spawnSync('sh', [validatorPath], { cwd: fixture.directory, encoding: 'utf8', env: fixture.env }));
    expect(result.status).toBe(0);
    expect(await readFile(fixture.env.DOCKER_CALL_LOG, 'utf8')).toMatch(/^compose --env-file .+ config --quiet\ncompose --env-file .+ config --format json\n$/u);
  });

  it.each([
    ['two published gateways', { ...validCompose, services: { ...validCompose.services, debug: { ports: [{ target: 9000, published: '9000' }] } } }],
    ['published internal service', { ...validCompose, services: { ...validCompose.services, redis: { ports: [{ target: 6379, published: '6379' }] } } }],
    ['unapproved published service', { ...validCompose, services: { ...validCompose.services, debug: { ports: [{ target: 9000, published: '9000' }] }, gateway: {} } }],
    ['missing internal service', { services: { gateway: validCompose.services.gateway, redis: {}, 'myurls-app': {} } }],
      ['missing gateway', { services: { redis: {}, 'myurls-app': {}, 'myurls-short': {}, subconverter: {}, 'request-policy': {} } }],
  ])('rejects rendered Compose JSON with %s', async (_name, composeJson) => {
    const fixture = await createFixture(composeJson);
    const result = await import('node:child_process').then(({ spawnSync }) => spawnSync('sh', [validatorPath], { cwd: fixture.directory, encoding: 'utf8', env: fixture.env }));
    expect(result.status).not.toBe(0);
  });

  it.each([
    ['string', '6379'], ['object', { target: 6379 }], ['null', null],
  ])('rejects internal service ports expressed as %s', async (_name, ports) => {
    const composeJson = structuredClone(validCompose);
    composeJson.services.redis.ports = ports;
    const fixture = await createFixture(composeJson);
    const result = await import('node:child_process').then(({ spawnSync }) => spawnSync('sh', [validatorPath], { cwd: fixture.directory, encoding: 'utf8', env: fixture.env }));
    expect(result.status).not.toBe(0);
  });

  it.each([
    ['missing myurls-data network', (composeJson) => { delete composeJson.networks['myurls-data']; }],
    ['non-internal myurls-data network', (composeJson) => { composeJson.networks['myurls-data'].internal = false; }],
    ['missing redis-policy network', (composeJson) => { delete composeJson.networks['redis-policy']; }],
    ['Redis on default network', (composeJson) => { composeJson.services.redis.networks.default = {}; }],
    ['Gateway on redis-policy network', (composeJson) => { composeJson.services.gateway.networks['redis-policy'] = {}; }],
    ['Request Policy without redis-policy network', (composeJson) => { delete composeJson.services['request-policy'].networks['redis-policy']; }],
    ['myurls app on default network', (composeJson) => { composeJson.services['myurls-app'].networks.default = {}; }],
    ['gateway on myurls-data network', (composeJson) => { composeJson.services.gateway.networks['myurls-data'] = {}; }],
    ['SubConverter on default network', (composeJson) => { composeJson.services.subconverter.networks.default = {}; }],
    ['Request Policy on MyUrls data network', (composeJson) => { composeJson.services['request-policy'].networks['myurls-data'] = {}; }],
  ])('rejects an unsafe MyUrls network topology: %s', async (_name, mutate) => {
    const composeJson = structuredClone(validCompose);
    mutate(composeJson);
    const fixture = await createFixture(composeJson);
    const result = await import('node:child_process').then(({ spawnSync }) => spawnSync('sh', [validatorPath], { cwd: fixture.directory, encoding: 'utf8', env: fixture.env }));
    expect(result.status).not.toBe(0);
  });

  it.each([
    ['string', '8080'], ['object', { target: 8080 }], ['null', null], ['empty array', []],
  ])('rejects gateway ports expressed as %s', async (_name, ports) => {
    const composeJson = structuredClone(validCompose);
    composeJson.services.gateway.ports = ports;
    const fixture = await createFixture(composeJson);
    const result = await import('node:child_process').then(({ spawnSync }) => spawnSync('sh', [validatorPath], { cwd: fixture.directory, encoding: 'utf8', env: fixture.env }));
    expect(result.status).not.toBe(0);
  });

  it.each([
    ['wrong target', (port) => { port.target = 80; }],
    ['wildcard host', (port) => { port.host_ip = '0.0.0.0'; }],
    ['missing host binding', (port) => { delete port.host_ip; }],
    ['invalid published port', (port) => { port.published = '65536'; }],
  ])('rejects an unsafe gateway binding: %s', async (_name, mutate) => {
    const composeJson = structuredClone(validCompose);
    mutate(composeJson.services.gateway.ports[0]);
    const fixture = await createFixture(composeJson);
    const result = await import('node:child_process').then(({ spawnSync }) => spawnSync('sh', [validatorPath], { cwd: fixture.directory, encoding: 'utf8', env: fixture.env }));
    expect(result.status).not.toBe(0);
  });
});
