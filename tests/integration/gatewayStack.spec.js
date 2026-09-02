import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const verifier = new URL('../../scripts/verify-integrated-stack.sh', import.meta.url).pathname;
const testCompose = new URL('../../compose.test.yaml', import.meta.url).pathname;
const unifiedVerifier = new URL('../../scripts/verify-unified-stack.sh', import.meta.url).pathname;
const fixtureCompose = new URL('../../compose.fixture.yaml', import.meta.url).pathname;
const fixtureDockerfile = new URL('../../tests/fixtures/conversion-upstream/Dockerfile', import.meta.url).pathname;
const fixtureSource = new URL('../../tests/fixtures/conversion-upstream/main.go', import.meta.url).pathname;

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
      'application/manifest+json',
      'CUSTOM_BACKEND_ENABLED=false',
      'Authorization',
      'X-Forwarded-For',
      'myurls-app',
      'myurls-short',
      'subconverter',
      'gateway',
      'redis',
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

  it('keeps the published production MyUrls image contract for the unified stack', async () => {
    const source = await readFile(testCompose, 'utf8');

    expect(source).toContain('NODE_ENV: production');
    expect(source).toContain('TURNSTILE_MODE: cloudflare');
    expect(source).toContain('CREATE_DIRECT_LIMIT_10M: "100"');
    expect(source).not.toContain('TURNSTILE_MODE: test');
    expect(source).not.toContain('TEST_STORE');
  });

  it('uses an isolated fixture profile for deterministic dependency-boundary limits', async () => {
    const [compose, dockerfile, source, verifierSource] = await Promise.all([
      readFile(fixtureCompose, 'utf8'),
      readFile(fixtureDockerfile, 'utf8'),
      readFile(fixtureSource, 'utf8'),
      readFile(unifiedVerifier, 'utf8'),
    ]);

    expect(compose).toContain('subconverter:');
    expect(compose).toContain('CONVERSION_REQUEST_TIMEOUT_MS: "400"');
    expect(compose).toContain('CONVERSION_DNS_TIMEOUT_MS: "100"');
    expect(compose).toContain('CONVERSION_EGRESS_CONNECT_TIMEOUT_MS: "200"');
    expect(compose).toContain('CONVERSION_MAX_RESPONSE_BYTES: "1024"');
    expect(dockerfile).toContain('golang:1.25-alpine@sha256:1ae0735f00daffa3aaf1363a5184c0d2dc55c78e3db4ec70241cdac97bf84b59');
    expect(source).toContain('fixture://echo');
    expect(source).toContain('fixture://slow');
    expect(source).toContain('fixture://large');
    expect(verifierSource).toContain('fixture_node_uri');
  });

  it('pins SubConverter to its bundled default config instead of a remote default', async () => {
    const entrypoint = await readFile(
      new URL('../../scripts/subconverter-docker-entrypoint.sh', import.meta.url),
      'utf8',
    );

    expect(entrypoint).toContain(
      'default_external_config = "config/example_external_config.ini"',
    );
    expect(entrypoint).not.toContain('testingcf.jsdelivr.net');
  });
});
