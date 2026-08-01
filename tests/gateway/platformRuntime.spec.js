import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const startScript = fileURLToPath(new URL('start.sh', root));

function run(environment) {
  return new Promise((resolve) => {
    const child = spawn('sh', [startScript], { env: environment });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function fixture(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-platform-runtime-'));
  const bin = join(directory, 'bin');
  const renderer = join(bin, 'renderer');
  const nginx = join(bin, 'nginx');
  const capture = join(directory, 'capture');
  const configTemplate = join(directory, 'config.template.js');
  const configFile = join(directory, 'config.js');
  await mkdir(bin);
  await copyFile(new URL('../../public/conf/config.js', import.meta.url), configTemplate);
  await writeFile(
    renderer,
    '#!/bin/sh\nprintf \'%s\\n\' "$GATEWAY_PORT" "$PUBLIC_SCHEME" "$SUBCONVERTER_UPSTREAM" "$MYURLS_UPSTREAM" "$API_URL" "$SHORT_URL" "$TLS_CERT_PATH" "$TLS_KEY_PATH" "$MYURLS_MAX_BODY_BYTES" > "$PLATFORM_CAPTURE"\nwhile [ "$#" -gt 0 ]; do if [ "$1" = --output ]; then shift; : > "$1"; fi; shift; done\n'
  );
  await writeFile(nginx, '#!/bin/sh\nexit 0\n');
  await Promise.all([renderer, nginx].map((file) => chmod(file, 0o755)));
  return {
    capture,
    configFile,
    env: {
      ...process.env,
      CONFIG_TEMPLATE: configTemplate,
      CONFIG_FILE: configFile,
      GATEWAY_RENDERER: renderer,
      GATEWAY_CONFIG_FILE: join(directory, 'nginx.conf'),
      NGINX_BIN: nginx,
      PLATFORM_CAPTURE: capture,
      GATEWAY_MODE: 'platform',
      PORT: '4173',
      APP_DOMAIN: 'app.example.test',
      API_DOMAIN: 'api.example.test',
      SUBCONVERTER_UPSTREAM: 'subconverter.railway.internal:25500',
      MYURLS_UPSTREAM: 'myurls.railway.internal:8080',
      MYURLS_API_TOKEN: 'a'.repeat(64),
      ...overrides,
    },
  };
}

describe('PaaS gateway runtime', () => {
  it('derives HTTPS public URLs and normalizes private hostport upstreams', async () => {
    const setup = await fixture();
    const result = await run(setup.env);
    expect(result.code, result.stderr).toBe(0);
    expect((await readFile(setup.capture, 'utf8')).split('\n')).toEqual([
      '4173',
      'https',
      'http://subconverter.railway.internal:25500',
      'http://myurls.railway.internal:8080',
      'https://api.example.test',
      'https://app.example.test/short-api',
      '',
      '',
      '1048576',
      '',
    ]);
    const config = await readFile(setup.configFile, 'utf8');
    expect(config).toContain("apiUrl: 'https://api.example.test'");
    expect(config).toContain("shortUrl: 'https://app.example.test/short-api'");
  });

  it.each([
    'https://private.example:25500',
    'user:pass@private.example:25500',
    'private.example:25500/path',
    'private.example:25500?query=1',
    'private.example:25500#fragment',
  ])('rejects an unsafe private upstream before rendering: %s', async (value) => {
    const setup = await fixture({ SUBCONVERTER_UPSTREAM: value });
    const result = await run(setup.env);
    expect(result.code).not.toBe(0);
    await expect(readFile(setup.capture, 'utf8')).rejects.toThrow(/ENOENT/);
  });
});
