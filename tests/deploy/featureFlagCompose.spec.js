import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const disabledComposePath = new URL('compose.disabled-short-links.yaml', root).pathname;
const temporaryDirectories = [];

const renderDisabledCompose = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-disabled-compose-'));
  temporaryDirectories.push(directory);
  const envPath = join(directory, 'disabled.env');
  await writeFile(envPath, [
    'APP_DOMAIN=app.example.com',
    'API_DOMAIN=api.example.com',
    'API_URL=https://api.example.com',
    'SHORT_DOMAIN=short.example.com',
    'CUSTOM_BACKEND_ENABLED=false',
    'SUBWEB_IMAGE=subweb:ci',
    'SUBWEB_PORT=19081',
    '',
  ].join('\n'));
  const result = spawnSync('docker', [
    'compose', '-f', disabledComposePath, '--env-file', envPath, 'config', '--format', 'json',
  ], { cwd: new URL('../..', import.meta.url).pathname, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('short-links-disabled Compose contract', () => {
  it('renders without MyUrls, Redis, or Turnstile secrets', async () => {
    const config = await renderDisabledCompose();
    expect(Object.keys(config.services).sort()).toEqual(['gateway', 'subconverter']);
    expect(config.services.gateway.environment).toMatchObject({
      SHORT_LINKS_ENABLED: 'false',
      CUSTOM_BACKEND_ENABLED: 'false',
      SUBCONVERTER_UPSTREAM: 'http://subconverter:25500',
    });
    for (const name of ['REDIS_URL', 'REDIS_PASSWORD', 'IP_HASH_SECRET', 'TURNSTILE_SITE_KEY', 'MYURLS_APP_UPSTREAM', 'MYURLS_SHORT_UPSTREAM']) {
      expect(config.services.gateway.environment).not.toHaveProperty(name);
    }
    expect(config.services.gateway.depends_on).toMatchObject({
      subconverter: { condition: 'service_healthy', restart: true },
    });
    expect(config.services.gateway.networks).toEqual({ default: {}, 'subconverter-egress': {} });
    expect(config.networks['subconverter-egress'].internal).toBe(true);
  });

  it('keeps the egress listener private in the disabled topology', async () => {
    const config = await renderDisabledCompose();
    expect(config.services.gateway.ports).toEqual([
      expect.objectContaining({ host_ip: '127.0.0.1', target: 8080, published: '19081' }),
    ]);
    expect(config.services.subconverter.ports).toBeUndefined();
    expect(config.services.subconverter.environment.HTTPS_PROXY).toBe('http://gateway:25502');
  });
});

describe('Gateway Dockerfile contract', () => {
  it('uses immutable multi-stage runtime images and the unified binary', async () => {
    const source = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8');
    expect(source).toMatch(/^FROM node:24-alpine@sha256:/m);
    expect(source).toMatch(/^FROM golang:1\.25-alpine@sha256:/m);
    expect(source).toMatch(/^FROM gcr\.io\/distroless\/static-debian12:nonroot@sha256:/m);
    expect(source).toContain('ENTRYPOINT ["/app/gateway"]');
    expect(source).not.toContain('nginx');
  });
});
