import { chmod, copyFile, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const script = new URL('../../start.sh', import.meta.url).pathname;
const run = (command, args, options) => new Promise((resolve) => {
  const child = spawn(command, args, options);
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-start-'));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const nginx = join(bin, 'nginx');
  const renderer = join(bin, 'render-gateway');
  await writeFile(nginx, '#!/bin/sh\nexit 0\n');
  await writeFile(renderer, '#!/bin/sh\nexit 0\n');
  await Promise.all([nginx, renderer].map((file) => chmod(file, 0o755)));
  const template = join(directory, 'config.template.js');
  await copyFile(new URL('../../public/conf/config.js', import.meta.url), template);
  return { directory, bin, nginx, renderer, template, config: join(directory, 'config.js') };
}

async function invoke(value, overrides = {}) {
  const item = await fixture();
  const env = {
    ...process.env,
    PATH: `${item.bin}:${process.env.PATH}`,
    CONFIG_TEMPLATE: item.template,
    CONFIG_FILE: item.config,
    GATEWAY_RENDERER: item.renderer,
    GATEWAY_CONFIG_FILE: join(item.directory, 'nginx.conf'),
    NGINX_BIN: item.nginx,
    API_URL: value,
    ...overrides,
  };
  return { item, result: await run('sh', [script], { env }) };
}

describe('container runtime configuration', () => {
  it('writes a valid public API URL without exposing a short-service setting', async () => {
    const apiUrl = "https://converter.example.com/a'b\\c?x=1&y=2";
    const { item, result } = await invoke(apiUrl);
    expect(result.code).toBe(0);
    const source = await readFile(item.config, 'utf8');
    const window = {};
    expect(() => vm.runInNewContext(source, { window })).not.toThrow();
    expect(window.config.apiUrl).toBe(apiUrl);
    expect(window.config).not.toHaveProperty('shortUrl');
  });

  it('fails closed when API_URL is missing', async () => {
    const { result } = await invoke(undefined);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('缺少必需的 API_URL');
  });

  it.each([
    'javascript:alert(1)',
    'http://api.example.com',
    'https://',
    'https://api.example.com:65536',
    'https://user:secret@api.example.com',
  ])('fails closed for an unsafe API_URL: %s', async (apiUrl) => {
    const { result } = await invoke(apiUrl);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('API_URL 必须是 HTTPS 地址');
  });

  it('derives crawler-facing canonical URLs in a writable runtime copy', async () => {
    const item = await fixture();
    const siteRoot = join(item.directory, 'site');
    const runtimeSiteRoot = join(item.directory, 'runtime-site');
    await mkdir(siteRoot);
    await writeFile(join(siteRoot, 'index.html'), 'https://sub.ml1.one/');
    await writeFile(join(siteRoot, 'sitemap.xml'), 'https://sub.ml1.one/');
    await writeFile(join(siteRoot, 'robots.txt'), 'https://sub.ml1.one/sitemap.xml');
    const env = {
      ...process.env, PATH: `${item.bin}:${process.env.PATH}`, API_URL: 'https://api.example.test',
      APP_DOMAIN: 'self-hosted.example', SITE_ROOT: siteRoot, RUNTIME_SITE_ROOT: runtimeSiteRoot,
      CONFIG_TEMPLATE: item.template, CONFIG_FILE: item.config, GATEWAY_RENDERER: item.renderer,
      GATEWAY_CONFIG_FILE: join(item.directory, 'nginx.conf'), NGINX_BIN: item.nginx,
    };
    expect((await run('sh', [script], { env })).code).toBe(0);
    for (const file of ['index.html', 'sitemap.xml', 'robots.txt']) {
      expect(await readFile(join(runtimeSiteRoot, file), 'utf8')).toContain('https://self-hosted.example');
      expect(await readFile(join(siteRoot, file), 'utf8')).toContain('https://sub.ml1.one');
    }
  });
});
