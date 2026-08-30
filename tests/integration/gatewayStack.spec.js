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
    expect(`${result.stdout}${result.stderr}`).toContain('Usage: verify-integrated-stack.sh');
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/docker: not found/i);
  });

  it('limits cleanup to the exact generated Compose project and its own temporary directory', async () => {
    const source = await readFile(verifier, 'utf8');

    expect(source).toContain('docker compose -p "$project_name"');
    expect(source).toContain('down --volumes --remove-orphans');
    expect(source).not.toMatch(/docker\s+(?:system|volume|network|container)\s+prune/);
    expect(source).not.toMatch(/docker\s+(?:rm|rmi)\b/);
    expect(source).not.toContain('pkill');
    expect(source).toContain('${TMPDIR:-/tmp}/subweb-integration.XXXXXX');
    expect(source).not.toContain('mktemp -d /private/tmp');
    expect(source).toContain('scripts/verify-version-locks.mjs');
    expect(source).toContain('"MYURLS_IMAGE=$myurls_test_image"');
  });

  it('rejects arguments before checking optional runtime tools', async () => {
    const source = await readFile(verifier, 'utf8');
    expect(source.indexOf('[ "$#" -eq 0 ]')).toBeGreaterThanOrEqual(0);
    expect(source.indexOf('[ "$#" -eq 0 ]')).toBeLessThan(source.indexOf('for command in docker curl node openssl'));
  });

  it('keeps integration cleanup and runtime checks scoped to the generated stack', async () => {
    const source = await readFile(verifier, 'utf8');

    expect(source).toContain("'SHORT_DOMAIN=short.test'");
    expect(source).toContain('compose up -d --build --wait');
    expect(source).toContain("for service_port in 'redis 6379' 'myurls-app 3000' 'myurls-short 3000' 'subconverter 25500'");
    expect(source).toContain('compose logs --no-color --tail 500');
    expect(source).toContain('/health/live');
    expect(source).toContain('/health/ready');
    expect(source).toContain('compose exec -T myurls-short curl --fail --silent');
    expect(source).toContain('myurls-app-edge');
    expect(source).toContain('myurls-short-edge');
    expect(source).toContain('post_json_from_client');
    expect(source).toContain('Gateway did not preserve distinct client identities');
    expect(source).toContain('SHORT MyUrls creation returned');
    expect(source).toContain("'{\"url\":\"https://example.com/short-hostname-verification\"}' /api/links");
    expect(source).not.toContain('gateway-tls');
    expect(source).not.toContain('TLS 证书');
  });

  it('keeps a clean privacy scan successful under set -e', async () => {
    const source = await readFile(verifier, 'utf8');
    expect(source).toContain('grep -Fq "$sentinel_value" "$service_log" && fail');
    expect(source).toContain("grep -Fq 'test-token' \"$service_log\" && fail");
    expect(source).toContain('grep -Fq "$redis_password" "$service_log" && fail');
    expect(source).toContain('grep -Fq "$ip_hash_secret" "$service_log" && fail');
  });

  it.skipIf(!dockerIntegrationEnabled)(
    'verifies APP, Rust MyUrls, challenge retry, persistence, and private ports',
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
        'MyUrls integrated stack verification passed.',
      ]) {
        expect(output).toContain(marker);
      }
    },
    12 * 60 * 1000,
  );
});
