import { spawnSync } from 'node:child_process';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const pathLockPath = fileURLToPath(
  new URL('../../scripts/lib/path-lock.sh', import.meta.url),
);
const temporaryDirectories = [];
const boundedRetryTimeout = 10_000;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('path lock recovery', () => {
  it('replaces a dangling published lock with a fully initialized candidate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    await symlink(`${target}.lock.candidate.missing`, `${target}.lock`);

    const result = spawnSync(
      'sh',
      [
        '-c',
        'set -eu; . "$1"; acquire_path_lock "$2"; [ -L "$PATH_LOCK_DIRECTORY" ]; [ -f "$PATH_LOCK_DIRECTORY/owner" ]; release_path_lock "$PATH_LOCK_DIRECTORY"',
        'sh',
        pathLockPath,
        target,
      ],
      { encoding: 'utf8', timeout: 3_000 },
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it('serializes replacement of a dangling published lock', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const canonicalTarget = join(await realpath(directory), 'versions.lock.json');
    const bin = join(directory, 'bin');
    const marker = join(directory, 'primary-removing');
    const secondaryStatus = join(directory, 'secondary-status');
    await mkdir(bin);
    await symlink(`${target}.lock.candidate.missing`, `${target}.lock`);
    await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n');
    await writeFile(join(bin, 'rm'), `#!/bin/sh
for argument in "$@"; do
  if [ "$LOCK_ROLE" = primary ] && [ "$argument" = "$LOCK_TARGET.lock" ] && [ ! -e "$LOCK_MARKER" ]; then
    : > "$LOCK_MARKER"
    LOCK_ROLE=secondary sh -c 'set -eu; . "$1"; if acquire_path_lock "$2"; then printf "0\\n" > "$3"; else printf "1\\n" > "$3"; fi' sh "$LOCK_SCRIPT" "$LOCK_TARGET" "$LOCK_SECONDARY_STATUS" &
    wait "$!"
  fi
done
exec /bin/rm "$@"
`);
    await Promise.all([
      chmod(join(bin, 'sleep'), 0o755),
      chmod(join(bin, 'rm'), 0o755),
    ]);

    const result = spawnSync(
      'sh',
      ['-c', 'set -eu; . "$1"; acquire_path_lock "$2"; release_path_lock "$PATH_LOCK_DIRECTORY"', 'sh', pathLockPath, target],
      {
        encoding: 'utf8',
        timeout: boundedRetryTimeout,
        env: {
          ...process.env,
          LOCK_MARKER: marker,
          LOCK_ROLE: 'primary',
          LOCK_SCRIPT: pathLockPath,
          LOCK_SECONDARY_STATUS: secondaryStatus,
          LOCK_TARGET: canonicalTarget,
          PATH: `${bin}:${process.env.PATH}`,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(secondaryStatus, 'utf8')).toBe('1\n');
  });

  it('recovers a published lock whose owner process has exited', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const canonicalTarget = join(await realpath(directory), 'versions.lock.json');
    const staleCandidate = `${canonicalTarget}.lock.candidate.stale`;
    await mkdir(staleCandidate);
    await writeFile(join(staleCandidate, 'owner'), `99999999|${staleCandidate}\n`);
    await symlink(staleCandidate, `${target}.lock`);

    const result = spawnSync(
      'sh',
      [
        '-c',
        'set -eu; . "$1"; acquire_path_lock "$2"; [ -L "$PATH_LOCK_DIRECTORY" ]; [ "$(cat "$PATH_LOCK_DIRECTORY/owner")" = "$$|$PATH_LOCK_TOKEN" ]; release_path_lock "$PATH_LOCK_DIRECTORY"',
        'sh',
        pathLockPath,
        target,
      ],
      { encoding: 'utf8', timeout: 3_000 },
    );

    expect(result.status, result.stderr).toBe(0);
    await expect(lstat(staleCandidate)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('waits for a live recovery claim before replacing a stale published lock', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const guardDirectory = `${target}.lock.guard`;
    const canonicalDirectory = await realpath(directory);
    const staleCandidate = join(canonicalDirectory, 'versions.lock.json.lock.candidate.stale');
    const recoveryCandidate = join(canonicalDirectory, 'versions.lock.json.lock.candidate.recovery');
    const staleOwner = `99999998|${staleCandidate}\n`;
    const bin = join(directory, 'bin');
    await Promise.all([mkdir(guardDirectory), mkdir(staleCandidate), mkdir(recoveryCandidate), mkdir(bin)]);
    await writeFile(join(staleCandidate, 'owner'), staleOwner);
    await writeFile(join(recoveryCandidate, 'owner'), `${process.pid}|${recoveryCandidate}\n`);
    await link(join(staleCandidate, 'owner'), join(guardDirectory, 'owner'));
    await link(join(recoveryCandidate, 'owner'), join(staleCandidate, 'recovery'));
    await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n');
    await chmod(join(bin, 'sleep'), 0o755);

    const result = spawnSync(
      'sh',
      ['-c', 'set -eu; . "$1"; acquire_path_lock "$2"', 'sh', pathLockPath, target],
      {
        encoding: 'utf8',
        timeout: boundedRetryTimeout,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      },
    );

    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(1);
    await expect(lstat(`${target}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers a stale recovery claim after its recovery process exits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const lockDirectory = `${target}.lock`;
    const guardDirectory = `${target}.lock.guard`;
    const canonicalDirectory = await realpath(directory);
    const staleCandidate = join(canonicalDirectory, 'versions.lock.json.lock.candidate.stale');
    const recoveryCandidate = join(canonicalDirectory, 'versions.lock.json.lock.candidate.recovery');
    const staleOwner = `99999998|${staleCandidate}\n`;
    const bin = join(directory, 'bin');
    await Promise.all([mkdir(guardDirectory), mkdir(staleCandidate), mkdir(recoveryCandidate), mkdir(bin)]);
    await writeFile(join(staleCandidate, 'owner'), staleOwner);
    await writeFile(join(recoveryCandidate, 'owner'), `99999999|${recoveryCandidate}\n`);
    await link(join(staleCandidate, 'owner'), join(guardDirectory, 'owner'));
    await link(join(recoveryCandidate, 'owner'), join(staleCandidate, 'recovery'));
    await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n');
    await chmod(join(bin, 'sleep'), 0o755);

    const result = spawnSync(
      'sh',
      [
        '-c',
        'set -eu; . "$1"; acquire_path_lock "$2"; release_path_lock "$PATH_LOCK_DIRECTORY"',
        'sh',
        pathLockPath,
        target,
      ],
      {
        encoding: 'utf8',
        timeout: 3_000,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    await expect(lstat(lockDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(staleCandidate)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(recoveryCandidate)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers an arbitrary-length dead successor chain', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const guardDirectory = `${target}.lock.guard`;
    const canonicalTarget = join(await realpath(directory), 'versions.lock.json');
    const candidates = Array.from(
      { length: 30 },
      (_, index) => `${canonicalTarget}.lock.candidate.dead-${index}`,
    );
    await Promise.all([mkdir(guardDirectory), ...candidates.map((candidate) => mkdir(candidate))]);
    for (const [index, candidate] of candidates.entries()) {
      await writeFile(join(candidate, 'owner'), `99999999|${candidate}\n`);
      await link(
        join(candidate, 'owner'),
        index === 0 ? join(guardDirectory, 'owner') : join(candidates[index - 1], 'recovery'),
      );
    }

    const result = spawnSync(
      'sh',
      ['-c', 'set -eu; . "$1"; acquire_path_lock "$2"; release_path_lock "$PATH_LOCK_DIRECTORY"', 'sh', pathLockPath, target],
      { encoding: 'utf8', timeout: boundedRetryTimeout },
    );

    expect(result.status, result.stderr).toBe(0);
    for (const candidate of candidates) {
      await expect(lstat(candidate)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it.each(['directory', 'dangling symlink', 'owner symlink', 'exact owner symlink'])(
    'does not bypass an unsafe preexisting guard recovery %s',
    async (kind) => {
      const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
      temporaryDirectories.push(directory);
      const target = join(directory, 'versions.lock.json');
      const canonicalTarget = join(await realpath(directory), 'versions.lock.json');
      const staleCandidate = `${canonicalTarget}.lock.candidate.stale`;
      const guardDirectory = `${target}.lock.guard`;
      const recovery = join(guardDirectory, kind === 'exact owner symlink' ? 'recovery' : 'recovery.unsafe');
      const bin = join(directory, 'bin');
      await Promise.all([mkdir(staleCandidate), mkdir(guardDirectory), mkdir(bin)]);
      await writeFile(join(staleCandidate, 'owner'), `99999998|${staleCandidate}\n`);
      await symlink(staleCandidate, `${target}.lock`);
      if (kind === 'directory') {
        await mkdir(recovery);
      } else if (kind === 'dangling symlink') {
        await symlink(join(guardDirectory, 'missing'), recovery);
      } else {
        await symlink(join(staleCandidate, 'owner'), recovery);
      }
      await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n');
      await chmod(join(bin, 'sleep'), 0o755);

      const result = spawnSync(
        'sh',
        ['-c', 'set -eu; . "$1"; acquire_path_lock "$2"', 'sh', pathLockPath, target],
        { encoding: 'utf8', timeout: 3_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
      );

      expect(result.signal, result.stderr).toBeNull();
      expect(result.status, result.stderr).toBe(1);
      expect((await lstat(`${target}.lock`)).isSymbolicLink()).toBe(true);
    },
  );

  it.each(['copied owner record', 'unrelated owner hard link'])(
    'does not follow a %s as a recovery successor',
    async (kind) => {
      const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
      temporaryDirectories.push(directory);
      const target = join(directory, 'versions.lock.json');
      const canonicalTarget = join(await realpath(directory), 'versions.lock.json');
      const staleCandidate = `${canonicalTarget}.lock.candidate.stale`;
      const successorCandidate = `${canonicalTarget}.lock.candidate.successor`;
      const guardDirectory = `${target}.lock.guard`;
      const recoveryRecord = `99999999|${successorCandidate}\n`;
      const decoy = join(directory, 'decoy-owner');
      await Promise.all([mkdir(staleCandidate), mkdir(successorCandidate), mkdir(guardDirectory)]);
      await writeFile(join(staleCandidate, 'owner'), `99999998|${staleCandidate}\n`);
      await writeFile(join(successorCandidate, 'owner'), recoveryRecord);
      if (kind === 'copied owner record') {
        await writeFile(join(staleCandidate, 'recovery'), recoveryRecord);
      } else {
        await writeFile(decoy, recoveryRecord);
        await link(decoy, join(staleCandidate, 'recovery'));
      }
      await link(join(staleCandidate, 'owner'), join(guardDirectory, 'owner'));
      await symlink(staleCandidate, `${target}.lock`);

      const result = spawnSync(
        'sh',
        ['-c', 'set -eu; . "$1"; acquire_path_lock "$2"', 'sh', pathLockPath, target],
        { encoding: 'utf8', timeout: 3_000 },
      );

      expect(result.signal, result.stderr).toBeNull();
      expect(result.status, result.stderr).toBe(1);
      expect((await lstat(`${target}.lock`)).isSymbolicLink()).toBe(true);
    },
  );

  it('does not accept a copied guard root owner record', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const canonicalTarget = join(await realpath(directory), 'versions.lock.json');
    const staleCandidate = `${canonicalTarget}.lock.candidate.stale`;
    const guardDirectory = `${target}.lock.guard`;
    const staleOwner = `99999998|${staleCandidate}\n`;
    await Promise.all([mkdir(staleCandidate), mkdir(guardDirectory)]);
    await writeFile(join(staleCandidate, 'owner'), staleOwner);
    await writeFile(join(guardDirectory, 'owner'), staleOwner);
    await symlink(staleCandidate, `${target}.lock`);

    const result = spawnSync(
      'sh',
      ['-c', 'set -eu; . "$1"; acquire_path_lock "$2"', 'sh', pathLockPath, target],
      { encoding: 'utf8', timeout: 3_000 },
    );

    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(1);
    expect((await lstat(`${target}.lock`)).isSymbolicLink()).toBe(true);
  });

  it('does not bypass a candidate-local legacy recovery marker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const canonicalTarget = join(await realpath(directory), 'versions.lock.json');
    const staleCandidate = `${canonicalTarget}.lock.candidate.stale`;
    const guardDirectory = `${target}.lock.guard`;
    await Promise.all([mkdir(staleCandidate), mkdir(guardDirectory)]);
    await writeFile(join(staleCandidate, 'owner'), `99999998|${staleCandidate}\n`);
    await writeFile(join(staleCandidate, 'recovery.legacy'), 'legacy claim\n');
    await link(join(staleCandidate, 'owner'), join(guardDirectory, 'owner'));
    await symlink(staleCandidate, `${target}.lock`);

    const result = spawnSync(
      'sh',
      ['-c', 'set -eu; . "$1"; acquire_path_lock "$2"', 'sh', pathLockPath, target],
      { encoding: 'utf8', timeout: 3_000 },
    );

    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(1);
    expect((await lstat(`${target}.lock`)).isSymbolicLink()).toBe(true);
  });

  it('does not recover a lock with a relative owner token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const relativeCandidate = 'versions.lock.json.lock.candidate.relative';
    const candidate = join(directory, relativeCandidate);
    const bin = join(directory, 'bin');
    await Promise.all([mkdir(candidate), mkdir(bin)]);
    await writeFile(join(candidate, 'owner'), `99999998|${relativeCandidate}\n`);
    await symlink(relativeCandidate, `${target}.lock`);
    await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n');
    await chmod(join(bin, 'sleep'), 0o755);

    const result = spawnSync(
      'sh',
      ['-c', 'set -eu; . "$1"; acquire_path_lock "$2"', 'sh', pathLockPath, 'versions.lock.json'],
      { cwd: directory, encoding: 'utf8', timeout: 3_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
    );

    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(1);
    expect((await lstat(`${target}.lock`)).isSymbolicLink()).toBe(true);
  });

  it('does not recover a lock whose candidate token resolves through a symlink', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const canonicalTarget = join(await realpath(directory), 'versions.lock.json');
    const candidate = `${canonicalTarget}.lock.candidate.redirect`;
    const redirectedCandidate = join(directory, 'redirected-candidate');
    const bin = join(directory, 'bin');
    await Promise.all([mkdir(redirectedCandidate), mkdir(bin)]);
    await writeFile(join(redirectedCandidate, 'owner'), `99999998|${candidate}\n`);
    await symlink(redirectedCandidate, candidate);
    await symlink(candidate, `${target}.lock`);
    await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n');
    await chmod(join(bin, 'sleep'), 0o755);

    const result = spawnSync(
      'sh',
      ['-c', 'set -eu; . "$1"; acquire_path_lock "$2"', 'sh', pathLockPath, target],
      { encoding: 'utf8', timeout: boundedRetryTimeout, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },    );

    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(1);
    expect((await lstat(`${target}.lock`)).isSymbolicLink()).toBe(true);
  });

  it('does not recover a lock whose owner record is a symlink', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const canonicalTarget = join(await realpath(directory), 'versions.lock.json');
    const candidate = `${canonicalTarget}.lock.candidate.owner-link`;
    const externalOwner = join(directory, 'external-owner');
    const bin = join(directory, 'bin');
    await Promise.all([mkdir(candidate), mkdir(bin)]);
    await writeFile(externalOwner, `99999998|${candidate}\n`);
    await symlink(externalOwner, join(candidate, 'owner'));
    await symlink(candidate, `${target}.lock`);
    await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n');
    await chmod(join(bin, 'sleep'), 0o755);

    const result = spawnSync(
      'sh',
      ['-c', 'set -eu; . "$1"; acquire_path_lock "$2"', 'sh', pathLockPath, target],
      { encoding: 'utf8', timeout: boundedRetryTimeout, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },    );

    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(1);
    expect((await lstat(`${target}.lock`)).isSymbolicLink()).toBe(true);
  });

  it('creates a private guard directory under a permissive umask', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');

    const result = spawnSync(
      'sh',
      ['-c', 'set -eu; umask 000; . "$1"; acquire_path_lock "$2"; release_path_lock "$PATH_LOCK_DIRECTORY"', 'sh', pathLockPath, target],
      { encoding: 'utf8', timeout: 3_000 },
    );

    expect(result.status, result.stderr).toBe(0);
    expect((await stat(`${target}.lock.guard`)).mode & 0o077).toBe(0);
  });

  it('does not take over a lock when process liveness is permission denied', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const canonicalTarget = join(await realpath(directory), 'versions.lock.json');
    const staleCandidate = `${canonicalTarget}.lock.candidate.other-user`;
    const bin = join(directory, 'bin');
    await Promise.all([mkdir(staleCandidate), mkdir(bin)]);
    await writeFile(join(staleCandidate, 'owner'), `99999998|${staleCandidate}\n`);
    await symlink(staleCandidate, `${target}.lock`);
    await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n');
    await chmod(join(bin, 'sleep'), 0o755);

    const result = spawnSync(
      'sh',
      [
        '-c',
        'set -eu; . "$1"; kill() { printf "kill: %s: Operation not permitted\\n" "$2" >&2; return 1; }; acquire_path_lock "$2"',
        'sh',
        pathLockPath,
        target,
      ],
      { encoding: 'utf8', timeout: 3_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
    );

    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(1);
    expect((await lstat(`${target}.lock`)).isSymbolicLink()).toBe(true);
  });

  it('does not take over a lock whose owner record cannot be read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const canonicalTarget = join(await realpath(directory), 'versions.lock.json');
    const staleCandidate = `${canonicalTarget}.lock.candidate.unreadable`;
    const bin = join(directory, 'bin');
    await Promise.all([mkdir(staleCandidate), mkdir(bin)]);
    await writeFile(join(staleCandidate, 'owner'), `99999998|${staleCandidate}\n`);
    await symlink(staleCandidate, `${target}.lock`);
    await writeFile(join(bin, 'cat'), `#!/bin/sh
if [ "$1" = "$LOCK_TARGET.lock/owner" ]; then
  exit 1
fi
exec /bin/cat "$@"
`);
    await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n');
    await Promise.all([
      chmod(join(bin, 'cat'), 0o755),
      chmod(join(bin, 'sleep'), 0o755),
    ]);

    const result = spawnSync(
      'sh',
      ['-c', 'set -eu; . "$1"; acquire_path_lock "$2"', 'sh', pathLockPath, target],
      {
        encoding: 'utf8',
        timeout: boundedRetryTimeout,
        env: { ...process.env, LOCK_TARGET: canonicalTarget, PATH: `${bin}:${process.env.PATH}` },
      },
    );

    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(1);
    expect((await lstat(`${target}.lock`)).isSymbolicLink()).toBe(true);
  });

  it('does not take over an uninitialized legacy lock directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const bin = join(directory, 'bin');
    await mkdir(`${target}.lock`);
    await mkdir(bin);
    const sleep = join(bin, 'sleep');
    await writeFile(sleep, '#!/bin/sh\nexit 0\n');
    await chmod(sleep, 0o755);

    const result = spawnSync(
      'sh',
      [
        '-c',
        'set -eu; . "$1"; acquire_path_lock "$2"',
        'sh',
        pathLockPath,
        target,
      ],
      { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
    );

    expect(result.status).not.toBe(0);
    expect(await readdir(`${target}.lock`)).toEqual([]);
  });

  it('supports a relative target with a child handoff', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, 'locks'));

    const command = `set -eu
. "$1"
acquire_path_lock "$2"
[ -L "$PATH_LOCK_DIRECTORY" ]
[ -f "$PATH_LOCK_DIRECTORY/owner" ]
cd /
sh -c 'set -eu; cd /; . "$1"; validate_path_lock_handoff "$2" "$3"' sh "$1" "$PATH_LOCK_DIRECTORY" "$PATH_LOCK_TOKEN"
release_path_lock "$PATH_LOCK_DIRECTORY"
[ ! -e "$PATH_LOCK_DIRECTORY" ] && [ ! -L "$PATH_LOCK_DIRECTORY" ]`;
    const result = spawnSync(
      'sh',
      ['-c', command, 'sh', pathLockPath, 'locks/versions.lock.json'],
      { cwd: directory, encoding: 'utf8', timeout: 3_000 },
    );

    expect(result.status, result.stderr).toBe(0);
  });
});
