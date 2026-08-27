import { chmod, mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
    APP_DOMAIN: 'app.example.test',
    API_DOMAIN: 'api.example.test',
    SHORT_DOMAIN: 'short.example.test',
    SUBCONVERTER_UPSTREAM: 'http://subconverter:25500',
    MYURLS_APP_UPSTREAM: 'http://myurls-app-edge:3000',
    MYURLS_SHORT_UPSTREAM: 'http://myurls-short-edge:3000',
    MYURLS_MAX_BODY_BYTES: '16384',
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
    renderScript, '--template-root', templateRoot, '--output', fixture.output,
    '--nginx-bin', fixture.nginx, '--resolv-conf', resolvConf,
  ], { env: validEnvironment(environment) });
  const config = result.code === 0 ? await readFile(fixture.output, 'utf8') : null;
  return { ...fixture, ...result, config };
}

describe('gateway configuration rendering', () => {
  it('renders all three public hosts on one HTTP listener', async () => {
    const result = await render();
    expect(result.code).toBe(0);
    expect(result.config).toMatch(/listen 8080 default_server;/);
    expect(result.config).toContain('server_name app.example.test;');
    expect(result.config).toContain('server_name api.example.test;');
    expect(result.config).toContain('server_name short.example.test;');
    expect(result.config).toContain('location = /short-api/v1/links {');
    expect(result.config).toContain('proxy_pass $myurls_upstream/api/v1/links;');
    expect(result.config).toContain('proxy_pass $myurls_upstream$request_uri;');
    expect(result.config).toContain('proxy_set_header Forwarded "";');
    expect(result.config).toContain('resolver 10.20.30.40 ipv6=off valid=30s;');
    expect(result.config).not.toContain('real_ip_header');
    expect(result.config).not.toContain('8443');
    expect(result.config).not.toContain('ssl_certificate');
    expect((await readdir(result.directory)).filter((name) => name.startsWith('.gateway-render.'))).toEqual([]);
  });

  it.each([
    ['APP_DOMAIN', 'app.test; return 200'],
    ['APP_DOMAIN', 'https://app.test'],
    ['API_DOMAIN', 'app.example.test'],
    ['SHORT_DOMAIN', 'app.example.test'],
    ['SUBCONVERTER_UPSTREAM', 'http://subconverter:25500/path'],
    ['MYURLS_APP_UPSTREAM', 'https://user:pass@myurls:8080'],
    ['MYURLS_SHORT_UPSTREAM', 'https://user:pass@myurls:8080'],
    ['MYURLS_MAX_BODY_BYTES', '0'],
    ['TRUSTED_PROXY_CIDR', '172.18.0.1; return 200'],
    ['TRUSTED_PROXY_CIDR', '999.18.0.1/32'],
    ['TRUSTED_PROXY_CIDR', '0.0.0.0/0'],
  ])('rejects invalid or injectable %s values', async (name, value) => {
    const result = await render({ [name]: value });
    expect(result.code).not.toBe(0);
    expect(result.stderr).not.toContain('Authorization');
  });

  it('uses forwarded client addresses only for an explicit trusted proxy CIDR', async () => {
    const result = await render({ TRUSTED_PROXY_CIDR: '172.18.0.1/32' });

    expect(result.code).toBe(0);
    expect(result.config).toContain('real_ip_header X-Forwarded-For;');
    expect(result.config).toContain('real_ip_recursive on;');
    expect(result.config).toContain('set_real_ip_from 172.18.0.1/32;');
  });

  it('does not replace a working configuration when nginx validation fails', async () => {
    const fixture = await setupFakeNginx({ exitCode: 1 });
    await writeFile(fixture.output, 'known-good-configuration\n');
    const resolvConf = join(fixture.directory, 'resolv.conf');
    await writeFile(resolvConf, 'nameserver 10.20.30.40\n');
    const result = await run('sh', [renderScript, '--template-root', templateRoot, '--output', fixture.output, '--nginx-bin', fixture.nginx, '--resolv-conf', resolvConf], { env: validEnvironment() });
    expect(result.code).not.toBe(0);
    expect(await readFile(fixture.output, 'utf8')).toBe('known-good-configuration\n');
    expect((await readdir(fixture.directory)).filter((name) => name.startsWith('.gateway-render.'))).toEqual([]);
  });

  it('rejects invalid resolver input before invoking nginx', async () => {
    const result = await render({}, { resolvContent: 'nameserver 999.2.3.4\n' });
    expect(result.code).not.toBe(0);
    await expect(readFile(result.argumentsFile, 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('rejects control characters in external values before rendering', async () => {
    const result = await render({ APP_DOMAIN: 'app.example.test\nINJECTED=1' });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('换行或回车');
    await expect(readFile(result.argumentsFile, 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('supports concurrent writers with private temporary directories', async () => {
    const fixture = await setupFakeNginx();
    const resolvConf = join(fixture.directory, 'resolv.conf');
    await writeFile(resolvConf, 'nameserver 10.20.30.40\n');
    const args = [renderScript, '--template-root', templateRoot, '--output', fixture.output, '--nginx-bin', fixture.nginx, '--resolv-conf', resolvConf];
    const results = await Promise.all([
      run('sh', args, { env: validEnvironment() }),
      run('sh', args, { env: validEnvironment() }),
    ]);
    expect(results.map(({ code }) => code)).toEqual([0, 0]);
    expect(await readFile(fixture.output, 'utf8')).toContain('proxy_pass $myurls_upstream/api/v1/links;');
  });
});

async function setupStartFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-gateway-start-'));
  const bin = join(directory, 'bin');
  const renderer = join(bin, 'render-gateway');
  const nginx = join(bin, 'nginx');
  const configTemplate = join(directory, 'config.template.js');
  const configFile = join(directory, 'config.js');
  const gatewayConfig = join(directory, 'nginx.conf');
  const events = join(directory, 'events');
  await mkdir(bin);
  await writeFile(configTemplate, "window.config = { apiUrl: '' };\n");
  await writeFile(renderer, `#!/bin/sh\nprintf 'render\\n' >> '${events}'\nwhile [ "$#" -gt 0 ]; do if [ "$1" = --output ]; then shift; : > "$1"; fi; shift; done\n`);
  await writeFile(nginx, `#!/bin/sh\nprintf 'nginx\\n' >> '${events}'\n`);
  await Promise.all([renderer, nginx].map((file) => chmod(file, 0o755)));
  const env = {
    ...process.env, CONFIG_TEMPLATE: configTemplate, CONFIG_FILE: configFile,
    GATEWAY_RENDERER: renderer, GATEWAY_CONFIG_FILE: gatewayConfig, NGINX_BIN: nginx,
    APP_DOMAIN: 'app.example.test', API_DOMAIN: 'api.example.test', SHORT_DOMAIN: 'short.example.test',
    API_URL: 'https://api.example.test',
    SUBCONVERTER_UPSTREAM: 'http://subconverter:25500',
    MYURLS_APP_UPSTREAM: 'http://myurls-app-edge:3000',
    MYURLS_SHORT_UPSTREAM: 'http://myurls-short-edge:3000',
    MYURLS_MAX_BODY_BYTES: '16384',
  };
  return { directory, events, env };
}

describe('gateway startup boundary', () => {
  it('renders the fixed HTTP gateway before starting nginx and never invokes OpenSSL', async () => {
    const fixture = await setupStartFixture();
    const result = await run('sh', [startScript], { env: fixture.env });
    expect(result.code).toBe(0);
    expect(await readFile(fixture.events, 'utf8')).toBe('render\nnginx\n');
    expect(result.stdout).not.toContain('Authorization');
  });

  it('does not consume an unrelated PORT variable', async () => {
    const fixture = await setupStartFixture();
    const result = await run('sh', [startScript], { env: { ...fixture.env, PORT: '65536' } });
    expect(result.code).toBe(0);
    expect(await readFile(fixture.events, 'utf8')).toBe('render\nnginx\n');
  });
});
