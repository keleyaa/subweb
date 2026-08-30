import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

describe('Compose-first local development workflow', () => {
  it('uses pinned containers plus Vite instead of compiling external source', async () => {
    const [start, dependencies, override, vite, verifier] = await Promise.all([
      read('scripts/local/start.sh'),
      read('scripts/local/deps.sh'),
      read('compose.dev.yaml'),
      read('vite.config.mjs'),
      read('scripts/verify-local-dev.sh'),
    ]);

    expect(start).toContain('npm run serve');
    expect(dependencies).toContain('docker compose up -d --wait redis myurls-app myurls-short subconverter');
    expect(override).toContain('NODE_ENV: test');
    expect(override).toContain('TURNSTILE_HOSTNAME: short.local.test');
    expect(override).toContain('127.0.0.1:${LOCAL_MYURLS_PORT:-18082}:3000');
    expect(override).toContain('http://127.0.0.1:${LOCAL_SHORT_MYURLS_PORT:-18083}');
    expect(dependencies).toContain('SHORT MyUrls is not ready.');
    expect(vite).toContain("'/short-api'");
    expect(verifier).toContain('/short-api/links');
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
