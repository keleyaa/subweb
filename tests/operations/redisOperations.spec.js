import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const operation = (name) => path.join(root, 'scripts/operations', name);
const operationsVerifier = path.join(root, 'scripts/verify-redis-operations.sh');

describe('Redis operations safety contracts', () => {
  it.each([
    ['backup-redis.sh', []],
    ['verify-redis-backup.sh', []],
    ['restore-redis.sh', ['--backup', '/tmp/missing.rdb']],
    ['migrate-myurls-v1.sh', []],
    ['preflight-upgrade.sh', []],
  ])('fails closed before Docker work when required arguments are absent: %s', (name, args) => {
    const result = spawnSync('sh', [operation(name), ...args], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/REPLACE_WITH|MYURLS_API_TOKEN|REDIS_PASSWORD=/u);
  });

  it('inventories and migrates v1 keys without exposing or deleting key data', () => {
    const inventory = fs.readFileSync(operation('inventory-myurls-v1.sh'), 'utf8');
    const migration = fs.readFileSync(operation('migrate-myurls-v1.sh'), 'utf8');

    expect(inventory).toContain("redis.call('SCAN'");
    expect(inventory).toContain('destination_conflicts=');
    expect(inventory).not.toContain("redis.call('GET'");
    expect(migration).toContain('--confirm-stop-writes');
    expect(migration).toContain('--ttl-policy must be preserve or cap-90d');
    expect(migration).toContain("redis.call('SET', destination, value, 'PX', pttl, 'NX')");
    expect(migration).not.toMatch(/redis\.call\(['"]DEL/u);
    expect(migration).toContain('Gateway and MyUrls remain stopped');
    expect(migration.indexOf('backup-redis.sh')).toBeLessThan(migration.indexOf("redis.call('SET'"));
  });

  it('keeps secrets out of host command arguments and requires explicit restore confirmation', () => {
    const backup = fs.readFileSync(operation('backup-redis.sh'), 'utf8');
    const restore = fs.readFileSync(operation('restore-redis.sh'), 'utf8');
    const verifier = fs.readFileSync(operationsVerifier, 'utf8');
    expect(backup).toContain('REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning --raw SAVE');
    expect(backup).not.toContain('-a "$REDIS_PASSWORD"');
    expect(backup).not.toMatch(/docker compose exec[^\n]*REDIS_PASSWORD/u);
    expect(verifier).not.toContain('inventory-myurls-v1.sh');
    expect(verifier).not.toContain('migrate-myurls-v1.sh');
    expect(verifier).toContain('compose.yaml:$project_root/compose.test.yaml');
    expect(verifier).toContain('REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning FLUSHDB');
    expect(verifier).toContain('docker compose restart redis');
    expect(verifier).toContain('docker compose restart gateway');
    expect(verifier).toContain('docker compose restart subconverter');
    expect(verifier).not.toContain('-a "$REDIS_PASSWORD"');
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

  it('pins the MyUrls, Redis, and SubConverter images from the version lock for the temporary operations stack', () => {
    const verifier = fs.readFileSync(operationsVerifier, 'utf8');

    expect(verifier).toContain('scripts/verify-version-locks.mjs');
    expect(verifier).toContain('deploy/versions.lock.json');
    expect(verifier).toContain("['myurls', 'redis', 'subconverter']");
    expect(verifier).toContain('image.reference}@${image.digest}');
    expect(verifier).toContain('printf \'%s\\n\' "$myurls_image"');
  });

  it('isolates temporary Compose environments from caller configuration', () => {
    const unifiedVerifier = fs.readFileSync(
      path.join(root, 'scripts/verify-unified-stack.sh'),
      'utf8',
    );
    const isolationBlock = `unset \\
  APP_DOMAIN API_DOMAIN API_URL SHORT_DOMAIN \\
  SHORT_LINKS_ENABLED CUSTOM_BACKEND_ENABLED \\
  CONVERSION_RATE_LIMIT CONVERSION_RATE_WINDOW_SECONDS \\
  SUBWEB_PORT MYURLS_NETWORK_SUBNET MYURLS_GATEWAY_IP MYURLS_APP_IP MYURLS_SHORT_IP MYURLS_TRUST_PROXY_CIDR \\
  REDIS_PASSWORD IP_HASH_SECRET TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY \\
  MYURLS_IMAGE REDIS_IMAGE SUBCONVERTER_IMAGE`;

    for (const verifier of [operationsVerifier, path.join(root, 'scripts/verify-unified-stack.sh')]) {
      const source = verifier === operationsVerifier
        ? fs.readFileSync(verifier, 'utf8')
        : unifiedVerifier;

      expect(source).toContain(isolationBlock);
      expect(source.indexOf(isolationBlock)).toBeLessThan(source.indexOf('export COMPOSE_FILE'));
    }
  });
});
