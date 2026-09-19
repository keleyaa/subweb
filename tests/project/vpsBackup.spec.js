import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const backupPathScript = fileURLToPath(new URL('scripts/vps/backup-path.sh', root));
const backupScript = fileURLToPath(new URL('scripts/vps/backup.sh', root));
const verifyBackupScript = fileURLToPath(new URL('scripts/vps/verify-backup.sh', root));
const temporaryDirectories = [];

const writeExecutable = async (path, source) => {
  await writeFile(path, source, { mode: 0o755 });
  await chmod(path, 0o755);
};

const runShell = (script, args, environment = {}) => spawnSync('sh', [
  '-c', script,
  'sh',
  ...args,
], {
  encoding: 'utf8',
  env: { ...process.env, ...environment },
});

const makeFindmntFixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-vps-backup-'));
  temporaryDirectories.push(directory);
  const findmnt = join(directory, 'findmnt');

  await writeExecutable(findmnt, `#!/bin/sh
case "$*" in
  *' -o TARGET') printf '%s\\n' "${'${BACKUP_MOUNT_TARGET:-/}'}" ;;
  *' -o SOURCE') printf '%s\\n' "${'${BACKUP_MOUNT_SOURCE:-}'}" ;;
  *' -o FSTYPE') printf '%s\\n' "${'${BACKUP_MOUNT_FSTYPE:-}'}" ;;
  *' -o MAJ:MIN') printf '%s\\n' "${'${BACKUP_MOUNT_DEVICE:-}'}" ;;
esac
`);

  return directory;
};

const makeBackupRetentionFixture = async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'subweb-vps-retention-'));
  const backupDirectory = join(fixture, 'backups');
  const scriptsDirectory = join(fixture, 'scripts', 'vps');
  const projectRoot = join(fixture, 'project');
  const backupPathSource = await readFile(backupPathScript, 'utf8');
  const backupSource = await readFile(backupScript, 'utf8');

  temporaryDirectories.push(fixture);
  await mkdir(backupDirectory, { recursive: true });
  await mkdir(scriptsDirectory, { recursive: true });
  await mkdir(join(projectRoot, 'scripts'), { recursive: true });
  await writeExecutable(join(scriptsDirectory, 'backup-path.sh'), backupPathSource
    .replaceAll('/var/lib/subweb-backups', backupDirectory)
    .replaceAll('/mnt/subweb-backups', join(fixture, 'other-managed-root')));
  await writeExecutable(join(scriptsDirectory, 'backup.sh'), backupSource);
  await writeExecutable(join(projectRoot, 'scripts', 'subweb.sh'), `#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) printf 'backup' >"$2"; exit 0 ;;
  esac
  shift
done
exit 1
`);
  await writeExecutable(join(fixture, 'age'), `#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    -r) shift 2 ;;
    -o) output=$2; shift 2 ;;
    *) input=$1; shift ;;
  esac
done
cp "$input" "$output"
`);
  await writeExecutable(join(fixture, 'df'), `#!/bin/sh
printf '%s\\n' 'Filesystem 1024-blocks Used Available Capacity Mounted on'
printf '%s\\n' '/dev/test 100000 1 99999999 1% /'
`);
  await writeExecutable(join(fixture, 'find'), `#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';

const directory = process.argv[2];
const format = process.argv.at(-1);
const separator = format.endsWith('\\\\0') ? String.fromCharCode(0) : String.fromCharCode(10);
for (const name of readdirSync(directory)) {
  if (!/^subweb-redis-.*\\.rdb(?:\\.age)?$/s.test(name)) continue;
  const path = directory + '/' + name;
  process.stdout.write(String(statSync(path).mtimeMs) + ' ' + path + separator);
}
`);
  await writeExecutable(join(fixture, 'flock'), '#!/bin/sh\nexit 0\n');
  await writeExecutable(join(fixture, 'sha256sum'), `#!/bin/sh
printf 'digest  %s\\n' "$1"
`);
  await writeExecutable(join(fixture, 'sort'), `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const arguments_ = process.argv.slice(2);
const input = readFileSync(0);
if (!arguments_.some((argument) => argument.includes('z'))) {
  const result = spawnSync('/usr/bin/sort', arguments_, { input });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const separator = String.fromCharCode(0);
const records = input.toString('utf8').split(separator).filter(Boolean);
records.sort((left, right) => Number(right.split(' ', 1)[0]) - Number(left.split(' ', 1)[0]));
process.stdout.write(Buffer.from(records.join(separator) + (records.length ? separator : ''), 'utf8'));
`);
  await writeExecutable(join(fixture, 'tail'), `#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const separator = String.fromCharCode(0);
const arguments_ = process.argv.slice(2);
const start = Number(arguments_[arguments_.indexOf('-n') + 1].slice(1)) - 1;
const records = readFileSync(0).toString('utf8').split(separator).filter(Boolean).slice(start);
process.stdout.write(Buffer.from(records.join(separator) + (records.length ? separator : ''), 'utf8'));
`);
  await writeExecutable(join(fixture, 'cut'), `#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const separator = String.fromCharCode(0);
const records = readFileSync(0).toString('utf8').split(separator).filter(Boolean)
  .map((record) => record.slice(record.indexOf(' ') + 1));
process.stdout.write(Buffer.from(records.join(separator) + (records.length ? separator : ''), 'utf8'));
`);
  await writeExecutable(join(fixture, 'xargs'), `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const separator = String.fromCharCode(0);
const paths = readFileSync(0).toString('utf8').split(separator).filter(Boolean);
for (const path of paths) {
  const result = spawnSync('/bin/rm', ['-f', '--', path, path + '.sha256']);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
`);

  return { backupDirectory, fixture, projectRoot, script: join(scriptsDirectory, 'backup.sh') };
};

const makeBackupVerificationFixture = async (sidecarContents) => {
  let fixture = await mkdtemp(join(tmpdir(), 'subweb-vps-verify-'));
  fixture = await realpath(fixture);
  const backupDirectory = join(fixture, 'backups');
  const scriptsDirectory = join(fixture, 'scripts', 'vps');
  const projectRoot = join(fixture, 'project');
  const backupFile = join(backupDirectory, 'subweb-redis.rdb');
  const verifiedMarker = join(fixture, 'verified');
  const backupPathSource = await readFile(backupPathScript, 'utf8');
  const verifyBackupSource = await readFile(verifyBackupScript, 'utf8');

  temporaryDirectories.push(fixture);
  await mkdir(scriptsDirectory, { recursive: true });
  await mkdir(join(projectRoot, 'scripts', 'operations'), { recursive: true });
  await mkdir(backupDirectory, { recursive: true });
  await writeFile(backupFile, 'backup');
  await writeFile(`${backupFile}.sha256`, sidecarContents(backupFile));
  await writeExecutable(join(scriptsDirectory, 'backup-path.sh'), backupPathSource
    .replaceAll('/var/lib/subweb-backups', backupDirectory)
    .replaceAll('/mnt/subweb-backups', join(fixture, 'other-managed-root')));
  await writeExecutable(join(scriptsDirectory, 'verify-backup.sh'), verifyBackupSource);
  await writeExecutable(join(projectRoot, 'scripts', 'operations', 'verify-redis-backup.sh'),
    `#!/bin/sh\ntouch '${verifiedMarker}'\n`);
  await writeExecutable(join(fixture, 'sha256sum'), `#!/bin/sh
printf '%064d  %s\\n' 0 "$1"
`);

  return { backupDirectory, backupFile, fixture, projectRoot, script: join(scriptsDirectory, 'verify-backup.sh'), verifiedMarker };
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('VPS backup mount safety', () => {
  it('captures a stable identity only for a distinct configured remote mount', async () => {
    const fixture = await makeFindmntFixture();
    const mountPath = join(fixture, 'remote');
    await mkdir(mountPath);
    const environment = {
      PATH: `${fixture}:${process.env.PATH}`,
      BACKUP_MOUNT_TARGET: mountPath,
      BACKUP_MOUNT_SOURCE: 'backup.example:/subweb',
      BACKUP_MOUNT_FSTYPE: 'nfs4',
      BACKUP_MOUNT_DEVICE: '0:42',
    };

    const result = runShell(
      'set -eu; . "$1"; backup_mount_is_distinct "$2"; backup_mount_identity "$2"',
      [backupPathScript, mountPath],
      environment,
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toBe('backup.example:/subweb|nfs4|0:42\n');
  });

  it('rejects a path whose mountpoint resolves to the local root filesystem', async () => {
    const fixture = await makeFindmntFixture();
    const mountPath = join(fixture, 'remote');
    await mkdir(mountPath);

    const result = runShell(
      'set -eu; . "$1"; backup_mount_is_distinct "$2"',
      [backupPathScript, mountPath],
      { PATH: `${fixture}:${process.env.PATH}`, BACKUP_MOUNT_TARGET: '/' },
    );

    expect(result.status).not.toBe(0);
  });

  it('revalidates the destination identity after mkdir before lock, workspace, and output operations', async () => {
    const backup = await readFile(backupScript, 'utf8');
    const revalidate = 'validate_backup_destination';
    const mkdir = backup.indexOf('mkdir -p "$BACKUP_DIRECTORY"');
    const firstRevalidation = backup.indexOf(revalidate, mkdir);
    const lock = backup.indexOf('exec 9>"$BACKUP_DIRECTORY/.backup.lock"');
    const workspace = backup.indexOf('mktemp -d "$BACKUP_DIRECTORY/.subweb-backup.XXXXXX"');
    const finalOutput = backup.indexOf('mv "$final_temporary" "$final_file"');
    const checksumOutput = backup.indexOf('mv "$checksum_temporary" "$checksum_file"');

    expect(mkdir).toBeGreaterThanOrEqual(0);
    expect(firstRevalidation).toBeGreaterThan(mkdir);
    expect(firstRevalidation).toBeLessThan(lock);
    expect(backup.lastIndexOf(revalidate, workspace)).toBeGreaterThan(lock);
    expect(backup.lastIndexOf(revalidate, finalOutput)).toBeGreaterThan(workspace);
    expect(backup.lastIndexOf(revalidate, checksumOutput)).toBeGreaterThan(finalOutput);
    expect(backup).toContain('backup_expected_mount_identity');
  });

  it.each([
    {
      name: 'the configured remote mount is missing',
      backupDirectory: 'remote/backups',
      remoteMount: 'remote',
      mountTarget: '/',
      expectedError: 'BACKUP_REMOTE_MOUNT must be a distinct mounted filesystem',
    },
    {
      name: 'the backup directory is outside the configured remote mount',
      backupDirectory: 'local-backups',
      remoteMount: 'remote',
      mountTarget: 'remote',
      expectedError: 'BACKUP_DIRECTORY must be under BACKUP_REMOTE_MOUNT',
    },
  ])('refuses verification when $name', async ({ backupDirectory, remoteMount, mountTarget, expectedError }) => {
    const fixture = await makeFindmntFixture();
    const scriptsDirectory = join(fixture, 'scripts', 'vps');
    const projectRoot = join(fixture, 'project');
    const backupDirectoryPath = join(fixture, backupDirectory);
    const remoteMountPath = join(fixture, remoteMount);
    const otherManagedRoot = remoteMountPath;
    const backupFile = join(backupDirectoryPath, 'subweb-redis.rdb');
    const backupPathSource = await readFile(backupPathScript, 'utf8');
    const verifyBackupSource = await readFile(verifyBackupScript, 'utf8');

    await mkdir(scriptsDirectory, { recursive: true });
    await mkdir(join(projectRoot, 'scripts', 'operations'), { recursive: true });
    await mkdir(backupDirectoryPath, { recursive: true });
    await mkdir(remoteMountPath, { recursive: true });
    await writeFile(backupFile, 'backup');
    await writeFile(`${backupFile}.sha256`, 'checksum');
    await writeExecutable(join(scriptsDirectory, 'backup-path.sh'), backupPathSource
      .replaceAll('/var/lib/subweb-backups', backupDirectoryPath)
      .replaceAll('/mnt/subweb-backups', otherManagedRoot));
    await writeExecutable(join(scriptsDirectory, 'verify-backup.sh'), verifyBackupSource);
    await writeExecutable(join(projectRoot, 'scripts', 'operations', 'verify-redis-backup.sh'), '#!/bin/sh\nexit 0\n');
    await writeExecutable(join(fixture, 'sha256sum'), '#!/bin/sh\nexit 0\n');

    const result = spawnSync('sh', [join(scriptsDirectory, 'verify-backup.sh'), backupFile], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixture}:${process.env.PATH}`,
        PROJECT_ROOT: projectRoot,
        BACKUP_DIRECTORY: backupDirectoryPath,
        BACKUP_REMOTE_MOUNT: remoteMountPath,
        BACKUP_MOUNT_TARGET: mountTarget === '/' ? '/' : remoteMountPath,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(expectedError);
  });

  it.each([
    {
      name: 'lexical traversal outside BACKUP_DIRECTORY',
      backupPath: (backupDirectory) => `${backupDirectory}/../outside/subweb-redis.rdb`,
      prepare: async (_backupDirectory, outside) => {
        await mkdir(outside, { recursive: true });
      },
    },
    {
      name: 'a symlinked directory component',
      backupPath: (backupDirectory) => join(backupDirectory, 'linked', 'subweb-redis.rdb'),
      prepare: async (backupDirectory, outside) => {
        await mkdir(outside, { recursive: true });
        await symlink(outside, join(backupDirectory, 'linked'));
      },
    },
    {
      name: 'a symlinked final backup file',
      backupPath: (backupDirectory) => join(backupDirectory, 'linked.rdb'),
      prepare: async (backupDirectory, outside) => {
        await mkdir(outside, { recursive: true });
        await symlink(join(outside, 'subweb-redis.rdb'), join(backupDirectory, 'linked.rdb'));
      },
    },
  ])('rejects $name before binding the backup into Docker', async ({ backupPath, prepare }) => {
    const fixture = await mkdtemp(join(tmpdir(), 'subweb-vps-path-'));
    temporaryDirectories.push(fixture);
    const scriptsDirectory = join(fixture, 'scripts', 'vps');
    const projectRoot = join(fixture, 'project');
    const backupDirectory = join(fixture, 'approved-backups');
    const outside = join(fixture, 'outside');
    const marker = join(fixture, 'docker-bind-attempted');
    const actualBackupPath = backupPath(backupDirectory, outside);
    const backupPathSource = await readFile(backupPathScript, 'utf8');
    const verifyBackupSource = await readFile(verifyBackupScript, 'utf8');

    await mkdir(scriptsDirectory, { recursive: true });
    await mkdir(join(projectRoot, 'scripts', 'operations'), { recursive: true });
    await mkdir(backupDirectory, { recursive: true });
    await prepare(backupDirectory, outside);
    await writeFile(actualBackupPath, 'backup');
    await writeFile(`${actualBackupPath}.sha256`, 'checksum');
    await writeExecutable(join(scriptsDirectory, 'backup-path.sh'), backupPathSource
      .replaceAll('/var/lib/subweb-backups', backupDirectory)
      .replaceAll('/mnt/subweb-backups', join(fixture, 'other-managed-root')));
    await writeExecutable(join(scriptsDirectory, 'verify-backup.sh'), verifyBackupSource);
    await writeExecutable(join(projectRoot, 'scripts', 'operations', 'verify-redis-backup.sh'),
      `#!/bin/sh\nprintf '%s' "$2" > '${marker}'\nexit 0\n`);
    await writeExecutable(join(fixture, 'sha256sum'), '#!/bin/sh\nexit 0\n');

    const result = spawnSync('sh', [join(scriptsDirectory, 'verify-backup.sh'), actualBackupPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixture}:${process.env.PATH}`,
        SUBWEB_ROOT: projectRoot,
        BACKUP_DIRECTORY: backupDirectory,
        BACKUP_REMOTE_MOUNT: '',
        AGE_IDENTITY_FILE: '',
        AGE_RECIPIENT: '',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('backup must resolve inside BACKUP_DIRECTORY');
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});


describe('VPS backup retention', () => {
  it('fails closed when the sort stage fails', async () => {
    const { backupDirectory, fixture, projectRoot, script } = await makeBackupRetentionFixture();
    await writeFile(join(backupDirectory, 'subweb-redis-20250101T000000Z-ABC123.rdb'), 'retain');
    await writeFile(join(fixture, 'production.env'), '');
    await writeExecutable(join(fixture, 'sort'), '#!/bin/sh\nexit 1\n');

    const result = spawnSync('sh', [script], {
      cwd: fixture,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixture}:${process.env.PATH}`,
        AGE_RECIPIENT: 'age1testrecipient',
        BACKUP_DIRECTORY: backupDirectory,
        BACKUP_REMOTE_MOUNT: '',
        SUBWEB_ENV_FILE: join(fixture, 'production.env'),
        SUBWEB_ROOT: projectRoot,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unable to sort retained backups');
  });

  it('does not delete a forged path outside the backup directory from a newline-bearing matching filename', async () => {
    const { backupDirectory, fixture, projectRoot, script } = await makeBackupRetentionFixture();
    const retainedBackup = join(backupDirectory, 'subweb-redis-20250101T000000Z-ABC123.rdb');
    const staleBackup = join(backupDirectory, 'subweb-redis-20240101T000000Z-DEF456.rdb');
    const forgedTarget = join(fixture, 'forged-target.rdb');
    const malformedBackup = join(backupDirectory, 'subweb-redis-20230101T000000Z-GHI789\nforged-target.rdb');

    await writeFile(retainedBackup, 'retain');
    await writeFile(staleBackup, 'prune');
    await writeFile(`${staleBackup}.sha256`, 'stale checksum');
    await writeFile(malformedBackup, 'malformed');
    await writeFile(forgedTarget, 'must remain');
    await writeFile(join(fixture, 'production.env'), '');
    await utimes(retainedBackup, new Date('2025-01-01T00:00:00Z'), new Date('2025-01-01T00:00:00Z'));
    await utimes(staleBackup, new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T00:00:00Z'));
    await utimes(malformedBackup, new Date('2023-01-01T00:00:00Z'), new Date('2023-01-01T00:00:00Z'));

    const result = spawnSync('sh', [script], {
      cwd: fixture,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixture}:${process.env.PATH}`,
        AGE_RECIPIENT: 'age1testrecipient',
        BACKUP_DIRECTORY: backupDirectory,
        BACKUP_REMOTE_MOUNT: '',
        BACKUP_RETENTION: '2',
        SUBWEB_ENV_FILE: join(fixture, 'production.env'),
        SUBWEB_ROOT: projectRoot,
      },
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    await expect(readFile(forgedTarget, 'utf8')).resolves.toBe('must remain');
    await expect(readFile(retainedBackup, 'utf8')).resolves.toBe('retain');
    await expect(readFile(staleBackup, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(`${staleBackup}.sha256`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 15_000);
});


describe('VPS backup checksum verification', () => {
  const zeroDigest = '0'.repeat(64);

  it('rejects a symlink checksum sidecar before binding the backup', async () => {
    const fixture = await makeBackupVerificationFixture((backup) => `${zeroDigest}  ${backup}\n`);
    const outsideSidecar = join(fixture.fixture, 'outside.sha256');
    await writeFile(outsideSidecar, `${zeroDigest}  ${fixture.backupFile}\n`);
    await rm(`${fixture.backupFile}.sha256`);
    await symlink(outsideSidecar, `${fixture.backupFile}.sha256`);

    const result = spawnSync('sh', [fixture.script, fixture.backupFile], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fixture.fixture}:${process.env.PATH}`, SUBWEB_ROOT: fixture.projectRoot, BACKUP_DIRECTORY: fixture.backupDirectory }
    });

    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr, result.stderr).toContain('backup checksum sidecar must be a regular, non-symlink file');
    await expect(readFile(fixture.verifiedMarker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a sidecar that verifies a different file', async () => {
    const fixture = await makeBackupVerificationFixture(() => `${zeroDigest}  /etc/passwd\n`);

    const result = spawnSync('sh', [fixture.script, fixture.backupFile], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fixture.fixture}:${process.env.PATH}`, SUBWEB_ROOT: fixture.projectRoot, BACKUP_DIRECTORY: fixture.backupDirectory }
    });

    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr, result.stderr).toContain('exactly one record for the selected backup');
    await expect(readFile(fixture.verifiedMarker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts the sole matching sidecar record', async () => {
    const fixture = await makeBackupVerificationFixture((backup) => `${zeroDigest}  ${backup}\n`);

    const result = spawnSync('sh', [fixture.script, fixture.backupFile], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fixture.fixture}:${process.env.PATH}`, SUBWEB_ROOT: fixture.projectRoot, BACKUP_DIRECTORY: fixture.backupDirectory }
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    await expect(readFile(fixture.verifiedMarker, 'utf8')).resolves.toBe('');
  });
});
