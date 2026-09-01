import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const rootFile = (path) => new URL(path, root);
const supervisor = rootFile('scripts/subconverter-log-supervisor.sh').pathname;

describe('SubConverter log sanitization', () => {
  it('removes raw and encoded subscription addresses before they reach a log sink', () => {
    const sentinel = 'subweb-log-sentinel-4b02f5d8';
    const rawUrl = `https://subscription.example.test/api/v1/client/subscribe?custom_credential=${sentinel}`;
    const encodedUrl = encodeURIComponent(rawUrl);
    const result = spawnSync(
      'sh',
      [
        supervisor,
        'sh',
        '-c',
        'printf "%s\\n" "$RAW_URL" "uri=/sub?target=clash&url=$ENCODED_URL" "uri=/diagnostic?opaque=$ENCODED_URL" "Authorization: Bearer $SENTINEL"',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          RAW_URL: rawUrl,
          ENCODED_URL: encodedUrl,
          SENTINEL: sentinel,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain(sentinel);
    expect(result.stdout).not.toContain('subscription.example.test');
    expect(result.stdout).not.toContain(encodedUrl);
    expect(result.stdout).toContain('[redacted-uri]');
    expect(result.stdout).toContain('url=[redacted-uri]');
    expect(result.stdout).toContain('Authorization: [redacted]');
  });

  it('uses the sanitizer and a transient privacy configuration in both deployment modes', async () => {
    await expect(access(rootFile('scripts/subconverter-docker-entrypoint.sh'))).resolves.toBeUndefined();
    await expect(access(rootFile('scripts/subconverter-log-filter.awk'))).resolves.toBeUndefined();
    const [hardenedCompose, simpleDockerfile, simpleStart] = await Promise.all([
      readFile(rootFile('compose.hardened.yaml'), 'utf8'),
      readFile(rootFile('Dockerfile.simple'), 'utf8'),
      readFile(rootFile('scripts/simple-start.sh'), 'utf8'),
    ]);

    expect(hardenedCompose).toContain('/usr/local/bin/subweb-subconverter-entrypoint');
    expect(hardenedCompose).toContain('/usr/local/bin/subweb-log-supervisor');
    expect(hardenedCompose).toContain('/usr/local/bin/subweb-log-filter.awk');
    expect(hardenedCompose).toContain('/run/subconverter:mode=0700');
    expect(simpleDockerfile).toContain('/usr/local/bin/subweb-subconverter-entrypoint');
    expect(simpleDockerfile).toContain('/usr/local/bin/subweb-log-supervisor');
    expect(simpleDockerfile).toContain('/usr/local/bin/subweb-log-filter.awk');
    expect(simpleStart).toContain('/tmp/subconverter');
  });
});
