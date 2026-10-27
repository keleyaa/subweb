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
    expect(common).toContain('export LOCAL_SUBWEB_PORT="$local_subweb_port"');
    expect(common).toContain('export LOCAL_VITE_PORT="$local_vite_port"');
    expect(common).toContain('temporary_env=$local_env_file.tmp.$$');
    expect(common).toContain('API_URL=http://127.0.0.1:$local_subweb_port');
    expect(dependencies).toMatch(
      /docker compose --env-file "\$local_env_file" up -d --build --remove-orphans --wait gateway subconverter/u,
    );
    expect(override).toContain('TURNSTILE_ENABLED: "false"');
    expect(dependencies).toContain('Local dependencies are ready.');
    expect(vite).toContain('Number.isInteger(localGatewayPortNumber)');
    expect(vite).toContain('localGatewayPortNumber < 1024');
    expect(vite).toContain('localGatewayPortNumber > 65535');
    expect(vite).toContain("'/short-api'");
    expect(verifier).toContain('/short-api/links');
    expect(verifier).toContain('LOCAL_SUBWEB_PORT="$local_subweb_port"');
    expect(verifier).toContain('--header \'Host: short.local.test\'');
    expect(verifier).toContain('--connect-timeout');
    expect(verifier).toContain('--max-time');
    for (const source of [start, dependencies, common, override, verifier]) {
      expect(source).not.toMatch(/go build|cmake|MYURLS_SOURCE_DIR|git clone|LOCAL_MYURLS_PORT/u);
    }
  });

  it('isolates generated local Compose values from contaminated parent exports', async () => {
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
  "SUBCONVERTER_IMAGE=$SUBCONVERTER_IMAGE" \\
  "LOCAL_SUBWEB_PORT=$LOCAL_SUBWEB_PORT" \\
  "LOCAL_VITE_PORT=$LOCAL_VITE_PORT"
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

      const contaminatedRun = runPreparation({
        REDIS_IMAGE: 'registry.invalid/redis:parent',
        SUBCONVERTER_IMAGE: 'registry.invalid/subconverter:parent',
        MYURLS_IMAGE: 'registry.invalid/myurls:parent',
      });
      expect(contaminatedRun.status, contaminatedRun.stderr).toBe(0);

      const composeVariables = Object.fromEntries(
        contaminatedRun.stdout
          .trim()
          .split('\n')
          .map((line) => line.split(/=(.*)/u)),
      );
      const images = resolveRuntimeImages(lock);
      expect(composeVariables.SUBCONVERTER_IMAGE).toBe(images.SUBCONVERTER_IMAGE);
      expect(composeVariables.LOCAL_SUBWEB_PORT).toBe('18081');
      expect(composeVariables.LOCAL_VITE_PORT).toBe('5173');

      const stale = await readFile(localEnvPath, 'utf8');
      await writeFile(localEnvPath, `${stale}REDIS_IMAGE=stale\nSUBCONVERTER_IMAGE=stale\nMYURLS_IMAGE=stale\n`);
      expect(runPreparation().status).toBe(0);

      const persistedEnvironment = await readFile(localEnvPath, 'utf8');
      expect(persistedEnvironment).not.toContain('REDIS_IMAGE=');
      expect(persistedEnvironment).not.toContain('MYURLS_IMAGE=');
      expect(persistedEnvironment.match(/^SUBCONVERTER_IMAGE=/gmu)).toHaveLength(1);
      expect(persistedEnvironment).toContain(`SUBCONVERTER_IMAGE=${images.SUBCONVERTER_IMAGE}`);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('stops dependencies without deleting development data volumes', async () => {
    const dependencies = await read('scripts/local/deps.sh');

    const stopBranch = dependencies.slice(dependencies.indexOf('  down)'));
    expect(stopBranch).toContain('docker compose --env-file "$local_env_file" stop gateway subconverter');
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
    expect(dependencies).toContain('docker compose --env-file "$local_env_file" down --remove-orphans');
    expect(dependencies).toContain('docker compose --env-file "$local_env_file" down --volumes --remove-orphans');
    expect(dependencies).toContain('remove-volumes is restricted to verifier-owned projects.');
  });
});
