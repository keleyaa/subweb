import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

describe('VPS runtime contract', () => {
  it('defines a hardened systemd application unit owned by the repository entrypoint', async () => {
    const unit = await read('deploy/systemd/subweb.service');

    expect(unit).toContain('ExecStart=/opt/subweb/scripts/subweb.sh up');
    expect(unit).toContain('ExecStop=/opt/subweb/scripts/subweb.sh down');
    expect(unit).toContain('User=subweb');
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

    expect(service).toContain('ExecStart=/opt/subweb/scripts/vps/backup.sh');
    expect(service).toContain('User=subweb');
    expect(timer).toContain('OnCalendar=*-*-* 03:15:00');
    expect(timer).toContain('Persistent=true');
    expect(backup).toContain('AGE_RECIPIENT');
    expect(backup).toContain('BACKUP_REMOTE_MOUNT');
    expect(backup).toContain('retention is refused');
    expect(backup).toContain('sha256');
    expect(verifyService).toContain('ExecStart=/bin/sh -eu -c');
    expect(verifyTimer).toContain('OnCalendar=Sun *-*-01..07 04:15:00');
    expect(verifyBackup).toContain('verify-redis-backup.sh');
  });

  it('provides host checks for supported tools, disk pressure, and protected env', async () => {
    const checker = await read('scripts/vps/check-host.sh');
    const installer = await read('scripts/vps/install.sh');

    expect(checker).toContain('docker compose version');
    expect(checker).toContain('MIN_FREE_KIB');
    expect(checker).toContain('mode 0600');
    expect(installer).toContain('/opt/subweb');
    expect(installer).toContain('systemctl daemon-reload');
    expect(installer).toContain('systemctl enable subweb.service');
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
