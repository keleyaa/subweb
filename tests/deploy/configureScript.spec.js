import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const configurePath = fileURLToPath(
  new URL('../../scripts/configure.sh', import.meta.url),
);
const envExamplePath = fileURLToPath(new URL('../../.env.example', import.meta.url));
const gitignorePath = fileURLToPath(new URL('../../.gitignore', import.meta.url));
const temporaryDirectories = [];

const makeDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-configure-'));
  temporaryDirectories.push(directory);
  return directory;
};

const runConfigure = (cwd, args) =>
  spawnSync('sh', [configurePath, ...args], { cwd, encoding: 'utf8' });

const behindProxyArgs = [
  '--mode',
  'behind-proxy',
  '--app-domain',
  'example.com',
  '--api-domain',
  'api.example.com',
];

const parseEnv = (contents) =>
  Object.fromEntries(
    contents
      .trim()
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('safe deployment configuration CLI', () => {
  it('documents placeholders and ignores every generated local-state path', async () => {
    const envExample = await readFile(envExamplePath, 'utf8');
    const gitignore = await readFile(gitignorePath, 'utf8');

    expect(envExample).toContain('MYURLS_API_TOKEN=REPLACE_WITH_64_CHARACTER_HEX');
    expect(envExample).toContain('REDIS_PASSWORD=REPLACE_WITH_64_CHARACTER_HEX');
    expect(envExample).not.toMatch(/(?:MYURLS_API_TOKEN|REDIS_PASSWORD)=[0-9a-f]{64}/);
    for (const ignoredPath of [
      '.runtime/',
      'runtime-config/',
      '*.pem',
      '*.key',
      'redis-data/',
    ]) {
      expect(gitignore.split('\n')).toContain(ignoredPath);
    }
  });

  it.each([
    ['missing mode', ['--app-domain', 'example.com', '--api-domain', 'api.example.com']],
    ['duplicate mode', [...behindProxyArgs, '--mode', 'direct-tls']],
    ['duplicate APP domain after an empty value', ['--mode', 'behind-proxy', '--app-domain', '', '--app-domain', 'example.com', '--api-domain', 'api.example.com']],
    ['duplicate API domain after an empty value', ['--mode', 'behind-proxy', '--app-domain', 'example.com', '--api-domain', '', '--api-domain', 'api.example.com']],
    ['duplicate TLS certificate after an empty value', ['--mode', 'direct-tls', '--app-domain', 'example.com', '--api-domain', 'api.example.com', '--tls-cert', '', '--tls-cert', '/tmp/cert.pem', '--tls-key', '/tmp/key.pem']],
    ['duplicate TLS key after an empty value', ['--mode', 'direct-tls', '--app-domain', 'example.com', '--api-domain', 'api.example.com', '--tls-cert', '/tmp/cert.pem', '--tls-key', '', '--tls-key', '/tmp/key.pem']],
    ['duplicate secret rotation flag', [...behindProxyArgs, '--rotate-secrets', '--rotate-secrets']],
    ['duplicate Subweb image', [...behindProxyArgs, '--subweb-image', 'docker.io/keleyaa/subweb:latest', '--subweb-image', 'docker.io/keleyaa/subweb:sha-1234567']],
    ['newline in Subweb image', [...behindProxyArgs, '--subweb-image', 'docker.io/keleyaa/subweb:latest\nINJECTED=value']],
    ['whitespace in Subweb image', [...behindProxyArgs, '--subweb-image', 'docker.io/keleyaa/subweb:bad tag']],
    ['unknown mode', ['--mode', 'other', '--app-domain', 'example.com', '--api-domain', 'api.example.com']],
    ['scheme in domain', ['--mode', 'behind-proxy', '--app-domain', 'https://example.com', '--api-domain', 'api.example.com']],
    ['path in domain', ['--mode', 'behind-proxy', '--app-domain', 'example.com/path', '--api-domain', 'api.example.com']],
    ['port in domain', ['--mode', 'behind-proxy', '--app-domain', 'example.com:443', '--api-domain', 'api.example.com']],
    ['newline in domain', ['--mode', 'behind-proxy', '--app-domain', 'example.com\nINJECTED=value', '--api-domain', 'api.example.com']],
    ['identical domains', ['--mode', 'behind-proxy', '--app-domain', 'example.com', '--api-domain', 'example.com']],
    ['TLS in proxy mode', [...behindProxyArgs, '--tls-cert', '/tmp/cert.pem']],
    ['missing direct TLS files', ['--mode', 'direct-tls', '--app-domain', 'example.com', '--api-domain', 'api.example.com']],
    ['relative certificate', ['--mode', 'direct-tls', '--app-domain', 'example.com', '--api-domain', 'api.example.com', '--tls-cert', 'cert.pem', '--tls-key', '/tmp/key.pem']],
    ['relative private key', ['--mode', 'direct-tls', '--app-domain', 'example.com', '--api-domain', 'api.example.com', '--tls-cert', '/tmp/cert.pem', '--tls-key', 'key.pem']],
    ['newline in certificate path', ['--mode', 'direct-tls', '--app-domain', 'example.com', '--api-domain', 'api.example.com', '--tls-cert', '/tmp/cert.pem\nINJECTED=value', '--tls-key', '/tmp/key.pem']],
    ['space in private key path', ['--mode', 'direct-tls', '--app-domain', 'example.com', '--api-domain', 'api.example.com', '--tls-cert', '/tmp/cert.pem', '--tls-key', '/tmp/private key.pem']],
  ])('rejects %s without creating an environment file', async (_name, args) => {
    const cwd = await makeDirectory();

    const result = runConfigure(cwd, args);

    expect(result.status).not.toBe(0);
    await expect(readFile(join(cwd, '.env'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await readdir(cwd)).filter((name) => name.includes('.tmp.'))).toEqual([]);
  });

  it('writes a private behind-proxy configuration with derived public URLs', async () => {
    const cwd = await makeDirectory();

    const result = runConfigure(cwd, behindProxyArgs);
    const envPath = join(cwd, '.env');
    const env = parseEnv(await readFile(envPath, 'utf8'));

    expect(result.status).toBe(0);
    expect(env).toMatchObject({
      COMPOSE_PROFILES: 'behind-proxy',
      APP_DOMAIN: 'example.com',
      API_DOMAIN: 'api.example.com',
      API_URL: 'https://api.example.com',
      SHORT_URL: 'https://example.com/short-api',
    });
    expect(env.TLS_CERT_PATH).toBeUndefined();
    expect(env.TLS_KEY_PATH).toBeUndefined();
    expect(env.MYURLS_API_TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(env.REDIS_PASSWORD).toMatch(/^[0-9a-f]{64}$/);
    expect((await stat(envPath)).mode & 0o777).toBe(0o600);
    expect(`${result.stdout}${result.stderr}`).not.toContain(env.MYURLS_API_TOKEN);
    expect(`${result.stdout}${result.stderr}`).not.toContain(env.REDIS_PASSWORD);
  });

  it('writes and preserves an explicitly selected prebuilt Subweb image', async () => {
    const cwd = await makeDirectory();
    const image = 'docker.io/keleyaa/subweb:sha-2bf1a9f';

    const first = runConfigure(cwd, [...behindProxyArgs, '--subweb-image', image]);
    expect(first.status).toBe(0);
    expect(parseEnv(await readFile(join(cwd, '.env'), 'utf8')).SUBWEB_IMAGE).toBe(image);

    const second = runConfigure(cwd, [
      '--mode', 'behind-proxy',
      '--app-domain', 'new.example.com',
      '--api-domain', 'api.new.example.com',
    ]);
    expect(second.status).toBe(0);
    expect(parseEnv(await readFile(join(cwd, '.env'), 'utf8')).SUBWEB_IMAGE).toBe(image);
  });

  it('preserves valid image overrides when regenerating deployment configuration', async () => {
    const cwd = await makeDirectory();
    const overrides = {
      MYURLS_IMAGE: 'ghcr.io/keleyaa/myurls@sha256:' + 'a'.repeat(64),
      REDIS_IMAGE: 'docker.io/library/redis:8.10.0-alpine',
      SUBCONVERTER_IMAGE: 'ghcr.io/aethersailor/subconverter-extended:v1.2.0',
      SUBWEB_IMAGE: 'docker.io/keleyaa/subweb:sha-2bf1a9f',
    };
    await writeFile(
      join(cwd, '.env'),
      [
        ...Object.entries(overrides).map(([key, value]) => `${key}=${value}`),
        `MYURLS_API_TOKEN=${'a'.repeat(64)}`,
        `REDIS_PASSWORD=${'b'.repeat(64)}`,
        '',
      ].join('\n'),
      { mode: 0o600 },
    );

    const result = runConfigure(cwd, behindProxyArgs);

    expect(result.status).toBe(0);
    expect(parseEnv(await readFile(join(cwd, '.env'), 'utf8'))).toMatchObject(overrides);
  });

  it('rejects a duplicated or invalid existing image override without changing the file', async () => {
    const cwd = await makeDirectory();
    const original = [
      'MYURLS_IMAGE=ghcr.io/keleyaa/myurls:v1.13.0',
      'MYURLS_IMAGE=ghcr.io/keleyaa/myurls:latest',
      `MYURLS_API_TOKEN=${'a'.repeat(64)}`,
      `REDIS_PASSWORD=${'b'.repeat(64)}`,
      '',
    ].join('\n');
    await writeFile(join(cwd, '.env'), original, { mode: 0o600 });

    const result = runConfigure(cwd, behindProxyArgs);

    expect(result.status).not.toBe(0);
    expect(await readFile(join(cwd, '.env'), 'utf8')).toBe(original);
  });

  it('writes only the direct-tls profile and absolute TLS paths', async () => {
    const cwd = await makeDirectory();
    const args = [
      '--mode', 'direct-tls',
      '--app-domain', 'example.com',
      '--api-domain', 'api.example.com',
      '--tls-cert', '/absolute/fullchain.pem',
      '--tls-key', '/absolute/privkey.pem',
    ];

    const result = runConfigure(cwd, args);
    const env = parseEnv(await readFile(join(cwd, '.env'), 'utf8'));

    expect(result.status).toBe(0);
    expect(env.COMPOSE_PROFILES).toBe('direct-tls');
    expect(env.TLS_CERT_PATH).toBe('/absolute/fullchain.pem');
    expect(env.TLS_KEY_PATH).toBe('/absolute/privkey.pem');
    expect(env.API_URL).toBe('https://api.example.com');
    expect(env.SHORT_URL).toBe('https://example.com/short-api');
  });

  it('preserves valid secrets until explicitly asked to rotate them', async () => {
    const cwd = await makeDirectory();
    expect(runConfigure(cwd, behindProxyArgs).status).toBe(0);
    const original = parseEnv(await readFile(join(cwd, '.env'), 'utf8'));

    const changed = runConfigure(cwd, [
      '--mode', 'behind-proxy',
      '--app-domain', 'new.example.com',
      '--api-domain', 'api.new.example.com',
    ]);
    const preserved = parseEnv(await readFile(join(cwd, '.env'), 'utf8'));
    expect(changed.status).toBe(0);
    expect(preserved.MYURLS_API_TOKEN).toBe(original.MYURLS_API_TOKEN);
    expect(preserved.REDIS_PASSWORD).toBe(original.REDIS_PASSWORD);

    const rotatedResult = runConfigure(cwd, [...behindProxyArgs, '--rotate-secrets']);
    const rotated = parseEnv(await readFile(join(cwd, '.env'), 'utf8'));
    expect(rotatedResult.status).toBe(0);
    expect(rotated.MYURLS_API_TOKEN).not.toBe(original.MYURLS_API_TOKEN);
    expect(rotated.REDIS_PASSWORD).not.toBe(original.REDIS_PASSWORD);
    expect(`${rotatedResult.stdout}${rotatedResult.stderr}`).not.toContain(rotated.MYURLS_API_TOKEN);
    expect(`${rotatedResult.stdout}${rotatedResult.stderr}`).not.toContain(rotated.REDIS_PASSWORD);
  });

  it('does not source an existing environment file or accept malformed secrets', async () => {
    const cwd = await makeDirectory();
    const marker = join(cwd, 'sourced-marker');
    await writeFile(
      join(cwd, '.env'),
      `MYURLS_API_TOKEN=$(touch ${marker})\nREDIS_PASSWORD=${'a'.repeat(64)}\n`,
      { mode: 0o600 },
    );

    const result = runConfigure(cwd, behindProxyArgs);

    expect(result.status).not.toBe(0);
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(cwd, '.env'), 'utf8')).toContain('$(touch');
  });

  it('leaves an existing file byte-for-byte intact after late validation failure', async () => {
    const cwd = await makeDirectory();
    const original = `MYURLS_API_TOKEN=${'a'.repeat(64)}\nREDIS_PASSWORD=${'b'.repeat(64)}\n`;
    await writeFile(join(cwd, '.env'), original, { mode: 0o600 });

    const result = runConfigure(cwd, [
      '--mode', 'direct-tls',
      '--app-domain', 'example.com',
      '--api-domain', 'api.example.com',
      '--tls-cert', '/absolute/fullchain.pem',
      '--tls-key', 'relative.key',
    ]);

    expect(result.status).not.toBe(0);
    expect(await readFile(join(cwd, '.env'), 'utf8')).toBe(original);
    expect((await readdir(cwd)).filter((name) => name.includes('.tmp.'))).toEqual([]);
  });

  it.each([
    ['APP domain', ['--mode', 'behind-proxy', '--app-domain', '', '--app-domain', 'example.com', '--api-domain', 'api.example.com']],
    ['API domain', ['--mode', 'behind-proxy', '--app-domain', 'example.com', '--api-domain', '', '--api-domain', 'api.example.com']],
    ['TLS certificate', ['--mode', 'direct-tls', '--app-domain', 'example.com', '--api-domain', 'api.example.com', '--tls-cert', '', '--tls-cert', '/tmp/cert.pem', '--tls-key', '/tmp/key.pem']],
    ['TLS key', ['--mode', 'direct-tls', '--app-domain', 'example.com', '--api-domain', 'api.example.com', '--tls-cert', '/tmp/cert.pem', '--tls-key', '', '--tls-key', '/tmp/key.pem']],
  ])('leaves an existing file intact after duplicate %s arguments', async (_name, args) => {
    const cwd = await makeDirectory();
    const original = `MYURLS_API_TOKEN=${'a'.repeat(64)}\nREDIS_PASSWORD=${'b'.repeat(64)}\n`;
    await writeFile(join(cwd, '.env'), original, { mode: 0o600 });

    const result = runConfigure(cwd, args);

    expect(result.status).not.toBe(0);
    expect(await readFile(join(cwd, '.env'), 'utf8')).toBe(original);
    expect((await readdir(cwd)).filter((name) => name.includes('.tmp.'))).toEqual([]);
  });

  it('rejects duplicate existing secret keys without changing the file', async () => {
    const cwd = await makeDirectory();
    const original = `MYURLS_API_TOKEN=${'a'.repeat(64)}\nMYURLS_API_TOKEN=${'c'.repeat(64)}\nREDIS_PASSWORD=${'b'.repeat(64)}\n`;
    await writeFile(join(cwd, '.env'), original, { mode: 0o600 });

    const result = runConfigure(cwd, behindProxyArgs);

    expect(result.status).not.toBe(0);
    expect(await readFile(join(cwd, '.env'), 'utf8')).toBe(original);
  });

  it('rejects an environment target that is a directory without leaving generated files', async () => {
    const cwd = await makeDirectory();
    const envDirectory = join(cwd, '.env');
    await mkdir(envDirectory);

    const result = runConfigure(cwd, behindProxyArgs);

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('written');
    expect(await readdir(envDirectory)).toEqual([]);
    expect((await readdir(cwd)).filter((name) => name.includes('.env.tmp.'))).toEqual([]);
  });

  it('rejects an environment target symlinked to a directory without leaving generated files', async () => {
    const cwd = await makeDirectory();
    const targetDirectory = join(cwd, 'environment-target');
    await mkdir(targetDirectory);
    await symlink(targetDirectory, join(cwd, '.env'));

    const result = runConfigure(cwd, behindProxyArgs);

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('written');
    expect(await readdir(targetDirectory)).toEqual([]);
    expect((await readdir(cwd)).filter((name) => name.includes('.env.tmp.'))).toEqual([]);
  });
});
