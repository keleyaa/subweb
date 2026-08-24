import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const validatorPath = fileURLToPath(new URL('../../scripts/validate-compose.sh', import.meta.url));
const temporaryDirectories = [];
const validCompose = {
  services: {
    gateway: { ports: [{ target: 8080, published: '18080', host_ip: '127.0.0.1' }] },
    redis: { image: 'redis' }, myurls: { image: 'myurls' }, subconverter: { image: 'subconverter' },
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
  'compose config --quiet') exit 0 ;;
  'compose config --format json') cat "$COMPOSE_JSON_FIXTURE" ;;
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
  it('validates the fixed gateway without reading profiles', async () => {
    const fixture = await createFixture(validCompose);
    const result = await import('node:child_process').then(({ spawnSync }) => spawnSync('sh', [validatorPath], { cwd: fixture.directory, encoding: 'utf8', env: fixture.env }));
    expect(result.status).toBe(0);
    expect(await readFile(fixture.env.DOCKER_CALL_LOG, 'utf8')).toBe('compose config --quiet\ncompose config --format json\n');
  });

  it.each([
    ['two published gateways', { ...validCompose, services: { ...validCompose.services, debug: { ports: [{ target: 9000, published: '9000' }] } } }],
    ['published internal service', { ...validCompose, services: { ...validCompose.services, redis: { ports: [{ target: 6379, published: '6379' }] } } }],
    ['unapproved published service', { ...validCompose, services: { ...validCompose.services, debug: { ports: [{ target: 9000, published: '9000' }] }, gateway: {} } }],
    ['missing internal service', { services: { gateway: validCompose.services.gateway, redis: {}, myurls: {} } }],
    ['missing gateway', { services: { redis: {}, myurls: {}, subconverter: {} } }],
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
    ['string', '8080'], ['object', { target: 8080 }], ['null', null], ['empty array', []],
  ])('rejects gateway ports expressed as %s', async (_name, ports) => {
    const composeJson = structuredClone(validCompose);
    composeJson.services.gateway.ports = ports;
    const fixture = await createFixture(composeJson);
    const result = await import('node:child_process').then(({ spawnSync }) => spawnSync('sh', [validatorPath], { cwd: fixture.directory, encoding: 'utf8', env: fixture.env }));
    expect(result.status).not.toBe(0);
  });
});
