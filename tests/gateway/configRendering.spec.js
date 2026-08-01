import { chmod, mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const renderScript = fileURLToPath(new URL('scripts/render-gateway-config.sh', root));
const templateRoot = fileURLToPath(new URL('nginx', root));
const startScript = fileURLToPath(new URL('start.sh', root));

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function validEnvironment(overrides = {}) {
  return {
    ...process.env,
    GATEWAY_MODE: 'behind-proxy',
    APP_DOMAIN: 'app.example.test',
    API_DOMAIN: 'api.example.test',
    PUBLIC_SCHEME: 'https',
    GATEWAY_PORT: '8080',
    SUBCONVERTER_UPSTREAM: 'http://subconverter:25500',
    MYURLS_UPSTREAM: 'http://myurls:8080',
    MYURLS_API_TOKEN: 'a'.repeat(64),
    MYURLS_MAX_BODY_BYTES: '1048576',
    TLS_CERT_PATH: '',
    TLS_KEY_PATH: '',
    ...overrides,
  };
}

async function setupFakeNginx({ exitCode = 0 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-gateway-render-'));
  const bin = join(directory, 'bin');
  const nginx = join(bin, 'nginx');
  const argumentsFile = join(directory, 'nginx-arguments');
  await mkdir(bin);
  await writeFile(nginx, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argumentsFile}'\nexit ${exitCode}\n`);
  await chmod(nginx, 0o755);
  return { directory, nginx, argumentsFile, output: join(directory, 'nginx.conf') };
}

async function render(environment = {}, fakeOptions = {}) {
  const fixture = await setupFakeNginx(fakeOptions);
  const resolvConf = join(fixture.directory, 'resolv.conf');
  await writeFile(resolvConf, fakeOptions.resolvContent ?? 'nameserver 10.20.30.40\n');
  const result = await run('sh', [
    renderScript,
    '--template-root', templateRoot,
    '--output', fixture.output,
    '--nginx-bin', fixture.nginx,
    '--resolv-conf', resolvConf,
  ], { env: validEnvironment(environment) });
  const config = result.code === 0 ? await readFile(fixture.output, 'utf8') : null;
  return { ...fixture, ...result, config };
}

describe('gateway configuration rendering', () => {
  it('renders behind-proxy with separate public hosts and without transport security', async () => {
    const result = await render({ GATEWAY_MODE: 'behind-proxy', GATEWAY_PORT: '8080' });

    expect(result).toMatchObject({ code: 0 });
    expect(result.config).toMatch(/listen 8080 default_server;/);
    expect(result.config).toMatch(/listen 8080;/);
    expect(result.config).toContain('server_name app.example.test;');
    expect(result.config).toContain('server_name api.example.test;');
    expect(result.config).toContain('resolver 10.20.30.40 ipv6=off valid=30s;');
    expect(result.config).not.toContain('resolver 127.0.0.11');
    expect(result.config).not.toContain('Strict-Transport-Security');
    const nginxArguments = await readFile(result.argumentsFile, 'utf8');
    expect(nginxArguments).toContain(`-c\n${result.directory}/.gateway-render.`);
    expect(nginxArguments).toContain('/nginx.conf');
    expect((await readdir(result.directory)).filter((name) => name.startsWith('.gateway-render.'))).toEqual([]);
  });

  it('renders direct TLS with an HTTP redirect, HTTPS listeners, certificates, and HSTS', async () => {
    const result = await render({
      GATEWAY_MODE: 'direct-tls',
      GATEWAY_PORT: '8443',
      PUBLIC_SCHEME: 'https',
      TLS_CERT_PATH: '/run/secrets/fullchain.pem',
      TLS_KEY_PATH: '/run/secrets/privkey.pem',
    });

    expect(result).toMatchObject({ code: 0 });
    expect(result.config).toContain('listen 8080 default_server;');
    expect(result.config).toContain('return 308 https://$host$request_uri;');
    expect(result.config).toContain('listen 8443 ssl;');
    expect(result.config).toContain('ssl_certificate /run/secrets/fullchain.pem;');
    expect(result.config).toContain('ssl_certificate_key /run/secrets/privkey.pem;');
    expect(result.config).toContain('Strict-Transport-Security');
  });

  it.each([
    ['GATEWAY_MODE', 'http'],
    ['GATEWAY_MODE', 'platform'],
    ['APP_DOMAIN', 'app.test; return 200'],
    ['APP_DOMAIN', 'https://app.test'],
    ['API_DOMAIN', 'app.example.test'],
    ['PUBLIC_SCHEME', 'javascript'],
    ['GATEWAY_PORT', '80; include evil'],
    ['GATEWAY_PORT', '99999'],
    ['SUBCONVERTER_UPSTREAM', 'http://subconverter:25500/path'],
    ['SUBCONVERTER_UPSTREAM', 'http://subconverter:25500;evil'],
    ['MYURLS_UPSTREAM', 'https://user:pass@myurls:8080'],
    ['MYURLS_API_TOKEN', 'short'],
    ['MYURLS_API_TOKEN', `${'a'.repeat(31)};`],
    ['MYURLS_MAX_BODY_BYTES', '1m'],
    ['MYURLS_MAX_BODY_BYTES', '0'],
    ['TLS_CERT_PATH', 'relative/cert.pem'],
    ['TLS_KEY_PATH', '/run/secrets/key.pem;evil'],
  ])('rejects invalid or injectable %s values', async (name, value) => {
    const mode = name.startsWith('TLS_') ? 'direct-tls' : 'behind-proxy';
    const result = await render({
      GATEWAY_MODE: mode,
      GATEWAY_PORT: mode === 'direct-tls' ? '8443' : '8080',
      TLS_CERT_PATH: mode === 'direct-tls' ? '/run/secrets/cert.pem' : '',
      TLS_KEY_PATH: mode === 'direct-tls' ? '/run/secrets/key.pem' : '',
      [name]: value,
    });

    expect(result.code).not.toBe(0);
    expect(result.stderr).not.toContain(validEnvironment().MYURLS_API_TOKEN);
  });

  it('does not replace a working configuration when nginx validation fails and removes temporary output', async () => {
    const fixture = await setupFakeNginx({ exitCode: 1 });
    await writeFile(fixture.output, 'known-good-configuration\n');

    const result = await run('sh', [
      renderScript,
      '--template-root', templateRoot,
      '--output', fixture.output,
      '--nginx-bin', fixture.nginx,
    ], { env: validEnvironment() });

    expect(result.code).not.toBe(0);
    expect(await readFile(fixture.output, 'utf8')).toBe('known-good-configuration\n');
    const remaining = await readdir(fixture.directory);
    expect(remaining.filter((name) => name.startsWith('.gateway-render.'))).toEqual([]);
    for (const name of remaining.filter((entry) => entry !== 'bin')) {
      expect(await readFile(join(fixture.directory, name), 'utf8')).not.toContain(validEnvironment().MYURLS_API_TOKEN);
    }
  });

  it.each(['SUBCONVERTER_UPSTREAM', 'MYURLS_UPSTREAM'])('rejects HTTPS for the private %s before nginx and preserves the old output', async (name) => {
    const fixture = await setupFakeNginx();
    const resolvConf = join(fixture.directory, 'resolv.conf');
    await writeFile(resolvConf, 'nameserver 10.20.30.40\n');
    await writeFile(fixture.output, 'known-good-configuration\n');
    const value = name === 'SUBCONVERTER_UPSTREAM'
      ? 'https://subconverter:25500'
      : 'https://myurls:8080';

    const result = await run('sh', [
      renderScript,
      '--template-root', templateRoot,
      '--output', fixture.output,
      '--nginx-bin', fixture.nginx,
      '--resolv-conf', resolvConf,
    ], { env: validEnvironment({ [name]: value }) });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('http://');
    expect(await readFile(fixture.output, 'utf8')).toBe('known-good-configuration\n');
    await expect(readFile(fixture.argumentsFile, 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('uses a strictly parsed Docker resolver when supplied by resolv.conf', async () => {
    const result = await render({}, { resolvContent: 'search local\nnameserver 127.0.0.11\nnameserver 8.8.8.8\n' });

    expect(result).toMatchObject({ code: 0 });
    expect(result.config).toContain('resolver 127.0.0.11 ipv6=off valid=30s;');
    expect(result.config).not.toContain('resolver 8.8.8.8');
  });

  it.each(['', 'search local\n', 'nameserver not-an-ip\n', 'nameserver 999.2.3.4\n'])('rejects an empty or invalid resolver source before nginx validation', async (resolvContent) => {
    const fixture = await setupFakeNginx();
    const resolvConf = join(fixture.directory, 'resolv.conf');
    await writeFile(resolvConf, resolvContent);
    await writeFile(fixture.output, 'known-good-configuration\n');

    const result = await run('sh', [
      renderScript,
      '--template-root', templateRoot,
      '--output', fixture.output,
      '--nginx-bin', fixture.nginx,
      '--resolv-conf', resolvConf,
    ], { env: validEnvironment() });

    expect(result.code).not.toBe(0);
    expect(await readFile(fixture.output, 'utf8')).toBe('known-good-configuration\n');
    await expect(readFile(fixture.argumentsFile, 'utf8')).rejects.toThrow(/ENOENT/);
    expect((await readdir(fixture.directory)).filter((name) => name.startsWith('nginx.conf.tmp.'))).toEqual([]);
  });

  it.each(['\n', '\r'])('rejects a real %j control character in every external gateway value before any tool runs', async (control) => {
    const cases = [
      ['GATEWAY_MODE', `behind-proxy${control}`, {}],
      ['APP_DOMAIN', `app.example.test${control}`, {}],
      ['API_DOMAIN', `api.example.test${control}`, {}],
      ['PUBLIC_SCHEME', `https${control}`, {}],
      ['GATEWAY_PORT', `8080${control}`, {}],
      ['SUBCONVERTER_UPSTREAM', `http://subconverter:25500${control}`, {}],
      ['MYURLS_UPSTREAM', `http://myurls:8080${control}`, {}],
      ['MYURLS_API_TOKEN', `${'a'.repeat(64)}${control}`, {}],
      ['MYURLS_MAX_BODY_BYTES', `1048576${control}`, {}],
      ['TLS_CERT_PATH', `/run/secrets/cert.pem${control}`, {
        GATEWAY_MODE: 'direct-tls', GATEWAY_PORT: '8443',
        TLS_CERT_PATH: '/run/secrets/cert.pem', TLS_KEY_PATH: '/run/secrets/key.pem',
      }],
      ['TLS_KEY_PATH', `/run/secrets/key.pem${control}`, {
        GATEWAY_MODE: 'direct-tls', GATEWAY_PORT: '8443',
        TLS_CERT_PATH: '/run/secrets/cert.pem', TLS_KEY_PATH: '/run/secrets/key.pem',
      }],
    ];

    for (const [name, value, modeOverrides] of cases) {
      const fixture = await setupFakeNginx();
      const resolvConf = join(fixture.directory, 'resolv.conf');
      await writeFile(resolvConf, 'nameserver 10.20.30.40\n');
      await writeFile(fixture.output, 'known-good-configuration\n');
      const result = await run('sh', [
        renderScript,
        '--template-root', templateRoot,
        '--output', fixture.output,
        '--nginx-bin', fixture.nginx,
        '--resolv-conf', resolvConf,
      ], { env: validEnvironment({ ...modeOverrides, [name]: value }) });

      expect(result.code, name).not.toBe(0);
      expect(result.stderr, name).toContain('换行或回车');
      expect(await readFile(fixture.output, 'utf8'), name).toBe('known-good-configuration\n');
      await expect(readFile(fixture.argumentsFile, 'utf8'), name).rejects.toThrow(/ENOENT/);
      expect((await readdir(fixture.directory)).filter((entry) => entry.startsWith('nginx.conf.tmp.')), name).toEqual([]);
    }
  });

  it.each(['\n', '\r'].flatMap((control) =>
    ['template-root', 'output', 'nginx-bin', 'resolv-conf'].map((option) => [option, control])))('rejects a real control character in --%s before nginx validation', async (option, control) => {
    const fixture = await setupFakeNginx();
    const resolvConf = join(fixture.directory, 'resolv.conf');
    await writeFile(resolvConf, 'nameserver 10.20.30.40\n');
    await writeFile(fixture.output, 'known-good-configuration\n');
    const values = {
      'template-root': templateRoot,
      output: fixture.output,
      'nginx-bin': fixture.nginx,
      'resolv-conf': resolvConf,
    };
    values[option] += control;

    const result = await run('sh', [
      renderScript,
      '--template-root', values['template-root'],
      '--output', values.output,
      '--nginx-bin', values['nginx-bin'],
      '--resolv-conf', values['resolv-conf'],
    ], { env: validEnvironment() });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('换行或回车');
    expect(await readFile(fixture.output, 'utf8')).toBe('known-good-configuration\n');
    await expect(readFile(fixture.argumentsFile, 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it.each(['template-root', 'output', 'nginx-bin', 'resolv-conf'])('rejects duplicate --%s even when its first value is empty', async (option) => {
    const fixture = await setupFakeNginx();
    const resolvConf = join(fixture.directory, 'resolv.conf');
    await writeFile(resolvConf, 'nameserver 10.20.30.40\n');
    await writeFile(fixture.output, 'known-good-configuration\n');
    const args = [
      renderScript,
      `--${option}`, '',
      '--template-root', templateRoot,
      '--output', fixture.output,
      '--nginx-bin', fixture.nginx,
      '--resolv-conf', resolvConf,
    ];

    const result = await run('sh', args, { env: validEnvironment() });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('重复');
    expect(await readFile(fixture.output, 'utf8')).toBe('known-good-configuration\n');
    await expect(readFile(fixture.argumentsFile, 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it.each(['directory', 'directory symlink'])('rejects an output that resolves to a %s', async (scenario) => {
    const fixture = await setupFakeNginx();
    const resolvConf = join(fixture.directory, 'resolv.conf');
    await writeFile(resolvConf, 'nameserver 10.20.30.40\n');
    const output = scenario === 'directory' ? fixture.directory : join(fixture.directory, 'output-link');
    if (scenario === 'directory symlink') await symlink(fixture.directory, output, 'dir');

    const result = await run('sh', [
      renderScript,
      '--template-root', templateRoot,
      '--output', output,
      '--nginx-bin', fixture.nginx,
      '--resolv-conf', resolvConf,
    ], { env: validEnvironment() });

    expect(result.code).not.toBe(0);
    await expect(readFile(fixture.argumentsFile, 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('uses private random render directories for concurrent writers and leaves no intermediate files', async () => {
    const fixture = await setupFakeNginx();
    const resolvConf = join(fixture.directory, 'resolv.conf');
    await writeFile(resolvConf, 'nameserver 10.20.30.40\n');
    const args = [
      renderScript,
      '--template-root', templateRoot,
      '--output', fixture.output,
      '--nginx-bin', fixture.nginx,
      '--resolv-conf', resolvConf,
    ];

    const results = await Promise.all([
      run('sh', args, { env: validEnvironment({ MYURLS_API_TOKEN: 'a'.repeat(64) }) }),
      run('sh', args, { env: validEnvironment({ MYURLS_API_TOKEN: 'b'.repeat(64) }) }),
    ]);

    expect(results.map(({ code }) => code)).toEqual([0, 0]);
    expect(await readFile(fixture.output, 'utf8')).toMatch(/Bearer (?:a{64}|b{64})/);
    expect((await readdir(fixture.directory)).filter((name) => name.startsWith('.gateway-render.'))).toEqual([]);
  });
});

async function setupStartFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-gateway-start-'));
  const bin = join(directory, 'bin');
  const renderer = join(bin, 'render-gateway');
  const nginx = join(bin, 'nginx');
  const openssl = join(bin, 'openssl');
  const events = join(directory, 'events');
  const opensslCalls = join(directory, 'openssl-calls');
  const configTemplate = join(directory, 'config.template.js');
  const configFile = join(directory, 'config.js');
  const gatewayConfig = join(directory, 'nginx.conf');
  const cert = join(directory, 'certificate.pem');
  const key = join(directory, 'private.key');

  await mkdir(bin);
  await writeFile(configTemplate, "window.config = { apiUrl: 'https://api.ml1.one', shortUrl: 'https://ml1.one' };\n");
  await writeFile(cert, 'certificate fixture\n', { mode: 0o644 });
  await writeFile(key, 'private key fixture\n', { mode: 0o600 });
  await writeFile(renderer, `#!/bin/sh\nprintf 'render:%s\\n' "\${GATEWAY_PORT:-unset}" >> '${events}'\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = --output ]; then shift; : > "$1"; fi\n  shift\ndone\n`);
  await writeFile(nginx, `#!/bin/sh\nprintf 'nginx\\n' >> '${events}'\nexit 0\n`);
  await writeFile(openssl, [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> '${opensslCalls}'`,
    'case "$*" in',
    "  *'-checkhost '*)",
    '    for host do :; done',
    '    [ "${FAKE_OPENSSL_FAIL_HOST:-}" != "$host" ]',
    '    ;;',
    "  *'x509 '*'-pubkey'*) printf '%s\\n' CERT_PUBLIC_KEY ;;",
    "  *'pkey '*'-check'*) exit 0 ;;",
    "  *'pkey '*'-pubin'*) cat ;;",
    "  *'pkey '*'-pubout'*) printf '%s\\n' \"${FAKE_PRIVATE_PUBLIC_KEY:-CERT_PUBLIC_KEY}\" ;;",
    "  *'dgst '*'-sha256'*) cat ;;",
    '  *) exit 0 ;;',
    'esac',
    '',
  ].join('\n'));
  await Promise.all([renderer, nginx, openssl].map((file) => chmod(file, 0o755)));

  const env = {
    ...process.env,
    CONFIG_TEMPLATE: configTemplate,
    CONFIG_FILE: configFile,
    GATEWAY_RENDERER: renderer,
    GATEWAY_TEMPLATE_ROOT: templateRoot,
    GATEWAY_CONFIG_FILE: gatewayConfig,
    NGINX_BIN: nginx,
    OPENSSL_BIN: openssl,
    GATEWAY_MODE: 'behind-proxy',
    APP_DOMAIN: 'app.example.test',
    API_DOMAIN: 'api.example.test',
    PUBLIC_SCHEME: 'https',
    GATEWAY_PORT: '8080',
    SUBCONVERTER_UPSTREAM: 'http://subconverter:25500',
    MYURLS_UPSTREAM: 'http://myurls:8080',
    MYURLS_API_TOKEN: 'b'.repeat(64),
    MYURLS_MAX_BODY_BYTES: '1048576',
    TLS_CERT_PATH: '',
    TLS_KEY_PATH: '',
  };

  return { directory, cert, key, events, opensslCalls, env };
}

describe('gateway startup boundary', () => {
  it('does not require OpenSSL outside direct TLS and validates the rendered config before starting nginx', async () => {
    const fixture = await setupStartFixture();
    const result = await run('sh', [startScript], { env: fixture.env });

    expect(result).toMatchObject({ code: 0 });
    expect(await readFile(fixture.events, 'utf8')).toBe('render:8080\nnginx\n');
    await expect(readFile(fixture.opensslCalls, 'utf8')).rejects.toThrow(/ENOENT/);
    expect(result.stdout).not.toContain(fixture.env.MYURLS_API_TOKEN);
  });

  it('checks both TLS hosts and the certificate/private-key public fingerprint before rendering', async () => {
    const fixture = await setupStartFixture();
    const result = await run('sh', [startScript], {
      env: {
        ...fixture.env,
        GATEWAY_MODE: 'direct-tls',
        GATEWAY_PORT: '8443',
        TLS_CERT_PATH: fixture.cert,
        TLS_KEY_PATH: fixture.key,
      },
    });

    expect(result).toMatchObject({ code: 0 });
    const calls = await readFile(fixture.opensslCalls, 'utf8');
    expect(calls).toContain(`x509 -in ${fixture.cert} -noout -checkhost app.example.test`);
    expect(calls).toContain(`x509 -in ${fixture.cert} -noout -checkhost api.example.test`);
    expect(calls).toContain(`pkey -in ${fixture.key} -check -noout`);
    expect(calls).toContain('dgst -sha256');
    expect(await readFile(fixture.events, 'utf8')).toBe('render:8443\nnginx\n');
  });

  it.each([
    ['a certificate missing the API host', { FAKE_OPENSSL_FAIL_HOST: 'api.example.test' }],
    ['a mismatched private key', { FAKE_PRIVATE_PUBLIC_KEY: 'DIFFERENT_PUBLIC_KEY' }],
  ])('fails before rendering for %s without exposing private-key contents', async (_name, overrides) => {
    const fixture = await setupStartFixture();
    const result = await run('sh', [startScript], {
      env: {
        ...fixture.env,
        ...overrides,
        GATEWAY_MODE: 'direct-tls',
        GATEWAY_PORT: '8443',
        TLS_CERT_PATH: fixture.cert,
        TLS_KEY_PATH: fixture.key,
      },
    });

    expect(result.code).not.toBe(0);
    await expect(readFile(fixture.events, 'utf8')).rejects.toThrow(/ENOENT/);
    expect(`${result.stdout}${result.stderr}`).not.toContain('private key fixture');
  });

  it('rejects group- or world-writable TLS material', async () => {
    const fixture = await setupStartFixture();
    await chmod(fixture.key, 0o666);
    const result = await run('sh', [startScript], {
      env: {
        ...fixture.env,
        GATEWAY_MODE: 'direct-tls',
        GATEWAY_PORT: '8443',
        TLS_CERT_PATH: fixture.cert,
        TLS_KEY_PATH: fixture.key,
      },
    });

    expect(result.code).not.toBe(0);
    await expect(readFile(fixture.events, 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('does not consume an unrelated PORT', async () => {
    const fixture = await setupStartFixture();
    const result = await run('sh', [startScript], {
      env: { ...fixture.env, PORT: '65536' },
    });

    expect(result).toMatchObject({ code: 0 });
    expect(await readFile(fixture.events, 'utf8')).toBe('render:8080\nnginx\n');
  });
});
