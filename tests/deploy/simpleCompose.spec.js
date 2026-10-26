import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const composePath = new URL('../../compose.yaml', import.meta.url).pathname;
const disabledComposePath = new URL('../../compose.disabled-short-links.yaml', import.meta.url).pathname;
const runtimeImages = {
  SUBCONVERTER_IMAGE: 'ghcr.io/aethersailor/subconverter-extended:v1.9.4@sha256:8e067383d26d6f3580e9255e13f11a83fd3500e9a3380eb69ae99af54c29f423',
};

const renderCompose = (file = composePath, values = {}) => {
  const env = {
    ...process.env,
    APP_DOMAIN: 'app.example.com',
    API_DOMAIN: 'api.example.com',
    API_URL: 'https://api.example.com',
    SHORT_DOMAIN: 'short.example.com',
    IP_HASH_SECRET: '0123456789abcdef'.repeat(4),
    TURNSTILE_SITE_KEY: 'test-site-key',
    TURNSTILE_SECRET_KEY: 'test-secret-key',
    ...runtimeImages,
    ...values,
  };
  for (const name of [
    'SUBWEB_IMAGE',
    'SUBWEB_PORT',
    'TRUSTED_PROXY_CIDR',
    'MYURLS_TRUST_PROXY_CIDR',
    'SHORT_LINKS_ENABLED',
    'CUSTOM_BACKEND_ENABLED',
  ]) delete env[name];
  const result = spawnSync('docker', ['compose', '-f', file, 'config', '--format', 'json'], {
    cwd: root.pathname,
    encoding: 'utf8',
    env,
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
};

describe('unified Compose deployment', () => {
  it('renders the two-service production topology with one loopback entrypoint', () => {
    const config = renderCompose();
    expect(Object.keys(config.services).sort()).toEqual(['gateway', 'subconverter']);
    expect(config.services.gateway.ports).toEqual([
      expect.objectContaining({ host_ip: '127.0.0.1', published: '18080', target: 8080 }),
    ]);
    expect(config.services.subconverter.ports).toBeUndefined();
    expect(config.services.gateway.environment).toMatchObject({
      API_URL: 'https://api.example.com',
      APP_DOMAIN: 'app.example.com',
      API_DOMAIN: 'api.example.com',
      SHORT_DOMAIN: 'short.example.com',
      EGRESS_LISTEN_ADDR: '0.0.0.0:25502',
      SUBCONVERTER_UPSTREAM: 'http://subconverter:25500',
      SHORT_LINK_DB_PATH: '/data/links.db',
      TURNSTILE_ENABLED: 'true',
    });
    expect(config.services.gateway.environment.MYURLS_UPSTREAM).toBeUndefined();
    expect(config.services.gateway.environment.REDIS_URL).toBeUndefined();
    expect(config.services.gateway.volumes).toEqual([
      expect.objectContaining({ source: 'links-data', target: '/data' }),
    ]);
  });

  it('keeps the Gateway, data, and egress networks isolated', () => {
    const config = renderCompose();
    expect(Object.keys(config.services.gateway.networks).sort()).toEqual([
      'default',
      'subconverter-egress',
    ]);
    expect(Object.keys(config.services.subconverter.networks)).toEqual(['subconverter-egress']);
    expect(config.networks['subconverter-egress'].internal).toBe(true);
    for (const name of ['myurls-data', 'myurls-edge', 'redis-policy']) {
      expect(config.networks[name]).toBeUndefined();
    }
  });

  it('renders only Gateway and SubConverter when short links are disabled', () => {
    const config = renderCompose(disabledComposePath, { SHORT_LINKS_ENABLED: 'false' });
    expect(Object.keys(config.services).sort()).toEqual(['gateway', 'subconverter']);
    expect(config.services.gateway.environment.SHORT_LINKS_ENABLED).toBe('false');
    expect(config.services.gateway.environment.REDIS_URL).toBeUndefined();
    expect(config.services.gateway.environment.SHORT_LINK_DB_PATH).toBeUndefined();
    expect(config.networks['myurls-data']).toBeUndefined();
    expect(config.networks['redis-policy']).toBeUndefined();
  });

  it('uses read-only security defaults and constrains the SubConverter bootstrap', () => {
    const config = renderCompose();
    for (const [name, service] of Object.entries(config.services)) {
      expect(service.read_only, name).toBe(true);
      expect(service.cap_drop, name).toContain('ALL');
      expect(service.security_opt, name).toContain('no-new-privileges:true');
      if (name !== 'subconverter') expect(service.user, name).toMatch(/^[1-9][0-9]*:[1-9][0-9]*$/);
    }

    const subconverter = config.services.subconverter;
    expect(subconverter.user).toBe('0:0');
    expect(subconverter.cap_add).toEqual(['CHOWN', 'SETUID', 'SETGID']);
    expect(subconverter.volumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: '/etc/passwd', read_only: true }),
      expect.objectContaining({ target: '/etc/group', read_only: true }),
    ]));
  });

  it('uses the Go Gateway Dockerfile and preserves the runtime contract', async () => {
    const [commonServices, dockerfile] = await Promise.all([
      readFile(new URL('../../compose.common-services.yaml', import.meta.url), 'utf8'),
      readFile(new URL('../../Dockerfile', import.meta.url), 'utf8'),
    ]);
    expect(commonServices).toContain('dockerfile: Dockerfile');
    expect(dockerfile).toContain('FROM golang:1.27-alpine@sha256:');
    expect(dockerfile).toContain('FROM gcr.io/distroless/static-debian12:nonroot@sha256:');
    expect(dockerfile).toContain('EXPOSE 8080 25502 25503');
    expect(dockerfile).toContain('ENTRYPOINT ["/app/gateway"]');
  });
});
