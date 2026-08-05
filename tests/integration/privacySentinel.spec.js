import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const verifier = new URL('../../scripts/verify-integrated-stack.sh', import.meta.url).pathname;
const dockerIntegrationEnabled = process.env.RUN_DOCKER_INTEGRATION === '1';

describe('integrated stack privacy sentinel', () => {
  it('scans all four service logs without printing sensitive values', async () => {
    const source = await readFile(verifier, 'utf8');

    for (const service of ['gateway', 'myurls', 'subconverter', 'redis']) {
      expect(source).toContain(service);
    }
    expect(source).toContain('哨兵泄漏数=%s');
    expect(source).toContain('?subscription_token=$sentinel_value');
    expect(source).not.toContain('?token=$sentinel_value');
    expect(source).toContain('grep -Fq "$subscription_url" "$service_log"');
    expect(source).not.toMatch(/printf[^\n]*"\$(?:sentinel_value|secret_value)"/i);
    expect(source).not.toMatch(/set\s+-x/);
  });

  it.skipIf(!dockerIntegrationEnabled)(
    'keeps the subscription sentinel and internal token out of all service logs and output',
    () => {
      const result = spawnSync('sh', [verifier, '--mode', 'behind-proxy'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 12 * 60 * 1000,
        maxBuffer: 1024 * 1024,
      });

      expect(result.status, result.stderr).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain('哨兵泄漏数=0');
    },
    12 * 60 * 1000,
  );
});
