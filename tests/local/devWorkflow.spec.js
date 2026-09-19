import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { resolveRuntimeImages } from '../../scripts/runtime-image-contract.mjs';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

describe('Compose-first local development workflow', () => {
  it('uses pinned containers plus Vite instead of compiling external source', async () => {
    const [start, dependencies, common, override, vite, verifier] = await Promise.all([
      read('scripts/local/start.sh'),
      read('scripts/local/deps.sh'),
      read('scripts/local/common.sh'),
      read('compose.dev.yaml'),
      read('vite.config.mjs'),
      read('scripts/verify-local-dev.sh'),
    ]);

    expect(start).toContain('npm run serve');
    expect(verifier).toContain('./node_modules/.bin/vite');
    expect(common).toContain('export LOCAL_MYURLS_PORT="$local_myurls_port"');
    expect(common).toContain('export LOCAL_SUBWEB_PORT="$local_subweb_port"');
    expect(common).toContain('export LOCAL_VITE_PORT="$local_vite_port"');
    expect(common).toContain('temporary_env=$local_env_file.tmp.$$');
    expect(common).toContain('API_URL=http://127.0.0.1:$local_subweb_port');
    expect(dependencies).toContain('docker compose up -d --build --remove-orphans --wait gateway subconverter myurls redis');
    expect(override).toContain('NODE_ENV: development');
    expect(override).toContain('TURNSTILE_ENABLED: "false"');
    expect(override).toContain('PUBLIC_BASE_URL: "http://127.0.0.1:${LOCAL_MYURLS_PORT:-18082}"');
    expect(override).toContain('127.0.0.1:${LOCAL_MYURLS_PORT:-18082}:3000');
    expect(override).toContain('Docker Desktop does not publish ports from an internal-only container.');
    expect(override).toContain('networks:\n      default: {}');
    expect(dependencies).toContain("Local dependencies are ready.");
    expect(vite).toContain('Number.isInteger(localGatewayPortNumber)');
    expect(vite).toContain('localGatewayPortNumber < 1024');
    expect(vite).toContain('localGatewayPortNumber > 65535');
    expect(vite).toContain("'/short-api'");
    expect(verifier).toContain('/short-api/links');
    expect(verifier).toContain('LOCAL_SUBWEB_PORT="$local_subweb_port"');
    expect(verifier).toContain('REDIS_IMAGE SUBCONVERTER_IMAGE MYURLS_IMAGE');
    expect(verifier).toContain('--connect-timeout');
    expect(verifier).toContain('--max-time');
    for (const source of [start, dependencies]) {
      expect(source).not.toMatch(/go build|cmake|MYURLS_SOURCE_DIR|git clone/u);
    }
  });

  it('overrides parent Compose image and MyUrls network exports with local values', async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'subweb-local-env-'));
    const fixtureRoot = path.join(fixture, 'repo');
    const scriptDirectory = path.join(fixtureRoot, 'scripts', 'local');
    const binaryDirectory = path.join(fixture, 'bin');
    const commonPath = path.join(scriptDirectory, 'common.sh');
    const runnerPath = path.join(scriptDirectory, 'prepare-env.sh');
    const localEnvPath = path.join(fixtureRoot, '.runtime', 'local', 'compose.env');
    const lock = JSON.parse(await read('deploy/versions.lock.json'));

    try {
      await Promise.all([
        mkdir(scriptDirectory, { recursive: true }),
        mkdir(path.join(fixtureRoot, 'deploy'), { recursive: true }),
        mkdir(binaryDirectory, { recursive: true }),
      ]);
      await Promise.all([
        cp(new URL('../../scripts/local/common.sh', import.meta.url), commonPath),
        writeFile(
          runnerPath,
          `#!/bin/sh
. "$(dirname "$0")/common.sh"
prepare_local_environment
printf '%s\\n' \\
  "REDIS_IMAGE=$REDIS_IMAGE" \\
  "SUBCONVERTER_IMAGE=$SUBCONVERTER_IMAGE" \\
  "MYURLS_IMAGE=$MYURLS_IMAGE" \\
  "MYURLS_NETWORK_SUBNET=$MYURLS_NETWORK_SUBNET" \\
  "MYURLS_GATEWAY_IP=$MYURLS_GATEWAY_IP" \\
  "MYURLS_IP=$MYURLS_IP" \\
  "MYURLS_TRUST_PROXY_CIDR=$MYURLS_TRUST_PROXY_CIDR"
`,
        ),
        cp(new URL('../../scripts/runtime-image-contract.mjs', import.meta.url), path.join(fixtureRoot, 'scripts', 'runtime-image-contract.mjs')),
        cp(new URL('../../scripts/verify-version-locks.mjs', import.meta.url), path.join(fixtureRoot, 'scripts', 'verify-version-locks.mjs')),
        cp(new URL('../../deploy/versions.lock.json', import.meta.url), path.join(fixtureRoot, 'deploy', 'versions.lock.json')),
        writeFile(path.join(binaryDirectory, 'docker'), '#!/bin/sh\nexit 0\n'),
        writeFile(path.join(binaryDirectory, 'openssl'), '#!/bin/sh\nprintf "%064d\\n" 0\n'),
      ]);
      await Promise.all([
        chmod(path.join(binaryDirectory, 'docker'), 0o755),
        chmod(path.join(binaryDirectory, 'openssl'), 0o755),
        chmod(runnerPath, 0o755),
      ]);

      const runPreparation = (environment = {}) => spawnSync('sh', [runnerPath], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${path.dirname(process.execPath)}:${binaryDirectory}:${process.env.PATH}`,
          ...environment,
        },
      });
      const validLocalNetwork = {
        LOCAL_MYURLS_NETWORK_SUBNET: '172.30.255.0/29',
        LOCAL_MYURLS_GATEWAY_IP: '172.30.255.2',
        LOCAL_MYURLS_IP: '172.30.255.3',
        LOCAL_MYURLS_TRUST_PROXY_CIDR: '172.30.255.2/32',
      };
      const invalidLocalNetworkCases = [
        ['malformed subnet', { LOCAL_MYURLS_NETWORK_SUBNET: '172.30.255.0/33' }, 'LOCAL_MYURLS_NETWORK_SUBNET'],
        ['broad subnet', { LOCAL_MYURLS_NETWORK_SUBNET: '0.0.0.0/0' }, 'LOCAL_MYURLS_NETWORK_SUBNET'],
        ['subnet with host bits', { LOCAL_MYURLS_NETWORK_SUBNET: '172.30.255.1/29' }, 'LOCAL_MYURLS_NETWORK_SUBNET'],
        ['malformed gateway', { LOCAL_MYURLS_GATEWAY_IP: '172.30.255.999' }, 'LOCAL_MYURLS_GATEWAY_IP'],
        ['gateway outside subnet', { LOCAL_MYURLS_GATEWAY_IP: '172.30.254.2' }, 'inside LOCAL_MYURLS_NETWORK_SUBNET'],
        ['duplicate endpoints', { LOCAL_MYURLS_IP: '172.30.255.2' }, 'distinct'],
        ['broad trusted proxy', { LOCAL_MYURLS_TRUST_PROXY_CIDR: '172.30.255.0/29' }, 'LOCAL_MYURLS_TRUST_PROXY_CIDR'],
        ['unrelated trusted proxy', { LOCAL_MYURLS_TRUST_PROXY_CIDR: '192.0.2.1/32' }, 'LOCAL_MYURLS_TRUST_PROXY_CIDR'],
        ['malformed trusted proxy', { LOCAL_MYURLS_TRUST_PROXY_CIDR: '172.30.255.2/33' }, 'LOCAL_MYURLS_TRUST_PROXY_CIDR'],
      ];
      for (const [name, overrides, expectedMessage] of invalidLocalNetworkCases) {
        const result = runPreparation({ ...validLocalNetwork, ...overrides });
        expect(result.status, name).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`, name).toContain(expectedMessage);
      }
      await expect(readFile(localEnvPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

      const customNetworkRun = runPreparation({
        ...validLocalNetwork,
        LOCAL_MYURLS_NETWORK_SUBNET: '192.0.2.0/29',
        LOCAL_MYURLS_GATEWAY_IP: '192.0.2.2',
        LOCAL_MYURLS_IP: '192.0.2.3',
        LOCAL_MYURLS_TRUST_PROXY_CIDR: '192.0.2.2/32',
      });
      expect(customNetworkRun.status).toBe(0);
      expect(customNetworkRun.stdout).toContain('MYURLS_NETWORK_SUBNET=192.0.2.0/29');
      expect(customNetworkRun.stdout).toContain('MYURLS_GATEWAY_IP=192.0.2.2');
      expect(customNetworkRun.stdout).toContain('MYURLS_IP=192.0.2.3');
      expect(customNetworkRun.stdout).toContain('MYURLS_TRUST_PROXY_CIDR=192.0.2.2/32');

      const contaminatedRun = runPreparation({
        ...validLocalNetwork,
        REDIS_IMAGE: 'registry.invalid/redis:parent',
        SUBCONVERTER_IMAGE: 'registry.invalid/subconverter:parent',
        MYURLS_IMAGE: 'registry.invalid/myurls:parent',
        MYURLS_NETWORK_SUBNET: '198.51.100.0/29',
        MYURLS_GATEWAY_IP: '198.51.100.2',
        MYURLS_IP: '198.51.100.3',
        MYURLS_TRUST_PROXY_CIDR: '198.51.100.2/32',
      });
      expect(contaminatedRun.status).toBe(0);

      const composeVariables = Object.fromEntries(
        contaminatedRun.stdout
          .trim()
          .split('\n')
          .map((line) => line.split(/=(.*)/u)),
      );
      for (const [name, image] of Object.entries(resolveRuntimeImages(lock))) {
        expect(composeVariables[name]).toBe(image);
      }
      expect(composeVariables).toMatchObject({
        MYURLS_NETWORK_SUBNET: '172.30.255.0/29',
        MYURLS_GATEWAY_IP: '172.30.255.2',
        MYURLS_IP: '172.30.255.3',
        MYURLS_TRUST_PROXY_CIDR: '172.30.255.2/32',
      });

      const stale = await readFile(localEnvPath, 'utf8');
      await writeFile(localEnvPath, `${stale}REDIS_IMAGE=stale\nSUBCONVERTER_IMAGE=stale\nMYURLS_IMAGE=stale\n`);
      expect(runPreparation().status).toBe(0);

      const persistedEnvironment = await readFile(localEnvPath, 'utf8');
      for (const [name, image] of Object.entries(resolveRuntimeImages(lock))) {
        expect(persistedEnvironment.match(new RegExp(`^${name}=`, 'gmu'))).toHaveLength(1);
        expect(persistedEnvironment).toContain(`${name}=${image}`);
      }
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('stops dependencies without deleting development data volumes', async () => {
    const dependencies = await read('scripts/local/deps.sh');

    const stopBranch = dependencies.slice(dependencies.indexOf('  down)'));
    expect(stopBranch).toContain('docker compose stop gateway subconverter myurls redis');
    expect(stopBranch).not.toContain('down --volumes');
    expect(stopBranch).not.toContain('volume rm');
  });

  it('removes verifier-owned Compose resources and data volumes', async () => {
    const [dependencies, verifier] = await Promise.all([
      read('scripts/local/deps.sh'),
      read('scripts/verify-local-dev.sh'),
    ]);

    expect(verifier).toContain('"$script_directory/local/deps.sh" remove-volumes');
    expect(dependencies).toContain('remove-volumes)');
    expect(dependencies).toContain('docker compose down --remove-orphans');
    expect(dependencies).toContain('docker compose down --volumes --remove-orphans');
    expect(dependencies).toContain('remove-volumes is restricted to verifier-owned projects.');
  });
});
