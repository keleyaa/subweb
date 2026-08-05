import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const composePath = new URL('compose.yaml', root).pathname;
const lockPath = new URL('deploy/versions.lock.json', root);
const locked = JSON.parse(await readFile(lockPath, 'utf8')).services;
const imageFor = (name) => `${locked[name].image.reference}@${locked[name].image.digest}`;
const latestMyurlsImage = 'ghcr.io/keleyaa/myurls:latest';
const runtimeVolumeFor = (tag) =>
  `subconverter-runtime-${tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const subconverterRuntimeVolume = runtimeVolumeFor(locked.subconverter.source.tag);
const testSecret = '0123456789abcdef'.repeat(4);

let fixtureDirectory;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'subweb-compose-stack-'));
  await writeFile(join(fixtureDirectory, 'fullchain.pem'), 'test certificate placeholder\n');
  await writeFile(join(fixtureDirectory, 'privkey.pem'), 'test key placeholder\n');
});

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
});

const renderProfile = async (profile) => {
  const envPath = join(fixtureDirectory, `${profile}.env`);
  await writeFile(
    envPath,
    [
      `COMPOSE_PROFILES=${profile}`,
      'APP_DOMAIN=app.example.com',
      'API_DOMAIN=api.example.com',
      'API_URL=https://api.example.com',
      'SHORT_URL=https://app.example.com/short-api',
      'SUBWEB_IMAGE=docker.io/keleyaa/subweb:sha-2bf1a9f',
      'SUBWEB_PORT=19080',
      `TLS_CERT_PATH=${join(fixtureDirectory, 'fullchain.pem')}`,
      `TLS_KEY_PATH=${join(fixtureDirectory, 'privkey.pem')}`,
      `MYURLS_API_TOKEN=${testSecret}`,
      `REDIS_PASSWORD=${testSecret}`,
      '',
    ].join('\n'),
  );

  const result = spawnSync(
    'docker',
    ['compose', '-f', composePath, '--env-file', envPath, 'config', '--format', 'json'],
    { cwd: new URL('../..', import.meta.url).pathname, encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
};

const expectHealthBounds = (service) => {
  expect(service.healthcheck).toBeTruthy();
  expect(service.healthcheck.interval).toMatch(/^([1-5]?[0-9]s|1m0?s)$/);
  expect(service.healthcheck.timeout).toMatch(/^[1-9][0-9]?s$/);
  expect(service.healthcheck.retries).toBeGreaterThanOrEqual(2);
  expect(service.healthcheck.retries).toBeLessThanOrEqual(10);
  expect(service.healthcheck.start_period).toMatch(/^([1-5]?[0-9]s|1m0?s)$/);
};

describe('integrated Compose stack', () => {
  it.each([
    ['behind-proxy', 'gateway-http'],
    ['direct-tls', 'gateway-tls'],
  ])('renders only the %s gateway and the three private services', async (profile, gateway) => {
    const config = await renderProfile(profile);
    expect(Object.keys(config.services).sort()).toEqual(
      [gateway, 'myurls', 'redis', 'subconverter'].sort(),
    );

    for (const name of ['redis', 'myurls', 'subconverter']) {
      expect(config.services[name].ports).toBeUndefined();
      expect(config.services[name].expose).toBeUndefined();
    }
    expectHealthBounds(config.services[gateway]);
    expectHealthBounds(config.services.redis);
    expectHealthBounds(config.services.myurls);
    expectHealthBounds(config.services.subconverter);
    expect(config.services.myurls.environment.MYURLS_RATE_LIMIT_RPS).toBe('5');
    expect(config.services.myurls.environment.MYURLS_RATE_LIMIT_BURST).toBe('10');
  });

  it('publishes only loopback HTTP in behind-proxy mode', async () => {
    const config = await renderProfile('behind-proxy');
    expect(config.services['gateway-http'].ports).toEqual([
      expect.objectContaining({ host_ip: '127.0.0.1', published: '19080', target: 8080 }),
    ]);
    expect(config.services['gateway-http'].volumes ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ target: '/run/tls/fullchain.pem' })]),
    );
  });

  it('publishes HTTP and HTTPS and mounts certificates read-only in direct-tls mode', async () => {
    const config = await renderProfile('direct-tls');
    expect(config.services['gateway-tls'].ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ published: '80', target: 8080 }),
        expect.objectContaining({ published: '443', target: 8443 }),
      ]),
    );
    expect(config.services['gateway-tls'].volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          read_only: true,
          target: '/run/tls/fullchain.pem',
        }),
        expect.objectContaining({
          read_only: true,
          target: '/run/tls/privkey.pem',
        }),
      ]),
    );
  });

  it('declares non-creating TLS bind mounts in the Compose source', async () => {
    const source = await readFile(composePath, 'utf8');
    const gatewayTls = source.slice(source.indexOf('  gateway-tls:'), source.indexOf('\nvolumes:'));

    expect(gatewayTls.match(/create_host_path:\s*false/g)).toHaveLength(2);
    expect(gatewayTls).toContain('target: /run/tls/fullchain.pem');
    expect(gatewayTls).toContain('target: /run/tls/privkey.pem');
  });

  it('uses locked base images, a floating MyUrls image, and a named Redis data volume', async () => {
    const config = await renderProfile('behind-proxy');
    expect(config.services['gateway-http'].image).toBe('docker.io/keleyaa/subweb:sha-2bf1a9f');
    expect(config.services.redis.image).toBe(imageFor('redis'));
    expect(config.services.myurls.image).toBe(latestMyurlsImage);
    expect(config.services.subconverter.image).toBe(imageFor('subconverter'));
    expect(config.volumes['redis-data']).toBeTruthy();
    expect(config.services.redis.volumes).toContainEqual(
      expect.objectContaining({ source: 'redis-data', target: '/data', type: 'volume' }),
    );
    expect(config.volumes[subconverterRuntimeVolume]).toBeTruthy();
    expect(config.services.subconverter.volumes).toContainEqual(
      expect.objectContaining({ source: subconverterRuntimeVolume, target: '/base' }),
    );
  });

  it('configures authenticated durable Redis without putting the password in command arguments', async () => {
    const config = await renderProfile('behind-proxy');
    const redis = config.services.redis;
    expect(redis.environment.REDIS_PASSWORD).toBe(testSecret);
    expect(JSON.stringify(redis.command)).not.toContain(testSecret);
    expect(JSON.stringify(redis.healthcheck.test)).not.toContain(testSecret);
    expect(redis.healthcheck.test.join(' ')).toContain('REDISCLI_AUTH');
    expect(redis.volumes).toContainEqual(
      expect.objectContaining({ read_only: true, target: '/etc/redis/redis.conf.template' }),
    );
    expect(redis.tmpfs).toContainEqual(expect.stringContaining('/run/redis'));
    const template = await readFile(new URL('../../deploy/redis/redis.conf.template', import.meta.url), 'utf8');
    expect(template).toMatch(/^requirepass @@REDIS_PASSWORD@@$/m);
    expect(template).toMatch(/^appendonly yes$/m);
    expect(template).toMatch(/^save 900 1$/m);
    expect(template).toMatch(/^save 300 10$/m);
    expect(template).toMatch(/^save 60 10000$/m);
  });

  it('passes the maintained MyUrls variables and public SubConverter safety policy', async () => {
    const config = await renderProfile('behind-proxy');
    expect(config.services.myurls.environment).toMatchObject({
      MYURLS_PORT: '8080',
      MYURLS_DOMAIN: 'app.example.com',
      MYURLS_PROTO: 'https',
      MYURLS_REDIS_CONN: 'redis:6379',
      MYURLS_REDIS_PASSWORD: testSecret,
      MYURLS_API_TOKEN: testSecret,
    });
    expect(config.services.myurls.tmpfs).toContainEqual(
      expect.stringContaining('/app/logs:uid=65532,gid=65532,mode=0700'),
    );
    expect(config.services.subconverter.environment).toMatchObject({
      MANAGED_CONFIG_PREFIX: 'https://api.example.com',
      SUBCONVERTER_SECURITY_PROFILE: 'public',
      SUBCONVERTER_ALLOW_PUBLIC_UPLOAD: 'false',
    });
    expect(config.services.subconverter.command).toEqual([
      '/bin/sh',
      '/usr/local/bin/subweb-subconverter-entrypoint',
    ]);
    expect(config.services.subconverter.tmpfs).toContain('/run/subconverter:mode=0700');
    expect(config.services.subconverter.volumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: '/usr/local/bin/subweb-subconverter-entrypoint', read_only: true }),
      expect.objectContaining({ target: '/usr/local/bin/subweb-log-supervisor', read_only: true }),
      expect.objectContaining({ target: '/usr/local/bin/subweb-log-filter.awk', read_only: true }),
    ]));
  });

  it('hardens all services and gates dependents on real health checks', async () => {
    const config = await renderProfile('behind-proxy');
    for (const [name, service] of Object.entries(config.services)) {
      expect(service.environment.TZ).toBe('Asia/Shanghai');
      expect(service.logging).toEqual({
        driver: 'json-file',
        options: { 'max-file': '3', 'max-size': '10m' },
      });
      expect(service.cap_drop).toContain('ALL');
      expect(service.security_opt).toContain('no-new-privileges:true');
      expect(service.restart).toBe('unless-stopped');
      expect(service.stop_grace_period).toBe('10s');
      if (name === 'subconverter') {
        expect(service.read_only).toBe(true);
        expect(service.user).toBeUndefined();
      } else {
        expect(service.read_only).toBe(true);
      }
    }
    expect(config.services.redis.user).toBe('999:1000');
    expect(config.services.myurls.user).toBe('65532:65532');
    expect(config.services.redis.read_only).toBe(true);
    expect(config.services.myurls.read_only).toBe(true);
    expect(config.services.myurls.depends_on.redis.condition).toBe('service_healthy');
    expect(config.services.myurls.depends_on.redis.restart).toBe(true);
    expect(config.services['gateway-http'].depends_on.myurls.condition).toBe('service_healthy');
    expect(config.services['gateway-http'].depends_on.myurls.restart).toBe(true);
    expect(config.services['gateway-http'].depends_on.subconverter.condition).toBe('service_healthy');
    expect(config.services['gateway-http'].depends_on.subconverter.restart).toBe(true);
    expect(config.services['gateway-http'].user).toBe('101:101');
    expect(config.services['gateway-http'].tmpfs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/tmp'),
        expect.stringContaining('/usr/share/nginx/html/conf'),
      ]),
    );
    expect(config.volumes[subconverterRuntimeVolume]).toBeTruthy();
    expect(config.services.subconverter.volumes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: subconverterRuntimeVolume,
        target: '/base',
        type: 'volume',
      }),
    ]));
    expect(config.services.subconverter.ports).toBeUndefined();
    expect(config.services.subconverter.expose).toBeUndefined();
  });

});
