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
    expect(workflow).toContain('quality:');
    expect(workflow).toContain('timeout-minutes: 45');
    expect(workflow).not.toContain('bootstrap.sh');
  });

  it('verifies Rust MyUrls creation and redirect through the Vite proxy', async () => {
    const verifier = await readFile(new URL('../../scripts/verify-local-dev.sh', import.meta.url), 'utf8');
    expect(verifier).toContain('/short-api/links');
    expect(verifier).toContain('Content-Type: application/json');
    expect(verifier).toContain("status=$(curl");
    expect(verifier).toContain('Expected a 302 redirect');
  });

  it('isolates generated local Compose values from contaminated parent release exports', async () => {
    const [common, verifier] = await Promise.all([
      readFile(new URL('../../scripts/local/common.sh', import.meta.url), 'utf8'),
      readFile(new URL('../../scripts/verify-local-dev.sh', import.meta.url), 'utf8'),
    ]);
    const isolationBlock = `unset \\
  APP_DOMAIN API_DOMAIN API_URL SHORT_DOMAIN SUBWEB_PORT \\
  REDIS_PASSWORD IP_HASH_SECRET TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY \\
  REDIS_IMAGE SUBCONVERTER_IMAGE MYURLS_IMAGE \\
  MYURLS_NETWORK_SUBNET MYURLS_GATEWAY_IP MYURLS_IP MYURLS_TRUST_PROXY_CIDR \\
  SUBWEB_LOCAL_PROJECT_NAME`;

    expect(verifier).toContain(isolationBlock);
    expect(verifier).toContain('export SUBWEB_LOCAL_PROJECT_NAME="subweb-local-verify-$(openssl rand -hex 6)"');
    expect(verifier).toContain('test_network_subnet=$("$script_directory/select-test-network.sh")');
    expect(verifier).toContain('export LOCAL_MYURLS_NETWORK_SUBNET="$test_network_subnet"');
    expect(verifier).toContain('export LOCAL_MYURLS_GATEWAY_IP="$test_network_prefix.2"');
    expect(verifier).toContain('export LOCAL_MYURLS_IP="$test_network_prefix.3"');
    expect(verifier).toContain('export LOCAL_MYURLS_TRUST_PROXY_CIDR="$LOCAL_MYURLS_GATEWAY_IP/32"');
    expect(verifier).not.toContain('export MYURLS_NETWORK_SUBNET="$test_network_subnet"');
    expect(common).toContain('export MYURLS_NETWORK_SUBNET="$local_myurls_network_subnet"');
    expect(common).toContain('export MYURLS_GATEWAY_IP="$local_myurls_gateway_ip"');
    expect(common).toContain('export MYURLS_IP="$local_myurls_ip"');
    expect(common).toContain('export MYURLS_TRUST_PROXY_CIDR="$local_myurls_trust_proxy_cidr"');
    expect(common).toContain('export REDIS_IMAGE="$local_redis_image"');
    expect(common).toContain('export SUBCONVERTER_IMAGE="$local_subconverter_image"');
    expect(common).toContain('export MYURLS_IMAGE="$local_myurls_image"');
    expect(verifier).toContain('"$script_directory/local/deps.sh" remove-volumes');
    expect(verifier.indexOf('trap cleanup EXIT HUP INT TERM')).toBeLessThan(verifier.indexOf('"$script_directory/local/deps.sh" up'));
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
    expect(override).toContain('myurls:');
    expect(override).toContain('subconverter:');
    expect(override).toContain('NODE_ENV: development');
    expect(override).toContain('TURNSTILE_ENABLED: "false"');
    expect(override).not.toContain('subweb:');
    expect(override.match(/^ {2}myurls:/gmu)).toHaveLength(1);
  });
});
