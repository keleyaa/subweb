import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('requires distinct usable host addresses inside the local MyUrls subnet', async () => {
    const commonPath = new URL('../../scripts/local/common.sh', import.meta.url).pathname;
    const runValidation = (subnet, gateway, myurls) => spawnSync(
      'sh',
      ['-c', '. "$1"; validate_local_ipv4s_in_subnet "$2" "$3" "$4"', '--', commonPath, subnet, gateway, myurls],
      { encoding: 'utf8' },
    );

    expect(runValidation('172.30.255.0/29', '172.30.255.1', '172.30.255.6').status).toBe(0);
    expect(runValidation('172.30.255.0/29', '172.30.255.0', '172.30.255.3').status).not.toBe(0);
    expect(runValidation('172.30.255.0/29', '172.30.255.2', '172.30.255.7').status).not.toBe(0);
    expect(runValidation('172.30.255.0/31', '172.30.255.0', '172.30.255.1').status).not.toBe(0);
    expect(runValidation('172.30.255.0/32', '172.30.255.0', '172.30.255.0').status).not.toBe(0);
  });

  it('exits on a signal while updating the temporary local environment', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'subweb-local-signal-'));
    try {
      const fixtureScripts = join(fixture, 'scripts/local');
      const runtimeDirectory = join(fixture, '.runtime/local');
      const bin = join(fixture, 'bin');
      await mkdir(fixtureScripts, { recursive: true });
      await mkdir(runtimeDirectory, { recursive: true });
      await mkdir(bin, { recursive: true });
      await writeFile(join(fixtureScripts, 'common.sh'), await readFile(new URL('../../scripts/local/common.sh', import.meta.url)));
      await writeFile(join(runtimeDirectory, 'compose.env'), 'API_URL=http://127.0.0.1:18081\nSUBWEB_PORT=18081\n');
      await writeFile(join(fixture, 'scripts/runtime-image-contract.mjs'), '');
      for (const command of ['docker', 'openssl']) {
        await writeFile(join(bin, command), '#!/bin/sh\nexit 0\n');
        await chmod(join(bin, command), 0o755);
      }
      await writeFile(join(bin, 'node'), '#!/bin/sh\nprintf "REDIS_IMAGE=redis\\nSUBCONVERTER_IMAGE=subconverter\\nMYURLS_IMAGE=myurls\\n"\n');
      await chmod(join(bin, 'node'), 0o755);
      await writeFile(join(bin, 'sed'), '#!/bin/sh\ncase "$*" in\n  *compose.env*) kill -TERM "$PPID"; exit 0 ;;\n  *) exec /usr/bin/sed "$@" ;;\nesac\n');
      await chmod(join(bin, 'sed'), 0o755);

      const result = spawnSync('sh', ['-c', '. "$1"; prepare_local_environment', '--', join(fixtureScripts, 'common.sh')], {
        cwd: fixture,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect((await readdir(runtimeDirectory)).filter((name) => name.startsWith('compose.env.tmp.'))).toEqual([]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
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
