import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const pathLockPath = fileURLToPath(
  new URL('../../scripts/lib/path-lock.sh', import.meta.url),
);
const temporaryDirectories = [];

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

  it('recovers a published lock whose owner process has exited', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subweb-path-lock-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'versions.lock.json');
    const staleCandidate = `${target}.lock.candidate.stale`;
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
sh -c 'set -eu; . "$1"; validate_path_lock_handoff "$2" "$3"' sh "$1" "$PATH_LOCK_DIRECTORY" "$PATH_LOCK_TOKEN"
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
