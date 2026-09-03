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
    expect(verifier).toContain('./node_modules/.bin/vite');
    expect(common).toContain('export LOCAL_MYURLS_PORT="$local_myurls_port"');
    expect(common).toContain('export LOCAL_SUBWEB_PORT="$local_subweb_port"');
    expect(common).toContain('export LOCAL_VITE_PORT="$local_vite_port"');
    expect(common).toContain('temporary_env=$local_env_file.tmp.$$');
    expect(common).toContain('API_URL=http://127.0.0.1:$local_subweb_port');
    expect(dependencies).toContain('docker compose up -d --build --remove-orphans --wait gateway subconverter myurls-app myurls-short redis');
    expect(override).toContain('NODE_ENV: development');
    expect(override).toContain('TURNSTILE_ENABLED: "false"');
    expect(override).toContain('PUBLIC_BASE_URL: "http://127.0.0.1:${LOCAL_MYURLS_PORT:-18082}"');
    expect(override).toContain('127.0.0.1:${LOCAL_MYURLS_PORT:-18082}:3000');
    expect(override).toContain('Docker Desktop does not publish ports from an internal-only container.');
    expect(override).toContain('networks:\n      default: {}');
    expect(dependencies).toContain("Local dependencies are ready.");
    expect(vite).toContain('Number.isInteger(localGatewayPortNumber)');
    expect(vite).toContain('localGatewayPortNumber < 1024');
    expect(vite).toContain('localGatewayPortNumber > 65535');
    expect(vite).toContain("'/short-api'");
    expect(verifier).toContain('/short-api/links');
    expect(verifier).toContain('LOCAL_SUBWEB_PORT="$local_subweb_port"');
    expect(verifier).toContain('--connect-timeout');
    expect(verifier).toContain('--max-time');
    for (const source of [start, dependencies]) {
      expect(source).not.toMatch(/go build|cmake|MYURLS_SOURCE_DIR|git clone/u);
    }
  });

  it('stops dependencies without deleting development data volumes', async () => {
    const dependencies = await read('scripts/local/deps.sh');

    expect(dependencies).toContain('docker compose stop gateway subconverter myurls-app myurls-short redis');
    expect(dependencies).not.toContain('down --volumes');
    expect(dependencies).not.toContain('volume rm');
  });

  it('removes verifier-owned Compose resources without deleting data volumes', async () => {
    const [dependencies, verifier] = await Promise.all([
      read('scripts/local/deps.sh'),
      read('scripts/verify-local-dev.sh'),
    ]);

    expect(verifier).toContain('"$script_directory/local/deps.sh" remove');
    expect(dependencies).toContain('remove)');
    expect(dependencies).toContain('docker compose down --remove-orphans');
    expect(dependencies).not.toContain('docker compose down --volumes');
  });
});
