import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const verifier = new URL('../../scripts/verify-redis-operations.sh', import.meta.url).pathname;
const dockerIntegrationEnabled = process.env.RUN_DOCKER_INTEGRATION === '1';

describe('integrated stack privacy sentinel', () => {
  it('scans every service log without printing sensitive values', async () => {
    const source = await readFile(verifier, 'utf8');

    for (const service of ['gateway', 'myurls-app', 'myurls-short', 'subconverter', 'redis']) {
      expect(source).toContain(service);
    }
    expect(source).toContain('umask 077');
    expect(source).toContain('REDISCLI_AUTH');
    expect(source).toContain('subconverter_runs_as_101');
    expect(source).not.toMatch(/printf[^\n]*"\$(?:sentinel_value|secret_value|password|ip_hash_secret)"/i);
    expect(source).not.toMatch(/set\s+-x/);
  });

  it.skipIf(!dockerIntegrationEnabled)(
    'keeps the subscription sentinel and internal token out of all service logs and output',
    () => {
      const result = spawnSync('sh', [verifier], {
        cwd: root,
        encoding: 'utf8',
        timeout: 12 * 60 * 1000,
        maxBuffer: 1024 * 1024,
      });

      expect(result.status, result.stderr).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'Unified Redis backup, restore, and service recovery verification passed.',
      );
    },
    12 * 60 * 1000,
  );
});
