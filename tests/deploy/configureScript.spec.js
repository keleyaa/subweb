import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const configurePath = fileURLToPath(new URL('../../scripts/configure.sh', import.meta.url));
const envExamplePath = fileURLToPath(new URL('../../.env.example', import.meta.url));
const gitignorePath = fileURLToPath(new URL('../../.gitignore', import.meta.url));
const temporaryDirectories = [];
const makeDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-configure-'));
  temporaryDirectories.push(directory);
  return directory;
};
const runConfigure = (cwd, args) => spawnSync('sh', [configurePath, ...args], { cwd, encoding: 'utf8' });
const baseArgs = [
  '--app-domain', 'example.com', '--api-domain', 'api.example.com', '--short-domain', 'short.example.com',
  '--turnstile-site-key', 'test-site-key', '--turnstile-secret-key', 'test-secret-key',
];
const parseEnv = (contents) => Object.fromEntries(contents.trim().split('\n').filter(Boolean).map((line) => {
  const separator = line.indexOf('=');
  return [line.slice(0, separator), line.slice(separator + 1)];
}));

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('single HTTP deployment configuration', () => {
  it('documents placeholders and ignores generated local state', async () => {
    const envExample = await readFile(envExamplePath, 'utf8');
    const gitignore = await readFile(gitignorePath, 'utf8');
    expect(envExample).toContain('IP_HASH_SECRET=REPLACE_WITH_64_CHARACTER_HEX');
    expect(envExample).toContain('TURNSTILE_SITE_KEY=REPLACE_WITH_TURNSTILE_SITE_KEY');
    expect(envExample).toContain('REDIS_PASSWORD=REPLACE_WITH_64_CHARACTER_HEX');
    for (const ignoredPath of ['.runtime/', 'runtime-config/', '*.pem', '*.key', 'redis-data/']) expect(gitignore.split('\n')).toContain(ignoredPath);
  });

  it.each([
    ['missing APP domain', ['--api-domain', 'api.example.com', '--short-domain', 'short.example.com']],
    ['missing API domain', ['--app-domain', 'example.com', '--short-domain', 'short.example.com']],
    ['missing SHORT domain', ['--app-domain', 'example.com', '--api-domain', 'api.example.com']],
    ['unknown option', [...baseArgs, '--mode', 'behind-proxy']],
    ['scheme in domain', ['--app-domain', 'https://example.com', '--api-domain', 'api.example.com', '--short-domain', 'short.example.com']],
    ['path in domain', ['--app-domain', 'example.com/path', '--api-domain', 'api.example.com', '--short-domain', 'short.example.com']],
    ['identical domains', ['--app-domain', 'example.com', '--api-domain', 'example.com', '--short-domain', 'short.example.com']],
    ['duplicate APP domain', [...baseArgs, '--app-domain', 'other.example.com']],
    ['TLS option', [...baseArgs, '--tls-cert', '/tmp/cert.pem']],
    ['invalid Subweb port', [...baseArgs, '--subweb-port', '65536']],
    ['non-loopback HTTP API URL', [...baseArgs, '--api-url', 'http://example.com']],
    ['API URL userinfo', [...baseArgs, '--api-url', 'https://user@example.com']],
  ])('rejects %s without creating an environment file', async (_name, args) => {
    const cwd = await makeDirectory();
    const result = runConfigure(cwd, args);
    expect(result.status).not.toBe(0);
    await expect(readFile(join(cwd, '.env'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(cwd)).filter((name) => name.includes('.tmp.'))).toEqual([]);
  });

  it('allows short links to be disabled without short-link domains or secrets', async () => {
    const cwd = await makeDirectory();
    const result = runConfigure(cwd, [
      '--app-domain', 'example.com', '--api-domain', 'api.example.com',
      '--short-links-enabled', 'false', '--custom-backend-enabled', 'false',
    ]);
    const env = parseEnv(await readFile(join(cwd, '.env'), 'utf8'));
    expect(result.status, `${result.stdout}\\n${result.stderr}`).toBe(0);
    expect(env).toMatchObject({
      APP_DOMAIN: 'example.com', API_DOMAIN: 'api.example.com', API_URL: 'https://api.example.com',
      SHORT_LINKS_ENABLED: 'false', CUSTOM_BACKEND_ENABLED: 'false',
    });
    for (const omitted of ['SHORT_DOMAIN', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'IP_HASH_SECRET', 'REDIS_PASSWORD']) {
      expect(env[omitted]).toBeUndefined();
    }
  });

  it.each([
    ['short links', ['--short-links-enabled', 'maybe']],
    ['custom backend', ['--custom-backend-enabled', '1']],
  ])('rejects invalid %s feature values', async (_name, featureArgs) => {
    const cwd = await makeDirectory();
    const result = runConfigure(cwd, [...baseArgs, ...featureArgs]);
    expect(result.status).not.toBe(0);
    await expect(readFile(join(cwd, '.env'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writes the fixed three-domain configuration with private generated secrets', async () => {
    const cwd = await makeDirectory();
    const result = runConfigure(cwd, baseArgs);
    const envPath = join(cwd, '.env');
    const env = parseEnv(await readFile(envPath, 'utf8'));
    expect(result.status).toBe(0);
    expect(env).toMatchObject({
      APP_DOMAIN: 'example.com', API_DOMAIN: 'api.example.com', SHORT_DOMAIN: 'short.example.com',
      API_URL: 'https://api.example.com',
      TURNSTILE_SITE_KEY: 'test-site-key', TURNSTILE_SECRET_KEY: 'test-secret-key',
    });
    expect(env.TURNSTILE_HOSTNAME).toBeUndefined();
    for (const removed of ['COMPOSE_PROFILES', 'DOMAIN_MODE', 'PUBLIC_SCHEME', 'GATEWAY_MODE', 'TLS_CERT_PATH', 'TLS_KEY_PATH']) expect(env[removed]).toBeUndefined();
    expect(env.TRUSTED_PROXY_CIDR).toBeUndefined();
    expect(env.IP_HASH_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(env.REDIS_PASSWORD).toMatch(/^[0-9a-f]{64}$/);
    expect((await stat(envPath)).mode & 0o777).toBe(0o600);
    expect(`${result.stdout}${result.stderr}`).not.toContain(env.IP_HASH_SECRET);
    expect(`${result.stdout}${result.stderr}`).not.toContain(env.TURNSTILE_SECRET_KEY);
  });

  it('preserves image overrides, valid secrets, and explicit image selection', async () => {
    const cwd = await makeDirectory();
    const image = 'docker.io/keleyaa/subweb:sha-2bf1a9f';
    expect(runConfigure(cwd, [...baseArgs, '--subweb-image', image, '--trusted-proxy-cidr', '172.18.0.1/32']).status).toBe(0);
    const original = parseEnv(await readFile(join(cwd, '.env'), 'utf8'));
    expect(original.SUBWEB_IMAGE).toBe(image);
    expect(runConfigure(cwd, [...baseArgs].map((value) => value.replace('example.com', 'new.example.com'))).status).toBe(0);
    const preserved = parseEnv(await readFile(join(cwd, '.env'), 'utf8'));
    expect(preserved.SUBWEB_IMAGE).toBe(image);
    expect(preserved.IP_HASH_SECRET).toBe(original.IP_HASH_SECRET);
    expect(preserved.REDIS_PASSWORD).toBe(original.REDIS_PASSWORD);
    expect(preserved.TRUSTED_PROXY_CIDR).toBe('172.18.0.1/32');
  });

  it('preserves valid existing image overrides and rejects duplicates', async () => {
    const cwd = await makeDirectory();
    await writeFile(join(cwd, '.env'), [
      'MYURLS_IMAGE=ghcr.io/keleyaa/myurls@sha256:' + 'a'.repeat(64),
      'REDIS_IMAGE=docker.io/library/redis:8.10.1',
      'SUBCONVERTER_IMAGE=ghcr.io/aethersailor/subconverter-extended:v1.8.6',
      'SUBWEB_IMAGE=docker.io/keleyaa/subweb:sha-2bf1a9f',
      `IP_HASH_SECRET=${'a'.repeat(64)}`, `REDIS_PASSWORD=${'b'.repeat(64)}`,
      'TURNSTILE_SITE_KEY=test-site-key', 'TURNSTILE_SECRET_KEY=test-secret-key', '',
    ].join('\n'), { mode: 0o600 });
    expect(runConfigure(cwd, baseArgs).status).toBe(0);
    const contents = await readFile(join(cwd, '.env'), 'utf8');
    expect(contents).toContain('MYURLS_IMAGE=ghcr.io/keleyaa/myurls@sha256:' + 'a'.repeat(64));
    await writeFile(join(cwd, '.env'), contents.replace(/^MYURLS_IMAGE=.*$/m, '$&\nMYURLS_IMAGE=ghcr.io/keleyaa/myurls:latest'));
    const rejected = runConfigure(cwd, baseArgs);
    expect(rejected.status).not.toBe(0);
  });

  it('does not source an existing environment file or accept malformed secrets', async () => {
    const cwd = await makeDirectory();
    const marker = join(cwd, 'sourced-marker');
    const original = `IP_HASH_SECRET=$(touch ${marker})\nREDIS_PASSWORD=${'a'.repeat(64)}\n`;
    await writeFile(join(cwd, '.env'), original, { mode: 0o600 });
    expect(runConfigure(cwd, baseArgs).status).not.toBe(0);
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(cwd, '.env'), 'utf8')).toBe(original);
  });

  it('rotates secrets only when explicitly requested', async () => {
    const cwd = await makeDirectory();
    expect(runConfigure(cwd, baseArgs).status).toBe(0);
    const original = parseEnv(await readFile(join(cwd, '.env'), 'utf8'));
    expect(runConfigure(cwd, [...baseArgs, '--rotate-secrets']).status).toBe(0);
    const rotated = parseEnv(await readFile(join(cwd, '.env'), 'utf8'));
    expect(rotated.IP_HASH_SECRET).not.toBe(original.IP_HASH_SECRET);
    expect(rotated.REDIS_PASSWORD).not.toBe(original.REDIS_PASSWORD);
  });
});
