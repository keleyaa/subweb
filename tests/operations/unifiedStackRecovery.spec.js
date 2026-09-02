import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const rootFile = (path) => new URL(path, root);

describe('unified stack recovery contract', () => {
  it('uses an isolated unified stack to verify backup, restore, and service recovery', async () => {
    const verifier = await readFile(rootFile('scripts/verify-redis-operations.sh'), 'utf8');

    expect(verifier).toContain('compose.yaml:$project_root/compose.test.yaml');
    expect(verifier).not.toContain('compose.hardened.yaml');
    expect(verifier).not.toContain('migrate-myurls-v1.sh');
    expect(verifier).toContain('docker compose up -d --build --wait');
    expect(verifier).toContain('myurl:link:$1');
    expect(verifier).toContain('backup-redis.sh');
    expect(verifier).toContain('restore-redis.sh');
    expect(verifier).toContain('docker compose restart redis');
    expect(verifier).toContain('docker compose restart gateway');
    expect(verifier).toContain('docker compose restart subconverter');
    expect(verifier).toContain('subconverter_runs_as_101');
    expect(verifier).toContain('/proc/1/status');
    expect(verifier).toContain('CapEff:');
    expect(verifier).toContain('0000000000000000');
    expect(verifier).toContain('Host: short.test');
    expect(verifier).not.toContain('-a "$REDIS_PASSWORD"');
    expect(verifier).not.toContain('printf \'%s\\n\' "$password"');
  });

  it('documents backup and restore through the feature-aware CLI', async () => {
    const documentation = await readFile(rootFile('docs/operations.md'), 'utf8');

    expect(documentation).toContain('./scripts/subweb.sh backup --output');
    expect(documentation).toContain('./scripts/subweb.sh restore');
    expect(documentation).toContain('--backup');
    expect(documentation).toContain('--confirm-stop-writes');
    expect(documentation).toContain('SHORT_LINKS_ENABLED=false');
    expect(documentation).toContain('npm run verify:operations');
    expect(documentation).not.toContain('compose.hardened.yaml');
  });
});
