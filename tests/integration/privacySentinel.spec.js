import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const unifiedVerifier = new URL('../../scripts/verify-unified-stack.sh', import.meta.url).pathname;

describe('integrated stack privacy sentinel', () => {
  it('scans service logs for secrets without printing sensitive values', async () => {
    const source = await readFile(unifiedVerifier, 'utf8');

    expect(source).toContain('docker compose logs --no-log-prefix gateway');
    expect(source).toContain('$ip_hash_secret');
    expect(source).toContain('umask 077');
    expect(source).not.toMatch(/set\s+-x/u);
    expect(source).not.toMatch(/printf[^\n]*"\$(?:sentinel_value|secret_value|password|ip_hash_secret)"/iu);
    expect(source).not.toContain('REDISCLI_AUTH');
  });
});
