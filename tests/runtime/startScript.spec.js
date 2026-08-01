import { chmod, copyFile, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);

function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
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

describe('container runtime configuration', () => {
  it('writes valid JavaScript for API_URL and SHORT_URL without escaping structural quotes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-start-'));
    const template = join(directory, 'config.template.js');
    const config = join(directory, 'config.js');
    const bin = join(directory, 'bin');
    const nginx = join(bin, 'nginx');
    const renderer = join(bin, 'render-gateway');
    const gatewayConfig = join(directory, 'nginx.conf');
    await mkdir(bin);
    await copyFile(new URL('../../public/conf/config.js', import.meta.url), template);
    await writeFile(nginx, '#!/bin/sh\nexit 0\n');
    await writeFile(renderer, '#!/bin/sh\nexit 0\n');
    await Promise.all([nginx, renderer].map((file) => chmod(file, 0o755)));

    const apiUrl = "https://converter.example.com/a'b\\c?x=1&y=2";
    const shortUrl = "https://short.example.com/a'b\\c?x=1&y=2";
    const result = await run('sh', [fileURLToPath(new URL('start.sh', root))], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CONFIG_TEMPLATE: template,
        CONFIG_FILE: config,
        GATEWAY_RENDERER: renderer,
        GATEWAY_CONFIG_FILE: gatewayConfig,
        NGINX_BIN: nginx,
        GATEWAY_MODE: 'behind-proxy',
        API_URL: apiUrl,
        SHORT_URL: shortUrl,
      },
    });

    expect(result).toMatchObject({ code: 0 });
    const source = await readFile(config, 'utf8');
    const window = {};
    expect(() => vm.runInNewContext(source, { window })).not.toThrow();
    expect(window.config.apiUrl).toBe(apiUrl);
    expect(window.config.shortUrl).toBe(shortUrl);
  });

  it('disables short links when SHORT_URL is explicitly set to an empty value', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-start-empty-short-'));
    const template = join(directory, 'config.template.js');
    const config = join(directory, 'config.js');
    const bin = join(directory, 'bin');
    const nginx = join(bin, 'nginx');
    const renderer = join(bin, 'render-gateway');
    const gatewayConfig = join(directory, 'nginx.conf');
    await mkdir(bin);
    await copyFile(new URL('../../public/conf/config.js', import.meta.url), template);
    await writeFile(nginx, '#!/bin/sh\nexit 0\n');
    await writeFile(renderer, '#!/bin/sh\nexit 0\n');
    await Promise.all([nginx, renderer].map((file) => chmod(file, 0o755)));

    const result = await run('sh', [fileURLToPath(new URL('start.sh', root))], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CONFIG_TEMPLATE: template,
        CONFIG_FILE: config,
        GATEWAY_RENDERER: renderer,
        GATEWAY_CONFIG_FILE: gatewayConfig,
        NGINX_BIN: nginx,
        GATEWAY_MODE: 'behind-proxy',
        SHORT_URL: '',
      },
    });

    expect(result).toMatchObject({ code: 0 });
    const source = await readFile(config, 'utf8');
    const window = {};
    expect(() => vm.runInNewContext(source, { window })).not.toThrow();
    expect(window.config.shortUrl).toBe('');
  });
});
