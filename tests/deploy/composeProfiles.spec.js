import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const validatorPath = fileURLToPath(
  new URL('../../scripts/validate-compose.sh', import.meta.url),
);
const temporaryDirectories = [];

const createFixture = async (composeJson) => {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-compose-profile-'));
  temporaryDirectories.push(directory);
  const binDirectory = join(directory, 'bin');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(binDirectory));
  const dockerPath = join(binDirectory, 'docker');
  const dockerScript = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALL_LOG"
case "$*" in
  'compose config --quiet') exit 0 ;;
  'compose config --format json') cat "$COMPOSE_JSON_FIXTURE" ;;
  *) exit 91 ;;
esac
`;
  await writeFile(dockerPath, dockerScript);
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

const validComposeFor = (profile) => ({
  services: {
    [profile === 'behind-proxy' ? 'gateway-http' : 'gateway-tls']: {
      ports: [{ target: profile === 'behind-proxy' ? 8080 : 8443, published: '18080' }],
    },
    redis: { image: 'redis' },
    myurls: { image: 'myurls' },
    subconverter: { image: 'subconverter' },
  },
});

const validCompose = validComposeFor('behind-proxy');

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Compose profile validation', () => {
  it.each(['', 'behind-proxy,direct-tls', 'behind-proxy direct-tls', 'other']) (
    'rejects invalid profile value %j before invoking Docker',
    async (profile) => {
      const fixture = await createFixture(validComposeFor(profile));
      const result = spawnSync('sh', [validatorPath], {
        cwd: fixture.directory,
        encoding: 'utf8',
        env: { ...fixture.env, COMPOSE_PROFILES: profile },
      });

      expect(result.status).not.toBe(0);
      await expect(readFile(fixture.env.DOCKER_CALL_LOG, 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('reads one exact profile value from .env without evaluating it', async () => {
    const fixture = await createFixture(validCompose);
    const marker = join(fixture.directory, 'sourced-marker');
    await writeFile(
      join(fixture.directory, '.env'),
      `UNTRUSTED=$(touch ${marker})\nCOMPOSE_PROFILES=behind-proxy\n`,
    );

    const result = spawnSync('sh', [validatorPath], {
      cwd: fixture.directory,
      encoding: 'utf8',
      env: { ...fixture.env, COMPOSE_PROFILES: undefined },
    });

    expect(result.status).toBe(0);
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(fixture.env.DOCKER_CALL_LOG, 'utf8')).toBe(
      'compose config --quiet\ncompose config --format json\n',
    );
  });

  it.each(['behind-proxy', 'direct-tls'])(
    'accepts the single %s profile and validates Docker output in order',
    async (profile) => {
      const fixture = await createFixture(validComposeFor(profile));
      const result = spawnSync('sh', [validatorPath], {
        cwd: fixture.directory,
        encoding: 'utf8',
        env: { ...fixture.env, COMPOSE_PROFILES: profile },
      });

      expect(result.status).toBe(0);
      expect(await readFile(fixture.env.DOCKER_CALL_LOG, 'utf8')).toBe(
        'compose config --quiet\ncompose config --format json\n',
      );
    },
  );

  it.each([
    ['two published gateways', {
      ...validCompose,
      services: {
        ...validCompose.services,
        'gateway-tls': { ports: [{ target: 8443, published: '443' }] },
      },
    }],
    ['published internal service', {
      ...validCompose,
      services: {
        ...validCompose.services,
        redis: { ports: [{ target: 6379, published: '6379' }] },
      },
    }],
    ['unapproved published service', {
      ...validCompose,
      services: {
        ...validCompose.services,
        debug: { ports: [{ target: 9000, published: '9000' }] },
      },
    }],
    ['missing internal service', {
      services: {
        'gateway-http': validCompose.services['gateway-http'],
        redis: {},
        myurls: {},
      },
    }],
  ])('rejects rendered Compose JSON with %s', async (_name, composeJson) => {
    const fixture = await createFixture(composeJson);
    const result = spawnSync('sh', [validatorPath], {
      cwd: fixture.directory,
      encoding: 'utf8',
      env: { ...fixture.env, COMPOSE_PROFILES: 'behind-proxy' },
    });

    expect(result.status).not.toBe(0);
  });

  it('rejects a gateway that does not match the selected profile', async () => {
    const fixture = await createFixture(validComposeFor('behind-proxy'));
    const result = spawnSync('sh', [validatorPath], {
      cwd: fixture.directory,
      encoding: 'utf8',
      env: { ...fixture.env, COMPOSE_PROFILES: 'direct-tls' },
    });

    expect(result.status).not.toBe(0);
  });

  it.each([
    ['string', '6379'],
    ['object', { target: 6379 }],
    ['null', null],
  ])('rejects internal service ports expressed as %s', async (_name, ports) => {
    const composeJson = validComposeFor('behind-proxy');
    composeJson.services.redis.ports = ports;
    const fixture = await createFixture(composeJson);

    const result = spawnSync('sh', [validatorPath], {
      cwd: fixture.directory,
      encoding: 'utf8',
      env: { ...fixture.env, COMPOSE_PROFILES: 'behind-proxy' },
    });

    expect(result.status).not.toBe(0);
  });

  it.each([
    ['string', '8443'],
    ['object', { target: 8443 }],
    ['null', null],
    ['empty array', []],
  ])('rejects expected gateway ports expressed as %s', async (_name, ports) => {
    const composeJson = validComposeFor('direct-tls');
    composeJson.services['gateway-tls'].ports = ports;
    const fixture = await createFixture(composeJson);

    const result = spawnSync('sh', [validatorPath], {
      cwd: fixture.directory,
      encoding: 'utf8',
      env: { ...fixture.env, COMPOSE_PROFILES: 'direct-tls' },
    });

    expect(result.status).not.toBe(0);
  });

  it.each([
    ['string', '8443'],
    ['object', { target: 8443 }],
    ['null', null],
  ])('rejects inactive gateway ports expressed as %s', async (_name, ports) => {
    const composeJson = validComposeFor('behind-proxy');
    composeJson.services['gateway-tls'] = { ports };
    const fixture = await createFixture(composeJson);

    const result = spawnSync('sh', [validatorPath], {
      cwd: fixture.directory,
      encoding: 'utf8',
      env: { ...fixture.env, COMPOSE_PROFILES: 'behind-proxy' },
    });

    expect(result.status).not.toBe(0);
  });
});
