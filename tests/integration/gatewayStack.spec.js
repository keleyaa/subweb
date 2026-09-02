import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const verifier = new URL('../../scripts/verify-integrated-stack.sh', import.meta.url).pathname;
const testCompose = new URL('../../compose.test.yaml', import.meta.url).pathname;

describe('unified Docker Gateway stack entrypoint', () => {
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

  it('delegates the transitional integration entrypoint to unified recovery verification', async () => {
    const source = await readFile(verifier, 'utf8');

    expect(source).toContain('exec "$script_directory/verify-redis-operations.sh"');
    for (const legacyContract of [
      'compose.hardened.yaml',
      'request-policy',
      'Dockerfile.simple',
      'nginx/',
      'verify-version-locks.mjs',
    ]) {
      expect(source).not.toContain(legacyContract);
    }
  });

  it('keeps the published production MyUrls image contract for the unified stack', async () => {
    const source = await readFile(testCompose, 'utf8');

    expect(source).toContain('NODE_ENV: production');
    expect(source).toContain('TURNSTILE_MODE: cloudflare');
    expect(source).toContain('CREATE_DIRECT_LIMIT_10M: "100"');
    expect(source).not.toContain('TURNSTILE_MODE: test');
    expect(source).not.toContain('TEST_STORE');
  });
});
