import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const composePath = new URL('compose.yaml', root).pathname;
const testSecret = '0123456789abcdef'.repeat(4);
let fixtureDirectory;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'subweb-compose-stack-'));
});
afterAll(async () => { await rm(fixtureDirectory, { recursive: true, force: true }); });

const renderCompose = async () => {
  const envPath = join(fixtureDirectory, 'stack.env');
  await writeFile(envPath, [
    'APP_DOMAIN=app.example.com', 'API_DOMAIN=api.example.com', 'API_URL=https://api.example.com',
    'SHORT_DOMAIN=short.example.com', 'SHORT_URL=https://short.example.com/short-api',
    'SUBWEB_IMAGE=docker.io/keleyaa/subweb:sha-2bf1a9f', 'SUBWEB_PORT=19080',
    `MYURLS_API_TOKEN=${testSecret}`, `REDIS_PASSWORD=${testSecret}`, '',
  ].join('\n'));
  const result = spawnSync('docker', ['compose', '-f', composePath, '--env-file', envPath, 'config', '--format', 'json'], { cwd: new URL('../..', import.meta.url).pathname, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
};

const expectHealthBounds = (service) => {
  expect(service.healthcheck).toBeTruthy();
  expect(service.healthcheck.retries).toBeGreaterThanOrEqual(2);
  expect(service.healthcheck.timeout).toMatch(/^[1-9][0-9]?s$/);
};

describe('integrated Compose stack', () => {
  it('renders one gateway and three private services', async () => {
    const config = await renderCompose();
    expect(Object.keys(config.services).sort()).toEqual(['gateway', 'myurls', 'redis', 'subconverter'].sort());
    for (const name of ['redis', 'myurls', 'subconverter']) {
      expect(config.services[name].ports).toBeUndefined();
      expect(config.services[name].expose).toBeUndefined();
      expectHealthBounds(config.services[name]);
    }
    expectHealthBounds(config.services.gateway);
    expect(config.services.gateway.ports).toEqual([expect.objectContaining({ host_ip: '127.0.0.1', published: '19080', target: 8080 })]);
    expect(config.services.gateway.environment.SHORT_DOMAIN).toBe('short.example.com');
  });

  it('has no profiles, TLS mounts, or public host ports', async () => {
    const source = await readFile(composePath, 'utf8');
    expect(source).not.toContain('profiles:');
    expect(source).not.toContain('gateway-http');
    expect(source).not.toContain('gateway-tls');
    expect(source).not.toContain('TLS_CERT_PATH');
    expect(source).not.toContain('TLS_KEY_PATH');
    expect(source).not.toMatch(/- "(?:80|443):/);
  });

  it('uses stable images, durable Redis, and the maintained service policies', async () => {
    const config = await renderCompose();
    expect(config.services.gateway.image).toBe('docker.io/keleyaa/subweb:sha-2bf1a9f');
    expect(config.services.redis.image).toBe('docker.io/library/redis:8-alpine');
    expect(config.services.myurls.image).toBe('ghcr.io/keleyaa/myurls:latest');
    expect(config.services.subconverter.image).toBe('ghcr.io/aethersailor/subconverter-extended:latest');
    expect(config.volumes['redis-data']).toBeTruthy();
    expect(config.services.redis.volumes).toContainEqual(expect.objectContaining({ source: 'redis-data', target: '/data', type: 'volume' }));
    expect(config.services.myurls.environment).toMatchObject({
      MYURLS_PORT: '8080', MYURLS_DOMAIN: 'short.example.com', MYURLS_PROTO: 'https',
      MYURLS_REDIS_CONN: 'redis:6379', MYURLS_REDIS_PASSWORD: testSecret,
      MYURLS_API_TOKEN: testSecret, MYURLS_MAX_BODY_BYTES: '1048576',
    });
    expect(config.services.subconverter.environment).toMatchObject({
      MANAGED_CONFIG_PREFIX: 'https://api.example.com', SUBCONVERTER_SECURITY_PROFILE: 'public', SUBCONVERTER_ALLOW_PUBLIC_UPLOAD: 'false',
    });
  });

  it('configures authenticated durable Redis without exposing its password in commands', async () => {
    const config = await renderCompose();
    const redis = config.services.redis;
    expect(redis.environment.REDIS_PASSWORD).toBe(testSecret);
    expect(JSON.stringify(redis.command)).not.toContain(testSecret);
    expect(JSON.stringify(redis.healthcheck.test)).not.toContain(testSecret);
    expect(redis.healthcheck.test.join(' ')).toContain('REDISCLI_AUTH');
    const template = await readFile(new URL('../../deploy/redis/redis.conf.template', import.meta.url), 'utf8');
    expect(template).toMatch(/^requirepass @@REDIS_PASSWORD@@$/m);
    expect(template).toMatch(/^appendonly yes$/m);
  });

  it('hardens all services and gates dependents on health', async () => {
    const config = await renderCompose();
    for (const service of Object.values(config.services)) {
      expect(service.environment.TZ).toBe('Asia/Shanghai');
      expect(service.logging).toEqual({ driver: 'json-file', options: { 'max-file': '3', 'max-size': '10m' } });
      expect(service.cap_drop).toContain('ALL');
      expect(service.security_opt).toContain('no-new-privileges:true');
      expect(service.restart).toBe('unless-stopped');
      expect(service.read_only).toBe(true);
    }
  });
});
