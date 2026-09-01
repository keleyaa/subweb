import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const composePath = new URL('../../compose.yaml', import.meta.url).pathname;
const hardenedComposePath = new URL('../../compose.hardened.yaml', import.meta.url).pathname;
const simpleDockerfilePath = new URL('../../Dockerfile.simple', import.meta.url).pathname;
const simpleStartPath = new URL('../../scripts/simple-start.sh', import.meta.url).pathname;
const simpleNginxPath = new URL('../../nginx/simple.conf.template', import.meta.url).pathname;

const renderCompose = () => {
  const env = {
    ...process.env,
    APP_DOMAIN: 'app.example.com',
    API_DOMAIN: 'api.example.com',
    API_URL: 'https://api.example.com',
    SHORT_DOMAIN: 'short.example.com',
    REDIS_PASSWORD: 'test-redis-password',
    IP_HASH_SECRET: '0123456789abcdef'.repeat(4),
    TURNSTILE_SITE_KEY: 'test-site-key',
    TURNSTILE_SECRET_KEY: 'test-secret-key',
  };
  for (const name of [
    'SUBWEB_IMAGE', 'MYURLS_IMAGE', 'REDIS_IMAGE', 'SUBWEB_PORT',
    'TRUSTED_PROXY_CIDR', 'MYURLS_TRUST_PROXY_CIDR',
  ]) delete env[name];
  const result = spawnSync('docker', [
    'compose', '-f', composePath, 'config', '--format', 'json',
  ], { cwd: root.pathname, encoding: 'utf8', env });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
};

describe('simple three-service deployment', () => {
  it('renders only the bundled Subweb, one MyUrls, and Redis services', () => {
    const config = renderCompose();
    expect(Object.keys(config.services).sort()).toEqual(['myurls', 'redis', 'subweb']);
    expect(config.services.subweb.ports).toEqual([
      expect.objectContaining({ host_ip: '127.0.0.1', published: '18080', target: 8080 }),
    ]);
    expect(config.services.myurls.ports).toBeUndefined();
    expect(config.services.redis.ports).toBeUndefined();
    expect(config.services.subweb.environment).toMatchObject({
      API_URL: 'https://api.example.com',
      APP_DOMAIN: 'app.example.com',
      API_DOMAIN: 'api.example.com',
      SHORT_DOMAIN: 'short.example.com',
      MANAGED_CONFIG_PREFIX: 'https://api.example.com',
      SUBCONVERTER_SECURITY_PROFILE: 'public',
      SUBCONVERTER_ALLOW_PUBLIC_UPLOAD: 'false',
      SUBCONVERTER_UPSTREAM: 'http://127.0.0.1:25500',
      MYURLS_UPSTREAM: 'http://myurls:3000',
    });
    expect(config.services.myurls.environment).toMatchObject({
      PUBLIC_BASE_URL: 'https://short.example.com',
      TURNSTILE_HOSTNAME: 'app.example.com',
      REDIS_URL: 'redis://redis:6379/0',
      TRUST_PROXY_CIDRS: '172.16.0.0/12',
    });
  });

  it('keeps the simplified and hardened local image fallbacks isolated', async () => {
    const [simpleCompose, hardenedCompose] = await Promise.all([
      readFile(composePath, 'utf8'),
      readFile(hardenedComposePath, 'utf8'),
    ]);

    expect(simpleCompose).toContain('image: "${SUBWEB_IMAGE:-subweb:local}"');
    expect(hardenedCompose).toContain('image: "${SUBWEB_IMAGE:-subweb:hardened-local}"');
  });

  it("keeps all services on Docker's one default Compose network", () => {
    const config = renderCompose();
    for (const name of ['subweb', 'myurls', 'redis']) {
      expect(Object.keys(config.services[name].networks)).toEqual(['default']);
    }
    expect(config.services.subweb.networks.default).toBeNull();
  });

  it('bundles the converter and starts both processes under one container', async () => {
    const dockerfile = await readFile(simpleDockerfilePath, 'utf8');
    const start = await readFile(simpleStartPath, 'utf8');
    expect(dockerfile).toContain('ARG SUBCONVERTER_IMAGE=ghcr.io/aethersailor/subconverter-extended:');
    expect(dockerfile).toContain('FROM ${SUBCONVERTER_IMAGE} AS runtime');
    expect(dockerfile).toContain('--header="Host: $APP_DOMAIN"');
    expect(dockerfile).not.toContain('--header="Host: $$APP_DOMAIN"');
    expect(start).toContain('/usr/local/bin/subweb-subconverter-entrypoint');
    expect(start).toContain('mkdir -p "${runtime_base%/*}"');
    expect(start).toContain('nginx_bin')
  });

  it('keeps SHORT as a redirect-only public host', async () => {
    const nginx = await readFile(simpleNginxPath, 'utf8');
    expect(nginx).toContain('server_name @@SHORT_DOMAIN@@;');
    expect(nginx).toContain('location ~ "^/[A-Za-z0-9_-]{1,64}$"');
    expect(nginx).toContain('location = /api/links { return 404; }');
    expect(nginx).toContain('location / { return 404; }');
  });
});
