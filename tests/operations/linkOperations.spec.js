import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const operation = (name) => path.join(root, 'scripts/operations', name);

describe('short-link data operations safety contracts', () => {
  it.each([
    ['backup-links.sh', []],
    ['restore-links.sh', ['--backup', '/tmp/missing.db']],
  ])('fails closed before Docker work when required arguments are absent: %s', (name, args) => {
    const result = spawnSync('sh', [operation(name), ...args], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/REPLACE_WITH|IP_HASH_SECRET=/u);
  });

  it('requires explicit restore confirmation and an absolute regular snapshot', () => {
    const restore = fs.readFileSync(operation('restore-links.sh'), 'utf8');

    expect(restore).toContain("--confirm-stop-writes is required.");
    expect(restore).toContain("require_absolute_regular_file \"$backup\" 'backup'");
    expect(restore).toContain("'SQLite format 3'");
    expect(restore).toContain('compose stop gateway');
    expect(restore).toContain('compose up -d --no-build --pull never --wait gateway');
    expect(restore).not.toMatch(/compose down[^\n]*(?:--volumes|-v)/u);
  });

  it('writes a verified snapshot without tearing down the stack', () => {
    const backup = fs.readFileSync(operation('backup-links.sh'), 'utf8');

    expect(backup).toContain('gateway --backup-links');
    expect(backup).toContain('-db /data/links.db');
    expect(backup).toContain("'SQLite format 3'");
    expect(backup).toContain('compose run --rm --no-deps');
    expect(backup).not.toMatch(/compose down/u);
    expect(backup).not.toContain('--user root');
  });

  it('dispatches backup and restore through the production command', () => {
    const command = fs.readFileSync(path.join(root, 'scripts/subweb.sh'), 'utf8');

    expect(command).toContain('operations/backup-links.sh');
    expect(command).toContain('operations/restore-links.sh');
    expect(command).toContain('--backup "$2" --confirm-stop-writes');
    expect(command).not.toContain('backup-redis.sh');
    expect(command).not.toContain('restore-redis.sh');
    expect(command).not.toMatch(/compose down[^\n]*(?:--volumes|-v)/u);
  });

  it('provides a non-destructive Redis export and a dry-run migration', () => {
    const exporter = fs.readFileSync(operation('export-redis-links.sh'), 'utf8');
    const migration = fs.readFileSync(operation('migrate-shortlinks.sh'), 'utf8');

    expect(exporter).toContain('myurl:link:*');
    expect(exporter).toContain('REDISCLI_AUTH');
    expect(exporter).not.toMatch(/redis-cli[^\n]*DEL/u);
    expect(exporter).not.toMatch(/FLUSHDB|FLUSHALL/u);
    expect(migration).toContain('--dry-run');
    expect(migration).toContain('gateway --import-links');
    expect(migration).toContain('--input');
    expect(migration).not.toMatch(/compose down[^\n]*(?:--volumes|-v)/u);
  });

  it('keeps the retired Redis and MyUrls operations out of the repository', () => {
    for (const retired of [
      'backup-redis.sh',
      'restore-redis.sh',
      'verify-redis-backup.sh',
      'inventory-myurls-v1.sh',
      'migrate-myurls-v1.sh',
    ]) {
      expect(fs.existsSync(operation(retired))).toBe(false);
    }
  });
});
