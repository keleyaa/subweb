import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Compose-first local workflow contract', () => {
  it('uses one Linux Docker workflow and always tears dependencies down', async () => {
    const workflow = await readFile(new URL('../../.github/workflows/local-dev.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('ubuntu-24.04');
    expect(workflow).toContain('./scripts/verify-local-dev.sh');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('./scripts/local/stop.sh');
    expect(workflow).not.toContain('bootstrap.sh');
  });

  it('verifies Rust MyUrls creation and redirect through the Vite proxy', async () => {
    const verifier = await readFile(new URL('../../scripts/verify-local-dev.sh', import.meta.url), 'utf8');
    expect(verifier).toContain('/short-api/links');
    expect(verifier).toContain('Content-Type: application/json');
    expect(verifier).toContain("status=$(curl");
    expect(verifier).toContain('Expected a 302 redirect');
  });

  it('isolates its generated local Compose environment from release exports', async () => {
    const verifier = await readFile(new URL('../../scripts/verify-local-dev.sh', import.meta.url), 'utf8');
    const isolationBlock = `unset \\
  APP_DOMAIN API_DOMAIN API_URL SHORT_DOMAIN SUBWEB_PORT \\
  REDIS_PASSWORD IP_HASH_SECRET TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY`;

    expect(verifier).toContain(isolationBlock);
    expect(verifier.indexOf(isolationBlock)).toBeLessThan(verifier.indexOf('"$script_directory/local/deps.sh" up'));
  });

  it('derives three distinct local ports and leaves Redis private', async () => {
    const [common, override] = await Promise.all([
      readFile(new URL('../../scripts/local/common.sh', import.meta.url), 'utf8'),
      readFile(new URL('../../compose.dev.yaml', import.meta.url), 'utf8'),
    ]);
    expect(common).toContain('LOCAL_VITE_PORT');
    expect(common).toContain('LOCAL_MYURLS_PORT');
    expect(common).toContain('LOCAL_SUBWEB_PORT');
    expect(override).not.toMatch(/redis:[\s\S]*?ports:/u);
    expect(override).toContain('myurls-app:');
    expect(override).toContain('myurls-short:');
    expect(override).toContain('subconverter:');
    expect(override).toContain('NODE_ENV: development');
    expect(override).toContain('TURNSTILE_ENABLED: "false"');
    expect(override).not.toContain('subweb:');
    expect(override).not.toContain('myurls:');
  });
});
