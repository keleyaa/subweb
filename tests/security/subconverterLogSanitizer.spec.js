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

  it('collapses contiguous retryable egress warning bursts without hiding the first warning', () => {
    const result = spawnSync(
      'sh',
      [
        supervisor,
        'sh',
        '-c',
        'printf "%s\\n" "$LOG_LINES"',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          LOG_LINES: [
            '2026/09/05 01:21:49.418 [16 Thread-2][WARN] 出站请求遇到可恢复网络错误，正在分散退避后重试： attempt=1 delay_ms=200 code=5。',
            '2026/09/05 01:21:49.419 [16 Thread-2][WARN] 出站请求遇到可恢复网络错误，正在分散退避后重试： attempt=1 delay_ms=200 code=5。',
            '2026/09/05 01:21:49.420 [16 Thread-2][WARN] 出站请求遇到可恢复网络错误，正在分散退避后重试： attempt=1 delay_ms=200 code=5。',
            '2026/09/05 01:21:50.000 [16 Thread-2][INFO] conversion ready',
          ].join('\n'),
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.match(/出站请求遇到可恢复网络错误/g)).toHaveLength(1);
    expect(result.stdout).toContain(
      'SubConverter log filter: suppressed 2 repeated retryable egress warnings (code=5)',
    );
    expect(result.stdout).toContain('conversion ready');
  });

  it('uses the sanitizer and a transient privacy configuration in both unified deployment profiles', async () => {
    await expect(access(rootFile('scripts/subconverter-docker-entrypoint.sh'))).resolves.toBeUndefined();
    await expect(access(rootFile('scripts/subconverter-log-filter.awk'))).resolves.toBeUndefined();
    const [enabledCompose, disabledCompose] = await Promise.all([
      readFile(rootFile('compose.yaml'), 'utf8'),
      readFile(rootFile('compose.disabled-short-links.yaml'), 'utf8'),
    ]);

    for (const compose of [enabledCompose, disabledCompose]) {
      expect(compose).toContain('/usr/local/bin/subweb-subconverter-entrypoint');
      expect(compose).toContain('/usr/local/bin/subweb-log-supervisor');
      expect(compose).toContain('/usr/local/bin/subweb-log-filter.awk');
      expect(compose).toContain('subconverter-docker-entrypoint');
      expect(compose).toContain('read_only: true');
    }
  });
});
