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

  it('derives locked external image references when creating local Compose state', async () => {
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
        writeFile(runnerPath, '#!/bin/sh\n. "$(dirname "$0")/common.sh"\nprepare_local_environment\n'),
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

      const runPreparation = () => spawnSync('sh', [runnerPath], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${path.dirname(process.execPath)}:${binaryDirectory}:${process.env.PATH}`,
        },
      });

      expect(runPreparation().status).toBe(0);
      const stale = await readFile(localEnvPath, 'utf8');
      await writeFile(localEnvPath, `${stale}REDIS_IMAGE=stale\nSUBCONVERTER_IMAGE=stale\nMYURLS_IMAGE=stale\n`);
      expect(runPreparation().status).toBe(0);

      const environment = await readFile(localEnvPath, 'utf8');
      for (const [name, image] of Object.entries(resolveRuntimeImages(lock))) {
        expect(environment.match(new RegExp(`^${name}=`, 'gmu'))).toHaveLength(1);
        expect(environment).toContain(`${name}=${image}`);
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
