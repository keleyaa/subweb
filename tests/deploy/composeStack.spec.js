import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const composePath = new URL('compose.yaml', root).pathname;
const testSecret = '0123456789abcdef'.repeat(4);
const composeVariableNames = [
  'API_DOMAIN', 'API_URL', 'APP_DOMAIN', 'CONVERSION_DNS_TIMEOUT_MS',
  'CONVERSION_EGRESS_CONNECT_TIMEOUT_MS', 'CONVERSION_MAX_CONCURRENCY', 'CONVERSION_MAX_REQUEST_BYTES',
  'CONVERSION_MAX_RESPONSE_BYTES', 'CONVERSION_RATE_LIMIT', 'CONVERSION_RATE_WINDOW_SECONDS',
  'CONVERSION_REQUEST_TIMEOUT_MS', 'CUSTOM_BACKEND_ENABLED', 'IP_HASH_SECRET', 'MYURLS_APP_IP',
  'MYURLS_GATEWAY_IP', 'MYURLS_IMAGE', 'MYURLS_LOG_LEVEL', 'MYURLS_NETWORK_SUBNET',
  'MYURLS_SHORT_IP', 'MYURLS_TRUST_PROXY_CIDR', 'REDIS_IMAGE', 'REDIS_PASSWORD', 'SHORT_DOMAIN',
  'SHORT_LINKS_ENABLED', 'SUBCONVERTER_IMAGE', 'SUBWEB_IMAGE', 'SUBWEB_PORT', 'TRUSTED_PROXY_CIDR',
  'TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY',
];
let fixtureDirectory;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'subweb-compose-stack-'));
});
afterAll(async () => { await rm(fixtureDirectory, { recursive: true, force: true }); });

const renderCompose = async (extra = []) => {
  const envPath = join(fixtureDirectory, 'stack.env');
  await writeFile(envPath, [
    'APP_DOMAIN=app.example.com', 'API_DOMAIN=api.example.com', 'API_URL=https://api.example.com',
    'SHORT_DOMAIN=short.example.com', 'SHORT_LINKS_ENABLED=true', 'CUSTOM_BACKEND_ENABLED=true',
    'SUBWEB_IMAGE=subweb:ci', 'SUBWEB_PORT=19080',
    `IP_HASH_SECRET=${testSecret}`, `REDIS_PASSWORD=${testSecret}`,
    'TURNSTILE_SITE_KEY=test-site-key', 'TURNSTILE_SECRET_KEY=test-secret-key', ...extra, '',
  ].join('\n'));
  const environment = { ...process.env };
  for (const name of composeVariableNames) delete environment[name];
  const result = spawnSync('docker', ['compose', '-f', composePath, '--env-file', envPath, 'config', '--format', 'json'], {
    cwd: new URL('../..', import.meta.url).pathname,
    encoding: 'utf8',
    env: environment,
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
};

const expectHealthBounds = (service) => {
  expect(service.healthcheck).toBeTruthy();
  expect(service.healthcheck.retries).toBeGreaterThanOrEqual(2);
  expect(service.healthcheck.timeout).toMatch(/^[1-9][0-9]?s$/);
};

describe('integrated Compose stack', () => {
  it('renders the sole five-container production topology', async () => {
    const config = await renderCompose();
    expect(Object.keys(config.services).sort()).toEqual(['gateway', 'myurls-app', 'myurls-short', 'redis', 'subconverter'].sort());
    for (const name of ['redis', 'myurls-app', 'myurls-short', 'subconverter']) {
      expect(config.services[name].ports).toBeUndefined();
      expect(config.services[name].expose).toBeUndefined();
      expectHealthBounds(config.services[name]);
    }
    for (const name of ['myurls-app', 'myurls-short']) {
      expect(config.services[name].healthcheck.test).toEqual([
        'CMD', 'curl', '--fail', '--silent', 'http://127.0.0.1:3000/health/live',
      ]);
    }
    expectHealthBounds(config.services.gateway);
    expect(config.services.gateway.ports).toEqual([expect.objectContaining({ host_ip: '127.0.0.1', published: '19080', target: 8080 })]);
    expect(config.services.gateway.environment).toMatchObject({
      SHORT_LINKS_ENABLED: 'true', CUSTOM_BACKEND_ENABLED: 'true',
      MYURLS_APP_UPSTREAM: 'http://myurls-app-edge:3000',
      MYURLS_SHORT_UPSTREAM: 'http://myurls-short-edge:3000',
      SUBCONVERTER_UPSTREAM: 'http://subconverter:25500',
      EGRESS_LISTEN_ADDR: '0.0.0.0:25502',
    });
    expect(config.services.subconverter.environment).toMatchObject({
      MANAGED_CONFIG_PREFIX: 'https://api.example.com', SUBCONVERTER_SECURITY_PROFILE: 'public',
      SUBCONVERTER_ALLOW_PUBLIC_UPLOAD: 'false',
      HTTPS_PROXY: 'http://gateway:25502', https_proxy: 'http://gateway:25502',
    });
  });

  it('starts the Gateway before SubConverter because SubConverter uses its egress proxy', async () => {
    const config = await renderCompose();
    expect(config.services.gateway.depends_on?.subconverter).toBeUndefined();
    expect(config.services.subconverter.depends_on).toMatchObject({
      gateway: { condition: 'service_healthy', restart: true },
    });
  });

  it('isolates service networks and does not publish the internal egress listener', async () => {
    const config = await renderCompose();
    expect(Object.keys(config.services.gateway.networks).sort()).toEqual(['default', 'myurls-edge', 'redis-policy', 'subconverter-egress']);
    expect(Object.keys(config.services.subconverter.networks)).toEqual(['subconverter-egress']);
    expect(Object.keys(config.services.redis.networks).sort()).toEqual(['myurls-data', 'redis-policy']);
    for (const service of ['myurls-app', 'myurls-short']) {
      expect(Object.keys(config.services[service].networks).sort()).toEqual(['myurls-data', 'myurls-edge']);
    }
    expect(config.networks['myurls-data'].internal).toBe(true);
    expect(config.networks['myurls-edge'].internal).toBe(true);
    expect(config.networks['redis-policy'].internal).toBe(true);
    expect(config.networks['subconverter-egress'].internal).toBe(true);
    expect(config.services.gateway.ports).toHaveLength(1);
    expect(config.services.gateway.ports[0].target).toBe(8080);
  });

  it('uses the locked external images, durable Redis, and non-root security defaults', async () => {
    const config = await renderCompose();
    expect(config.services.redis.image).toContain('@sha256:');
    expect(config.services['myurls-app'].image).toContain('@sha256:');
    expect(config.services['myurls-short'].image).toBe(config.services['myurls-app'].image);
    expect(config.services.subconverter.image).toContain('@sha256:');
    expect(config.volumes['redis-data']).toBeTruthy();
    expect(config.services.redis.volumes).toContainEqual(expect.objectContaining({ source: 'redis-data', target: '/data', type: 'volume' }));
    for (const [name, service] of Object.entries(config.services)) {
      expect(service.environment.TZ).toBe('Asia/Shanghai');
      expect(service.cap_drop).toContain('ALL');
      expect(service.security_opt).toContain('no-new-privileges:true');
      expect(service.read_only).toBe(true);
      if (name !== 'subconverter') expect(service.user).toMatch(/^[1-9][0-9]*:[1-9][0-9]*$/);
    }
    expect(config.services.subconverter.user).toBe('0:0');
    expect(config.services.subconverter.cap_add).toEqual(['CHOWN', 'SETUID', 'SETGID']);
    expect(config.services.subconverter.volumes).toContainEqual(expect.objectContaining({ target: '/etc/passwd', read_only: true }));
    expect(config.services.subconverter.volumes).toContainEqual(expect.objectContaining({ target: '/etc/group', read_only: true }));
    const entrypoint = await readFile(new URL('scripts/subconverter-docker-entrypoint.sh', root), 'utf8');
    expect(entrypoint).toContain('chown 101:101 "$base_path"');
    expect(entrypoint).toContain('exec su -s /bin/sh -c');
    expect(entrypoint).toContain('subweb');
    expect(config.services['myurls-app'].environment).toMatchObject({
      REDIS_URL: 'redis://redis:6379/0', TURNSTILE_HOSTNAME: 'app.example.com',
      TURNSTILE_SECRET_KEY: 'test-secret-key',
      LOG_LEVEL: 'warn',
    });
    expect(config.services['myurls-short'].environment).toMatchObject({
      TURNSTILE_HOSTNAME: 'short.example.com',
      LOG_LEVEL: 'warn',
    });
    expect(JSON.stringify(config.services.redis.command)).not.toContain(testSecret);
  });

  it('uses a quiet Redis log level while retaining warnings and errors', async () => {
    const config = await renderCompose();
    const redisTemplate = await readFile(new URL('../../deploy/redis/redis.conf.template', import.meta.url), 'utf8');
    expect(redisTemplate).toContain('loglevel warning');
    expect(config.services['myurls-app'].environment.LOG_LEVEL).toBe('warn');
    expect(config.services['myurls-short'].environment.LOG_LEVEL).toBe('warn');
  });

  it('allows temporarily raising MyUrls verbosity through the environment', async () => {
    const config = await renderCompose(['MYURLS_LOG_LEVEL=info']);
    expect(config.services['myurls-app'].environment.LOG_LEVEL).toBe('info');
    expect(config.services['myurls-short'].environment.LOG_LEVEL).toBe('info');
  });

  it('has no legacy hardened file, profiles, TLS mounts, or Nginx runtime entrypoint', async () => {
    const source = await readFile(composePath, 'utf8');
    expect(source).not.toContain('request-policy');
    expect(source).not.toContain('profiles:');
    expect(source).not.toContain('TLS_CERT_PATH');
    expect(source).not.toContain('GATEWAY_RENDERER');
  });
});
