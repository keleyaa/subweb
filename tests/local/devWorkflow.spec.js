import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

describe('Compose-first local development workflow', () => {
  it('uses pinned containers plus Vite instead of compiling external source', async () => {
    const [start, dependencies, common, override, vite, verifier] = await Promise.all([
      read('scripts/local/start.sh'),
      read('scripts/local/deps.sh'),
      read('scripts/local/common.sh'),
      read('compose.dev.yaml'),
      read('vite.config.mjs'),
      read('scripts/verify-local-dev.sh'),
    ]);

    expect(start).toContain('npm run serve');
    expect(common).toContain('export LOCAL_MYURLS_PORT="$local_myurls_port"');
    expect(common).toContain('export LOCAL_SHORT_MYURLS_PORT="$local_short_myurls_port"');
    expect(common).toContain('export LOCAL_SUBCONVERTER_PORT="$local_subconverter_port"');
    expect(common).toContain('export LOCAL_VITE_PORT="$local_vite_port"');
    expect(common).toContain('temporary_env=$local_env_file.tmp.$$');
    expect(common).toContain('API_URL=http://127.0.0.1:$local_subconverter_port');
    expect(dependencies).toContain('docker compose up -d --wait redis myurls-app myurls-short subconverter');
    expect(override).toContain('NODE_ENV: test');
    expect(override).toContain('TURNSTILE_HOSTNAME: short.local.test');
    expect(override).toContain('HTTPS_PROXY: ""');
    expect(override).toContain('https_proxy: ""');
    expect(override).toContain('127.0.0.1:${LOCAL_MYURLS_PORT:-18082}:3000');
    expect(override).toContain('http://127.0.0.1:${LOCAL_SHORT_MYURLS_PORT:-18083}');
    expect(override).toContain('local-published: {}');
    expect(override).toContain('local-published:\n    internal: false');
    expect(dependencies).toContain('SHORT MyUrls is not ready.');
    expect(vite).toContain('Number.isInteger(localMyUrlsPortNumber)');
    expect(vite).toContain('localMyUrlsPortNumber < 1024');
    expect(vite).toContain('localMyUrlsPortNumber > 65535');
    expect(vite).toContain("'/short-api'");
    expect(verifier).toContain('/short-api/links');
    expect(verifier).toContain('--connect-timeout');
    expect(verifier).toContain('--max-time');
    for (const source of [start, dependencies]) {
      expect(source).not.toMatch(/go build|cmake|MYURLS_SOURCE_DIR|git clone/u);
    }
  });

  it('stops dependencies without deleting development data volumes', async () => {
    const dependencies = await read('scripts/local/deps.sh');

    expect(dependencies).toContain('docker compose stop myurls-app myurls-short subconverter redis');
    expect(dependencies).not.toContain('down --volumes');
    expect(dependencies).not.toContain('volume rm');
  });
});
