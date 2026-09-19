import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const temporaryDirectories = [];

const makeFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'subweb-production-command-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(root, 'bin'), { recursive: true });
  await cp(join(repositoryRoot, 'scripts/subweb.sh'), join(root, 'scripts/subweb.sh'));
  await cp(join(repositoryRoot, 'scripts/validate-compose.sh'), join(root, 'scripts/validate-compose.sh'));

  const docker = join(root, 'bin/docker');
  await writeFile(docker, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$DOCKER_LOG"
if [ "$1" = compose ] && [ "$2" = version ]; then exit 0; fi
[ "$1" = compose ] || exit 64
shift
[ "$1" = --env-file ] || exit 64
shift 2
[ "$1" = -f ] || exit 64
compose_file=$2
shift 2
case "$compose_file:$*" in
  'compose.disabled-short-links.yaml:ps') exit 0 ;;
  *) exit 64 ;;
esac
`);
  await chmod(docker, 0o755);
  return root;
};

const run = (root, command = 'up', environment = {}) => spawnSync('sh', [join(root, 'scripts/subweb.sh'), command], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    DOCKER_LOG: join(root, 'docker.log'),
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    ...environment,
  },
});

const readDockerLog = async (root) => {
  try {
    return await readFile(join(root, 'docker.log'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('production command configuration contract', () => {
  it('rejects up when the production environment file is missing', async () => {
    const root = await makeFixture();

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('production .env is required');
    expect(await readDockerLog(root)).toBe('');
  });

  it('rejects up when the production environment file is not private', async () => {
    const root = await makeFixture();
    const envFile = join(root, '.env');
    await writeFile(envFile, 'SHORT_LINKS_ENABLED=false\n', { mode: 0o644 });

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('.env must be mode 0600');
    expect(await readDockerLog(root)).toBe('');
  });

  it('resolves a relative private environment path before changing directories', async () => {
    const root = await makeFixture();
    const envFile = join(root, 'private.env');
    await writeFile(envFile, 'SHORT_LINKS_ENABLED=false\n', { mode: 0o600 });

    const result = run(root, 'status', { SUBWEB_ENV_FILE: 'private.env' });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readDockerLog(root)).toBe([
      'compose version',
      `compose --env-file ${await realpath(envFile)} -f compose.disabled-short-links.yaml ps`,
      '',
    ].join('\n'));
  });

  it('keeps install before the production environment preflight', async () => {
    const source = await readFile(join(repositoryRoot, 'scripts/subweb.sh'), 'utf8');

    expect(source.indexOf('exec "$SCRIPT_DIRECTORY/docker-deploy.sh"')).toBeLessThan(
      source.indexOf('require_production_env'),
    );
  });

  it('rejects a symlink as the production environment file', async () => {
    const root = await makeFixture();
    await writeFile(join(root, 'source.env'), 'SHORT_LINKS_ENABLED=false\n', { mode: 0o600 });
    await symlink('source.env', join(root, '.env'));

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('regular, non-symlink file');
    expect(await readDockerLog(root)).toBe('');
  });

  it('stops the stack without deleting named volumes', async () => {
    const source = await readFile(join(repositoryRoot, 'scripts/subweb.sh'), 'utf8');

    expect(source).toContain('compose down');
    expect(source).not.toContain('compose down --volumes');
  });
});
