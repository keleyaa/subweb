import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const repositoryRoot = fileURLToPath(root);
const checkHostPath = fileURLToPath(new URL('scripts/vps/check-host.sh', root));
const installPath = fileURLToPath(new URL('scripts/vps/install.sh', root));
const backupPathScript = fileURLToPath(new URL('scripts/vps/backup-path.sh', root));
const reconcileReleaseScript = fileURLToPath(new URL('scripts/vps/reconcile-release.sh', root));
const temporaryDirectories = [];
const read = (path) => readFile(new URL(path, root), 'utf8');

const writeExecutable = async (path, source) => {
  await writeFile(path, source, { mode: 0o755 });
  await chmod(path, 0o755);
};

const makeShellFixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-vps-runtime-'));
  temporaryDirectories.push(directory);
  const bin = join(directory, 'bin');
  await mkdir(bin);

  await writeExecutable(join(bin, 'id'), `#!/bin/sh
[ "\${1-}" = '-u' ] && { printf '0\\n'; exit 0; }
exit 1
`);
  await writeExecutable(join(bin, 'docker'), `#!/bin/sh
[ "$*" = 'compose version' ]
`);
  await writeExecutable(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n');
  await writeExecutable(join(bin, 'df'), `#!/bin/sh
printf '%s\\n' 'Filesystem 1024-blocks Used Available Capacity Mounted on' '/dev/test 100000 1 90000 1% /'
`);
  await writeExecutable(join(bin, 'getent'), '#!/bin/sh\nexit 1\n');
  for (const command of ['groupadd', 'useradd', 'usermod']) {
    await writeExecutable(join(bin, command), `#!/bin/sh
printf '%s\\n' '${command}' >> "$CALL_LOG"
`);
  }

  return directory;
};

const runCheckHost = (directory, environment = {}) => spawnSync('sh', [checkHostPath], {
  encoding: 'utf8',
  env: {
    ...process.env,
    PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
    SUBWEB_ROOT: join(directory, 'installation'),
    ...environment,
  },
});

const runInstaller = (directory, source, environment = {}) => spawnSync('sh', [installPath], {
  cwd: repositoryRoot,
  encoding: 'utf8',
  env: {
    ...process.env,
    CALL_LOG: join(directory, 'calls.log'),
    PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
    SUBWEB_ROOT: join(directory, 'installation'),
    SUBWEB_SOURCE: source,
    ...environment,
  },
});

const readCalls = async (directory) => {
  try {
    return await readFile(join(directory, 'calls.log'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
};

const runShell = (script, args, environment = {}) => spawnSync('sh', [
  '-c', script,
  'sh',
  ...args,
], {
  encoding: 'utf8',
  env: { ...process.env, ...environment },
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('VPS runtime contract', () => {
  it('rejects release staging when the selected source tree changes during acquisition', async () => {
    const reconcile = await read('scripts/vps/reconcile-release.sh');

    expect(reconcile).toContain('reconcile_release_tree_fingerprint');
    const copyInvocation = 'reconcile_copy_selected_release "$reconcile_source" "$RECONCILE_RELEASE_STAGE"';
    expect(reconcile.indexOf('reconcile_source_fingerprint=$(reconcile_release_tree_fingerprint')).toBeLessThan(
      reconcile.indexOf(copyInvocation),
    );
    expect(reconcile.lastIndexOf('reconcile_release_tree_fingerprint')).toBeGreaterThan(
      reconcile.indexOf(copyInvocation),
    );
  });

  it('defines a hardened systemd application unit owned by the repository entrypoint', async () => {
    const unit = await read('deploy/systemd/subweb.service');

    expect(unit).toContain('ExecStart=/opt/subweb/scripts/subweb.sh up');
    expect(unit).toContain('ExecStop=/opt/subweb/scripts/subweb.sh down');
    expect(unit).toContain('User=root');
    expect(unit).not.toContain('User=subweb');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('StartLimitBurst=3');
    expect(unit).toContain('NoNewPrivileges=true');
    expect(unit).toContain('ProtectSystem=strict');
    expect(unit).not.toContain('compose down --volumes');
  });

  it('defines a bounded backup timer and a host backup policy', async () => {
    const service = await read('deploy/systemd/subweb-backup.service');
    const timer = await read('deploy/systemd/subweb-backup.timer');
    const verifyService = await read('deploy/systemd/subweb-backup-verify.service');
    const verifyTimer = await read('deploy/systemd/subweb-backup-verify.timer');
    const backup = await read('scripts/vps/backup.sh');
    const verifyBackup = await read('scripts/vps/verify-backup.sh');
    const backupPath = await read('scripts/vps/backup-path.sh');
    const subweb = await read('scripts/subweb.sh');

    expect(service).toContain('ExecStart=/opt/subweb/scripts/vps/backup.sh');
    expect(service).toContain('User=root');
    expect(verifyService).toContain('User=root');
    expect(timer).toContain('OnCalendar=*-*-* 03:15:00');
    expect(timer).toContain('Persistent=true');
    expect(backup).toContain('AGE_RECIPIENT');
    expect(backup).toContain('BACKUP_REMOTE_MOUNT');
    expect(backup).toContain('retention is refused');
    expect(backup).toContain('sha256');
    expect(verifyService).toContain('ExecStart=/bin/sh -eu -c');
    expect(verifyTimer).toContain('OnCalendar=Sun *-*-01..07 04:15:00');
    expect(verifyBackup).toContain('verify-redis-backup.sh');
    expect(backup).toContain('flock -n 9');
    expect(backup).toContain('mktemp -d "$BACKUP_DIRECTORY/.subweb-backup.XXXXXX"');
    expect(backup.indexOf('mkdir -p "$BACKUP_DIRECTORY"')).toBeLessThan(backup.indexOf('df -Pk "$BACKUP_DIRECTORY"'));
    expect(backup).toContain("''|*[!0-9]*) fail 'MIN_FREE_KIB must be a non-negative decimal integer.'");
    expect(subweb).toContain('DEFAULT_ENV_FILE=$PROJECT_DIRECTORY/.env');
    expect(subweb).toContain('ENV_FILE=${SUBWEB_ENV_FILE:-$DEFAULT_ENV_FILE}');
    expect(subweb).toContain('docker compose --env-file "$ENV_FILE"');
    expect(backupPath).toContain('$path_label must be under a systemd ReadWritePaths entry.');
    expect(backup).toContain('require_supported_backup_path BACKUP_DIRECTORY');
    expect(verifyBackup).toContain('require_supported_backup_path BACKUP_DIRECTORY');
     expect(service).toContain('ReadWritePaths=/opt/subweb/.runtime /var/lib/subweb-backups /mnt/subweb-backups');
     expect(verifyService).toContain('ReadWritePaths=/opt/subweb/.runtime /var/lib/subweb-backups /mnt/subweb-backups');
     for (const unit of [service, verifyService]) {
       expect(unit).toContain('RequiresMountsFor=/var/lib/subweb-backups /mnt/subweb-backups');
       expect(unit).toContain('After=docker.service remote-fs.target');
       expect(unit).toContain('Wants=remote-fs.target');
       expect(unit).toContain('ExecCondition=/bin/sh -eu -c');
       expect(unit).toContain('mount=${BACKUP_REMOTE_MOUNT:-}');
       expect(unit).toContain('backup_path_is_supported "$mount"');
       expect(unit).toContain('backup_mount_is_distinct "$mount"');
       expect(unit).not.toContain('RequiresMountsFor=${BACKUP_REMOTE_MOUNT}');
     }
     expect(backupPath).toContain('backup_canonical_child_path');
     expect(backupPath).toContain('backup_path_has_navigation_component');
     expect(backupPath).toContain('backup_hold_mount');
     expect(verifyBackup).toContain('backup_canonical_child_path "$BACKUP_DIRECTORY" "$backup"');
     expect(verifyBackup).toContain('validate_backup_destination');
     });

    it('provides host checks for supported tools, disk pressure, and protected env', async () => {
    const checker = await read('scripts/vps/check-host.sh');
    const installer = await read('scripts/vps/install.sh');
    const documentation = await read('docs/deployment-vps.md');

    expect(checker).toContain('docker compose version');
    expect(checker).toContain('PROJECT_ROOT=${SUBWEB_ROOT:-/opt/subweb}');
    expect(checker).toContain('MIN_FREE_KIB must be a non-negative decimal');
    expect(checker).toContain('mode 0600');
    expect(installer).toContain('SUBWEB_ROOT must be /opt/subweb');
    expect(installer).toContain('release tree must not contain symbolic links');
    expect(installer).toContain('installed .env must be a regular file');
     expect(installer).toContain('install -d -o subweb -g subweb -m 0700 "$TARGET_DIRECTORY/.runtime" "$TARGET_DIRECTORY/.local"');
     expect(installer).toContain('reconcile_release_tree "$SOURCE_DIRECTORY" "$TARGET_DIRECTORY"');
     expect(installer).not.toContain('cp -a "$SOURCE_DIRECTORY/." "$TARGET_DIRECTORY/"');
     expect(installer).toContain('-path "$TARGET_DIRECTORY/.runtime" -o -path "$TARGET_DIRECTORY/.local"');
     expect(installer).not.toContain('chown -R');
    expect(installer).not.toContain('usermod -aG docker subweb');
    expect(installer).toContain('systemctl daemon-reload');
    expect(installer).toContain('systemctl enable subweb.service');
    expect(documentation).not.toContain('Docker group');
  });

  it('uses the configured deployment root for host checks', async () => {
    const fixture = await makeShellFixture();
    const installation = join(fixture, 'installation');
    await mkdir(installation);
    await writeFile(join(installation, '.env'), 'SHORT_LINKS_ENABLED=true\n', { mode: 0o600 });
    await chmod(join(installation, '.env'), 0o600);

    const result = runCheckHost(fixture, { MIN_FREE_KIB: '1' });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('free_kib=90000');
  });

  it('rejects a non-decimal minimum free-space threshold before comparing disk space', async () => {
    const fixture = await makeShellFixture();
    const installation = join(fixture, 'installation');
    await mkdir(installation);
    await writeFile(join(installation, '.env'), 'SHORT_LINKS_ENABLED=true\n', { mode: 0o600 });
    await chmod(join(installation, '.env'), 0o600);

    const result = runCheckHost(fixture, { MIN_FREE_KIB: '-1' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MIN_FREE_KIB must be a non-negative decimal');
  });

  it('rejects a non-default deployment root before creating service accounts', async () => {
    const fixture = await makeShellFixture();
    const source = join(fixture, 'release');
    await mkdir(source);
    await writeFile(join(source, 'compose.yaml'), 'services: {}\n');

    const result = runInstaller(fixture, source);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SUBWEB_ROOT must be /opt/subweb');
    expect(await readCalls(fixture)).toBe('');
  });

  it('rejects release trees containing symlinks before creating service accounts', async () => {
    const fixture = await makeShellFixture();
    const source = join(fixture, 'release');
    await mkdir(source);
    await writeFile(join(source, 'compose.yaml'), 'services: {}\n');
    await writeFile(join(fixture, 'outside'), 'outside\n');
    await symlink(join(fixture, 'outside'), join(source, 'linked-file'));

    const result = runInstaller(fixture, source);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('release tree must not contain symbolic links');
    expect(await readCalls(fixture)).toBe('');
  });

  it('rejects symlinked components before using an approved backup path', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'subweb-backup-path-'));
    temporaryDirectories.push(fixture);
    const backupRoot = join(fixture, 'approved-root');
    const nestedDirectory = join(backupRoot, 'nested');
    const outside = join(fixture, 'outside');
    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(outside, 'outside\n');

    const safePath = join(nestedDirectory, 'future', 'backup.rdb');
    const safeResult = runShell(
      'set -eu; . "$1"; if backup_path_has_symlink_component "$2" "$3"; then exit 1; fi',
      [backupPathScript, backupRoot, safePath],
    );
    expect(safeResult.status, `${safeResult.stdout}\n${safeResult.stderr}`).toBe(0);

    await symlink(outside, join(nestedDirectory, 'linked'));
    const unsafeResult = runShell(
      'set -eu; . "$1"; if backup_path_has_symlink_component "$2" "$3"; then exit 0; fi; exit 1',
      [backupPathScript, backupRoot, join(nestedDirectory, 'linked', 'backup.rdb')],
    );
    expect(unsafeResult.status, `${unsafeResult.stdout}\n${unsafeResult.stderr}`).toBe(0);
  });

  it('distinguishes a real remote mount from a directory on the root filesystem', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'subweb-backup-mount-'));
    temporaryDirectories.push(fixture);
    const mountPath = join(fixture, 'remote');
    await mkdir(mountPath);
    const findmnt = join(fixture, 'findmnt');
    await writeExecutable(findmnt, `#!/bin/sh
case "${'${FINDMNT_MODE:-local}'}" in
  local) printf '/\\n' ;;
  mounted) printf '%s\\n' "${'${BACKUP_MOUNT_PATH}'}" ;;
esac
`);

    const localResult = runShell(
      'set -eu; . "$1"; backup_mount_is_distinct "$2"',
      [backupPathScript, mountPath],
      { PATH: `${fixture}:${process.env.PATH}`, FINDMNT_MODE: 'local', BACKUP_MOUNT_PATH: mountPath },
    );
    expect(localResult.status).not.toBe(0);

    const mountedResult = runShell(
      'set -eu; . "$1"; backup_mount_is_distinct "$2"',
      [backupPathScript, mountPath],
      { PATH: `${fixture}:${process.env.PATH}`, FINDMNT_MODE: 'mounted', BACKUP_MOUNT_PATH: mountPath },
    );
    expect(mountedResult.status, `${mountedResult.stdout}\n${mountedResult.stderr}`).toBe(0);
  });

  it('reconciles release files while preserving deployment state and rejecting symlinks', async () => {
    const fixture = await makeShellFixture();
    const source = join(fixture, 'source');
    const target = join(fixture, 'target');
    await writeExecutable(join(fixture, 'bin', 'findmnt'), '#!/bin/sh\nprintf \'/\\n\'\n');
    await mkdir(join(source, 'scripts'), { recursive: true });
    await mkdir(join(target, '.runtime'), { recursive: true });
    await mkdir(join(target, '.local'), { recursive: true });
    await writeFile(join(source, 'compose.yaml'), 'new release\n');
    await writeFile(join(source, 'scripts', 'current.sh'), 'current\n');
    await writeFile(join(target, 'compose.yaml'), 'old release\n');
    await writeFile(join(target, 'stale.txt'), 'remove me\n');
    await writeFile(join(target, '.env'), 'APP_DOMAIN=kept.example\n', { mode: 0o600 });
    await writeFile(join(target, '.runtime', 'state'), 'runtime state\n');
    await writeFile(join(target, '.local', 'state'), 'local state\n');

    const result = runShell(
      'set -eu; . "$1"; reconcile_release_tree "$2" "$3"',
      [reconcileReleaseScript, source, target],
      { PATH: `${join(fixture, 'bin')}:${process.env.PATH}` },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readFile(join(target, 'compose.yaml'), 'utf8')).toBe('new release\n');
    expect(await readFile(join(target, 'scripts', 'current.sh'), 'utf8')).toBe('current\n');
    await expect(readFile(join(target, 'stale.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(target, '.env'), 'utf8')).toBe('APP_DOMAIN=kept.example\n');
    expect(await readFile(join(target, '.runtime', 'state'), 'utf8')).toBe('runtime state\n');
    expect(await readFile(join(target, '.local', 'state'), 'utf8')).toBe('local state\n');

    await writeFile(join(fixture, 'outside'), 'outside\n');
    await symlink(join(fixture, 'outside'), join(source, 'unsafe-link'));
    const unsafeResult = runShell(
      'set -eu; . "$1"; reconcile_release_tree "$2" "$3"',
      [reconcileReleaseScript, source, target],
      { PATH: `${join(fixture, 'bin')}:${process.env.PATH}` },
    );
    expect(unsafeResult.status).not.toBe(0);
  });

  it('ships an external TLS proxy contract without exposing the container publicly', async () => {
    const proxy = await read('deploy/nginx/subweb.conf');

    expect(proxy).toContain('listen 443 ssl');
    expect(proxy).toContain('proxy_pass http://subweb_gateway');
    expect(proxy).toContain('proxy_set_header Host $host');
    expect(proxy).toContain('server 127.0.0.1:18080');
    expect(proxy).toContain('include /etc/nginx/snippets/security-headers.conf');
    expect(proxy).not.toContain('0.0.0.0:18080');
  });
});
