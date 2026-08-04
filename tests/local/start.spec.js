import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const startScript = new URL('../../scripts/local/start.sh', import.meta.url);
const healthLibrary = new URL('../../scripts/local/lib/health.sh', import.meta.url);

describe('atomic local source startup', () => {
  it('checks every port before starting and keeps the strict dependency order', async () => {
    const source = await readFile(startScript, 'utf8');
    const portCheck = source.indexOf('assert_all_local_ports');
    const redis = source.indexOf('start_local_service redis');
    const myurls = source.indexOf('start_local_service myurls');
    const subconverter = source.indexOf('start_local_service subconverter');
    const vite = source.indexOf('start_local_service vite');
    const nginx = source.indexOf('start_local_service nginx');

    expect(portCheck).toBeGreaterThan(-1);
    expect(portCheck).toBeLessThan(redis);
    expect(redis).toBeLessThan(myurls);
    expect(myurls).toBeLessThan(subconverter);
    expect(source).toContain('(cd "$run_root" &&');
    expect(source).toContain('cp -R "$myurls_source/public" "$run_root/public"');
    expect(source).toContain('node "$project_root/node_modules/vite/bin/vite.js"');
    expect(source).not.toContain('npm run serve');
    expect(source).toContain('MyUrls log tail (secrets redacted):');
    expect(source).toContain('TZ=Asia/Shanghai');
    expect(source).toContain('export TZ');
    expect(source).toContain('gsub(token, "[REDACTED]")');
    expect(subconverter).toBeLessThan(vite);
    expect(vite).toBeLessThan(nginx);
    expect(source).toContain('rollback_new_services');
    expect(source).toContain('--host 127.0.0.1 --port "$LOCAL_VITE_PORT" --strictPort');
    expect(source).not.toMatch(/\b(?:pkill|killall)\b/);
  });

  it('requires bootstrap artifacts and bounded health checks before retaining PID records', async () => {
    const source = await readFile(startScript, 'utf8');
    const health = await readFile(healthLibrary, 'utf8');

    expect(source).toContain('.runtime/local/secrets.env');
    expect(source).toContain('.runtime/local/config/sources.env');
    expect(source).toContain('wait_for_http_health');
    expect(source).toContain('wait_for_redis_health');
    expect(health).toContain('LOCAL_HEALTH_TIMEOUT');
    expect(source.indexOf('publish_pid_records')).toBeGreaterThan(source.indexOf('start_local_service nginx'));
  });
});
