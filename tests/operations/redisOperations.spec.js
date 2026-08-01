import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const operation = (name) => path.join(root, 'scripts/operations', name);

describe('Redis operations safety contracts', () => {
  it.each([
    ['backup-redis.sh', []],
    ['verify-redis-backup.sh', []],
    ['restore-redis.sh', ['--backup', '/tmp/missing.rdb']],
    ['preflight-upgrade.sh', []],
  ])('fails closed before Docker work when required arguments are absent: %s', (name, args) => {
    const result = spawnSync('sh', [operation(name), ...args], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/REPLACE_WITH|MYURLS_API_TOKEN|REDIS_PASSWORD=/u);
  });

  it('keeps secrets out of host command arguments and requires explicit restore confirmation', () => {
    const backup = fs.readFileSync(operation('backup-redis.sh'), 'utf8');
    const restore = fs.readFileSync(operation('restore-redis.sh'), 'utf8');
    expect(backup).toContain("redis-cli --no-auth-warning -a \"$REDIS_PASSWORD\"");
    expect(backup).not.toMatch(/docker compose exec[^\n]*REDIS_PASSWORD/u);
    expect(restore).toContain('--confirm-stop-writes');
    expect(restore).toContain('Pre-restore backup retained');
    expect(restore).toContain('install -m 0644 "$snapshot" "$restore_staging"');
    expect(restore).toContain('rm -f "$restore_staging"');
    expect(restore).not.toContain('--user root');
    expect(restore).toContain('rm -rf /data/appendonlydir');
    expect(restore).toContain('CONFIG SET appendonly yes');
    expect(restore).toContain('aof_rewrite_in_progress:0');
    expect(restore).not.toContain('down -v');
  });

  it('uses the locked Redis image for offline backup validation', () => {
    const library = fs.readFileSync(operation('lib.sh'), 'utf8');
    const verify = fs.readFileSync(operation('verify-redis-backup.sh'), 'utf8');
    expect(library).toContain('deploy/versions.lock.json');
    expect(verify).toContain('--network none');
    expect(verify).toContain('redis-check-rdb');
    expect(verify).toContain('--appendonly no');
    expect(verify).toContain('--logfile /tmp/redis.log');
    expect(verify).toContain('DBSIZE');
    expect(verify).toContain('readonly');
  });
});
