import { spawnSync } from 'node:child_process';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const temporaryDirectories = [];

const makeFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'subweb-production-command-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'scripts/lib'), { recursive: true });
  await mkdir(join(root, 'bin'), { recursive: true });
  await cp(join(repositoryRoot, 'scripts/subweb.sh'), join(root, 'scripts/subweb.sh'));
  await cp(join(repositoryRoot, 'scripts/validate-compose.sh'), join(root, 'scripts/validate-compose.sh'));
  await cp(join(repositoryRoot, 'scripts/lib/path-lock.sh'), join(root, 'scripts/lib/path-lock.sh'));
  await cp(join(repositoryRoot, 'scripts/lib/docker-environment.sh'), join(root, 'scripts/lib/docker-environment.sh'));

  const docker = join(root, 'bin/docker');
  await writeFile(docker, `#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
printf '%s\\n' "$*" >> "$root/docker.log"
if [ "$1" = compose ] && [ "$2" = version ]; then
  if [ -f "$DOCKER_CONFIG/mutate-env" ]; then
    IFS= read -r mutation_target < "$DOCKER_CONFIG/mutate-env"
    printf '%s\\n' 'SHORT_LINKS_ENABLED=true' > "$mutation_target"
  fi
  exit 0
fi
[ "$1" = compose ] || exit 64
shift
[ "$1" = --env-file ] || exit 64
environment_file=$2
shift 2
[ "$1" = -f ] || exit 64
compose_file=$2
shift 2
[ -z "\${REDIS_IMAGE-}" ] && [ -z "\${SUBCONVERTER_IMAGE-}" ] && [ -z "\${MYURLS_IMAGE-}" ] && [ -z "\${SUBWEB_IMAGE-}" ] || exit 65
if [ -f "$DOCKER_CONFIG/signal" ]; then
  printf '%s\\n' "$environment_file" > "$root/snapshot.log"
  kill -TERM "$PPID"
  exit 0
fi
  case "$compose_file:$*" in
    'compose.disabled-short-links.yaml:ps') exit 0 ;;
    'compose.yaml:ps --services --filter status=running') printf '%s\\n' redis ;;
    *) exit 64 ;;
  esac
`);
  await chmod(docker, 0o755);
  return root;
};

const run = (root, command = 'up', environment = {}, args = []) => spawnSync('sh', [join(root, 'scripts/subweb.sh'), command, ...args], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    DOCKER_CONFIG: root,
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
    expect(await readDockerLog(root)).toMatch(
      /^compose version\ncompose --env-file \S*subweb-env\.[^ ]+ -f compose\.disabled-short-links\.yaml ps\n$/u,
    );
  });

  it('uses a source-content-checked descriptor for the private environment snapshot', async () => {
    const source = await readFile(join(repositoryRoot, 'scripts/subweb.sh'), 'utf8');

    expect(source).toContain('exec 9< "$ENV_FILE"');
    expect(source).toContain('environment_file_identity /dev/fd/9');
    expect(source).toContain('cat <&9 > "$validated_env_file"');
    expect(source).toContain('cmp -s "$validated_env_file" "$ENV_FILE"');
    expect(source.indexOf('opened_env_identity=$(environment_file_identity /dev/fd/9)')).toBeLessThan(
      source.indexOf('cat <&9 > "$validated_env_file"'),
    );
    expect(source.indexOf('cat <&9 > "$validated_env_file"')).toBeLessThan(
      source.indexOf('cmp -s "$validated_env_file" "$ENV_FILE"'),
    );
  });

  it('uses the private environment snapshot after the caller file changes', async () => {
    const root = await makeFixture();
    const envFile = join(root, '.env');
    await writeFile(envFile, 'SHORT_LINKS_ENABLED=false\n', { mode: 0o600 });

    await writeFile(join(root, 'mutate-env'), `${envFile}\n`);
    const result = run(root, 'status');

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readDockerLog(root)).toMatch(/compose --env-file \S*subweb-env\.[^ ]+ -f compose\.disabled-short-links\.yaml ps/u);
  });

  it('removes the private environment snapshot before signal termination', async () => {
    const root = await makeFixture();
    const envFile = join(root, '.env');
    const snapshotLog = join(root, 'snapshot.log');
    await writeFile(envFile, 'SHORT_LINKS_ENABLED=false\n', { mode: 0o600 });
    await writeFile(join(root, 'signal'), '1\n');

    const result = run(root, 'status');

    expect(result.status).not.toBe(0);
    const snapshotPath = (await readFile(snapshotLog, 'utf8')).trim();
    await expect(readFile(snapshotPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not release a lock reacquired after signal cleanup', async () => {
    const root = await makeFixture();
    const envFile = join(root, '.env');
    const lockPath = `${envFile}.lock`;
    await writeFile(envFile, 'SHORT_LINKS_ENABLED=false\n', { mode: 0o600 });
    await writeFile(join(root, 'signal'), '1\n');
    const reacquiredCandidate = join(root, 'reacquired.lock-candidate');
    await writeFile(join(root, 'bin/rm'), `#!/bin/sh
if [ "$1" = -f ] && [ "$2" = "$RACE_LOCK" ] && [ ! -e "$RACE_OWNER" ]; then
  /bin/rm "$@"
  mkdir "$RACE_CANDIDATE"
  printf '%s|%s\\n' 1 "$RACE_CANDIDATE" > "$RACE_CANDIDATE/owner"
  ln -s "$RACE_CANDIDATE" "$RACE_LOCK"
  : > "$RACE_OWNER"
  exit 0
fi
exec /bin/rm "$@"
`);
    await chmod(join(root, 'bin/rm'), 0o755);

    const result = run(root, 'status', {
      RACE_LOCK: lockPath,
      RACE_CANDIDATE: reacquiredCandidate,
      RACE_OWNER: join(root, 'reacquired'),
    });

    expect(result.status).not.toBe(0);
    await expect(stat(join(root, 'reacquired'))).resolves.toBeDefined();
    expect((await lstat(lockPath)).isSymbolicLink()).toBe(true);
    expect((await stat(lockPath)).isDirectory()).toBe(true);
  });

  it('runs backup and restore children with only the selected Compose environment', async () => {
    const root = await makeFixture();
    const envFile = join(root, '.env');
    const operationsDirectory = join(root, 'scripts/operations');
    const operationLog = join(root, 'operations.log');
    const backup = join(root, 'verified.rdb');
    await writeFile(envFile, 'SHORT_LINKS_ENABLED=true\n', { mode: 0o600 });
    await writeFile(backup, 'verified backup');
    await mkdir(operationsDirectory, { recursive: true });
    for (const name of ['backup-redis.sh', 'restore-redis.sh']) {
      await writeFile(join(operationsDirectory, name), `#!/bin/sh
printf '%s compose=%s snapshot=%s project=%s app=%s api=%s image=%s\\n' \\
  "$(basename "$0")" "\${COMPOSE_FILE-}" "\${SUBWEB_ENV_FILE-}" \\
  "\${COMPOSE_PROJECT_NAME-}" "\${APP_DOMAIN-}" "\${API_URL-}" "\${SUBWEB_IMAGE-}" >> "${operationLog}"
`);
      await chmod(join(operationsDirectory, name), 0o755);
    }
    const hostileEnvironment = {
      COMPOSE_PROJECT_NAME: 'attacker-project',
      APP_DOMAIN: 'attacker.example',
      API_URL: 'https://attacker.example/sub',
      SUBWEB_IMAGE: 'registry.example/attacker:latest',
    };

    const backupResult = run(root, 'backup', hostileEnvironment);
    const restoreResult = run(
      root,
      'restore',
      hostileEnvironment,
      ['--backup', backup, '--confirm-stop-writes'],
    );

    expect(backupResult.status, backupResult.stderr).toBe(0);
    expect(restoreResult.status, restoreResult.stderr).toBe(0);
    const log = await readFile(operationLog, 'utf8');
    expect(log).toMatch(/backup-redis\.sh compose=compose\.yaml snapshot=\S*subweb-env\.\S+ project= app= api= image=\n/u);
    expect(log).toMatch(/restore-redis\.sh compose=compose\.yaml snapshot=\S*subweb-env\.\S+ project= app= api= image=\n/u);
  });

  it('clears inherited locked external image variables before invoking Compose', async () => {
    const root = await makeFixture();
    const envFile = join(root, '.env');
    await writeFile(envFile, 'SHORT_LINKS_ENABLED=false\n', { mode: 0o600 });

    const result = run(root, 'status', {
      REDIS_IMAGE: 'registry.example/attacker-redis:latest',
      SUBCONVERTER_IMAGE: 'registry.example/attacker-subconverter:latest',
      MYURLS_IMAGE: 'registry.example/attacker-myurls:latest',
      SUBWEB_IMAGE: 'registry.example/subweb:2.0.0',
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readDockerLog(root)).toContain('compose --env-file');
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
