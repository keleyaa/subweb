import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const verifier = new URL('../../scripts/verify-integrated-stack.sh', import.meta.url).pathname;
const testCompose = new URL('../../compose.test.yaml', import.meta.url).pathname;
const unifiedVerifier = new URL('../../scripts/verify-unified-stack.sh', import.meta.url).pathname;

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

  it('delegates the stable integration entrypoint to unified production smoke verification', async () => {
    const [entrypoint, source] = await Promise.all([
      readFile(verifier, 'utf8'),
      readFile(unifiedVerifier, 'utf8'),
    ]);

    expect(entrypoint).toContain('exec "$script_directory/verify-unified-stack.sh"');
    for (const contract of [
      'compose.yaml',
      'compose.test.yaml',
      'compose.disabled-short-links.yaml',
      'request app.test',
      'request api.app.test',
      'request short.test',
      'short-api/links',
      'short.test',
      'subconverter',
      'gateway',
      'disabled profile',
    ]) {
      expect(source).toContain(contract);
    }
    for (const legacyContract of [
      'compose.hardened.yaml',
      'request-policy',
      'Dockerfile.simple',
      'nginx/',
    ]) {
      expect(source).not.toContain(legacyContract);
    }
  });

  it('keeps the embedded short-link contract for the unified stack', async () => {
    const [production, test] = await Promise.all([
      readFile(new URL('../../compose.yaml', import.meta.url), 'utf8'),
      readFile(testCompose, 'utf8'),
    ]);

    expect(production).toContain('SHORT_LINK_DB_PATH: /data/links.db');
    expect(production).toContain('TURNSTILE_ENABLED: "true"');
    expect(production).not.toContain('MYURLS_UPSTREAM');
    expect(production).not.toContain('REDIS_URL');
    expect(test).toContain('TURNSTILE_ENABLED: "false"');
    expect(test).not.toContain('TEST_STORE');
  });

  it('generates a local SubConverter default external config instead of a bundled or remote one', async () => {
    const entrypoint = await readFile(
      new URL('../../scripts/subconverter-docker-entrypoint.sh', import.meta.url),
      'utf8',
    );

    expect(entrypoint).toContain('default_config_path="$base_path/subweb_default.ini"');
    expect(entrypoint).toContain('clash_rule_base=base/forcerule.yml');
    expect(entrypoint).toContain('default_external_config = \\"$default_config_path\\"');
    expect(entrypoint).not.toContain('custom_proxy_group=!!import:');
    expect(entrypoint).not.toContain('default_external_config = ""');
    expect(entrypoint).not.toContain('testingcf.jsdelivr.net');
  });
});
