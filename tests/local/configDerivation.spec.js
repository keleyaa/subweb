import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const renderer = new URL('../../scripts/local/render-config.mjs', import.meta.url).pathname;
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-local-config-'));
  temporaryDirectories.push(directory);
  const runRoot = join(directory, 'run');
  const source = join(directory, 'subconverter');
  await mkdir(runRoot);
  await mkdir(join(source, 'base'), { recursive: true });
  await writeFile(join(source, 'base/pref.example.toml'), `version = 1
[managed_config]
managed_config_prefix = "http://127.0.0.1:25500"
[security]
profile = "lan"
allow_public_upload = true
[server]
listen = "0.0.0.0"
port = 25500
serve_file_root = "web"
[advanced]
log_level = "info"
print_debug_info = false
`);
  const mimeTypes = join(directory, 'mime.types');
  await writeFile(mimeTypes, 'types { text/html html; application/javascript js; text/css css; }\n');
  await chmod(mimeTypes, 0o644);
  return { directory, runRoot, source, mimeTypes };
};

describe('local source configuration derivation', () => {
  it('derives every public and private endpoint from seven custom ports', async () => {
    const { runRoot, source, mimeTypes } = await fixture();
    const ports = {
      vite: 15173,
      subconverter: 15500,
      myurls: 18092,
      redis: 16389,
      app: 19080,
      api: 19081,
      short: 19083,
    };
    const result = spawnSync(
      process.execPath,
      [renderer, '--project-root', root, '--run-root', runRoot, '--subconverter-source', source, '--nginx-mime-types', mimeTypes, '--ports-json', JSON.stringify(ports)],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          MYURLS_API_TOKEN: 'a'.repeat(64),
          REDIS_PASSWORD: 'b'.repeat(64),
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const publicConfig = await readFile(join(runRoot, 'config.js'), 'utf8');
    expect(publicConfig).toContain('http://127.0.0.1:19083/short-api');
    expect(publicConfig).not.toContain('a'.repeat(64));
    expect(publicConfig).not.toContain('b'.repeat(64));

    const redis = await readFile(join(runRoot, 'redis.conf'), 'utf8');
    expect(redis).toContain('bind 127.0.0.1');
    expect(redis).toContain('port 16389');
    expect(redis).toContain(`proc-title-template "${runRoot}`);
    expect(redis).toContain(`requirepass ${'b'.repeat(64)}`);
    expect(redis).toContain(`dir ${JSON.stringify(join(root, '.runtime/local/redis'))}`);
    expect(redis).toContain('appendonly yes');

    const subconverter = await readFile(join(runRoot, 'subconverter.toml'), 'utf8');
    expect(subconverter).toContain('managed_config_prefix = "http://127.0.0.1:19081"');
    expect(subconverter).toContain('profile = "public"');
    expect(subconverter).toContain('allow_public_upload = false');
    expect(subconverter).toContain('listen = "127.0.0.1"');
    expect(subconverter).toContain('port = 15500');
    expect(subconverter).toContain('log_level = "warn"');
    expect(subconverter).toContain('print_debug_info = false');

    const nginx = await readFile(join(runRoot, 'nginx.conf'), 'utf8');
    expect(nginx).toContain('listen 127.0.0.1:19080;');
    expect(nginx).toContain('listen 127.0.0.1:19081;');
    expect(nginx).toContain('http://127.0.0.1:15173');
    expect(nginx).toContain('http://127.0.0.1:18092');
    expect(nginx).toContain('http://127.0.0.1:15500');
    expect(nginx).toContain('a'.repeat(64));
    expect(nginx).toContain('map $uri $privacy_route');
    expect(nginx).toContain('"~^/[A-Za-z0-9_-]{1,64}$" "/:shortKey";');
    expect(nginx).toContain('$time_iso8601 $request_method $privacy_route $status');
    expect(nginx).not.toMatch(/log_format[^\n]*\$request_uri/);

    for (const name of ['config.js', 'redis.conf', 'subconverter.toml', 'nginx.conf']) {
      expect((await stat(join(runRoot, name))).mode & 0o077).toBe(0);
    }
  });

  it('rejects malformed ports and secret values before writing configuration', async () => {
    const { runRoot, source, mimeTypes } = await fixture();
    const result = spawnSync(
      process.execPath,
      [renderer, '--project-root', root, '--run-root', runRoot, '--subconverter-source', source, '--nginx-mime-types', mimeTypes, '--ports-json', '{"vite":0}'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          MYURLS_API_TOKEN: `unsafe\n${'a'.repeat(64)}`,
          REDIS_PASSWORD: 'b'.repeat(64),
        },
      },
    );

    expect(result.status).not.toBe(0);
    await expect(readFile(join(runRoot, 'nginx.conf'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
