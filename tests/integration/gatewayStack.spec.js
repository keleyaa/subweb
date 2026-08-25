import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const verifier = new URL('../../scripts/verify-integrated-stack.sh', import.meta.url).pathname;
const dockerIntegrationEnabled = process.env.RUN_DOCKER_INTEGRATION === '1';

describe('integrated Docker gateway stack', () => {
  it.each([
    [['--mode']],
    [['--mode', 'behind-proxy']],
    [['--unexpected']],
  ])('rejects invalid verifier arguments before contacting Docker: %j', (args) => {
    const result = spawnSync('sh', [verifier, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/用法|缺少 Docker/);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/docker: not found/i);
  });

  it('limits cleanup to the exact generated Compose project and its own temporary directory', async () => {
    const source = await readFile(verifier, 'utf8');

    expect(source).toContain('docker compose -p "$project_name"');
    expect(source).toContain('down --volumes --remove-orphans');
    expect(source).not.toMatch(/docker\s+(?:system|volume|network|container)\s+prune/);
    expect(source).not.toMatch(/docker\s+(?:rm|rmi)\b/);
    expect(source).not.toContain('pkill');
    expect(source).toContain('temporary_root=${TMPDIR:-/tmp}');
    expect(source).not.toContain('mktemp -d /private/tmp');
    expect(source).toContain('scripts/verify-version-locks.mjs');
    expect(source).toContain("printf 'MYURLS_IMAGE=%s\\n' \"$myurls_test_image\"");
  });

  it('rejects arguments before checking optional runtime tools', async () => {
    const source = await readFile(verifier, 'utf8');
    expect(source.indexOf('[ "$#" -eq 0 ]')).toBeGreaterThanOrEqual(0);
    expect(source.indexOf('[ "$#" -eq 0 ]')).toBeLessThan(source.indexOf('command -v node'));
  });

  it('keeps integration cleanup and runtime checks scoped to the generated stack', async () => {
    const source = await readFile(verifier, 'utf8');

    expect(source).toContain("printf 'SHORT_DOMAIN=short.test\\n'");
    expect(source).toContain("wait_for_health 'gateway myurls subconverter redis'");
    expect(source).toContain('assert_internal_ports_private');
    expect(source).toContain('scan_logs');
    expect(source).not.toContain('gateway-tls');
    expect(source).not.toContain('TLS 证书');
  });

  it('keeps a clean privacy scan successful under set -e', async () => {
    const source = await readFile(verifier, 'utf8');
    const start = source.indexOf('scan_logs() {');
    const end = source.indexOf('\n}\n\nmyurls_api_token=', start);
    const scan = source.slice(start, end);

    expect(scan).toContain('if grep -Fq "$sentinel_value" "$service_log"; then');
    expect(scan).toContain('if grep -Fq "$myurls_api_token" "$service_log"; then');
  });

  it.skipIf(!dockerIntegrationEnabled)(
    'verifies APP, API, authorization replacement, short links, persistence, and private ports',
    () => {
      const result = spawnSync('sh', [verifier], {
        cwd: root,
        encoding: 'utf8',
        timeout: 12 * 60 * 1000,
        maxBuffer: 1024 * 1024,
      });

      expect(result.status, result.stderr).toBe(0);
      const output = `${result.stdout}\n${result.stderr}`;
      for (const marker of [
        '单一 HTTP 三域名集成验证=通过',
      ]) {
        expect(output).toContain(marker);
      }
    },
    12 * 60 * 1000,
  );
});
