import { spawn, spawnSync } from 'node:child_process';
import { readFile, rm, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const gatewayRoot = path.join(root, 'services/gateway');
const goModPath = path.join(gatewayRoot, 'go.mod');
const redisSourcePath = path.join(gatewayRoot, 'internal/ratelimit/redis.go');
const hashSourcePath = path.join(gatewayRoot, 'internal/privacy/hash.go');
const redisIntegrationRequested = process.env.RUN_REDIS_INTEGRATION === '1';
const goAvailable = spawnSync('go', ['version'], { stdio: 'ignore' }).status === 0;
const dockerAvailable = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
const redisIntegrationEnabled = redisIntegrationRequested && goAvailable && dockerAvailable;
const redisTestPassword = 'subweb-task5-isolated-password';
const composeTimeoutMs = 90_000;
const goTestTimeoutMs = 120_000;
const cleanupTimeoutMs = 60_000;

const runCommand = (command, args, { cwd = root, env = process.env, timeoutMs = 120_000 } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        stderr += `\ncommand timed out after ${timeoutMs}ms`;
      }
      resolve({ status: status ?? 1, signal, stdout, stderr });
    });
  });

const runCompose = (composeFile, project, args, timeoutMs) => runCommand(
  'docker',
  ['compose', '--project-name', project, '--file', composeFile, ...args],
  { timeoutMs },
);

const requireSuccess = (result, label) => {
  if (result.status !== 0) {
    throw new Error(`${label} failed with status ${result.status}.\n${result.stdout}\n${result.stderr}`);
  }
};

const runIsolatedRedisTest = async () => {
  let directory;
  let composeFile;
  let project;
  let composeAttempted = false;
  let primaryError;
  let cleanupError;

  try {
    directory = await mkdtemp(path.join(tmpdir(), 'subweb-gateway-redis-'));
    project = `subweb-task5-${path.basename(directory).toLowerCase().replaceAll(/[^a-z0-9]/gu, '').slice(-24)}`;
    composeFile = path.join(directory, 'compose.yaml');
    await writeFile(composeFile, `services:
  redis:
    image: docker.io/library/redis:8.10.1@sha256:298e5b3bc566bade82f46ad5511777a4a07a294097ce16ada2f6a42be5239df5
    command: ["redis-server", "--save", "", "--appendonly", "no", "--requirepass", "${redisTestPassword}"]
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${redisTestPassword}", "ping"]
      interval: 1s
      timeout: 2s
      retries: 20
    ports:
      - target: 6379
        published: "0"
        host_ip: 127.0.0.1
`);
    composeAttempted = true;

    const started = await runCompose(composeFile, project, ['up', '--detach', '--wait'], composeTimeoutMs);
    requireSuccess(started, 'isolated Redis Compose startup');

    const portResult = await runCompose(composeFile, project, ['port', 'redis', '6379'], 10_000);
    requireSuccess(portResult, 'isolated Redis port discovery');
    const portMatch = portResult.stdout.match(/:(\d+)\s*$/u);
    if (!portMatch) {
      throw new Error(`isolated Redis port output was invalid: ${portResult.stdout}`);
    }
    const redisPort = Number(portMatch[1]);
    if (!Number.isInteger(redisPort) || redisPort < 1 || redisPort > 65_535) {
      throw new Error(`isolated Redis port was invalid: ${redisPort}`);
    }

    const result = await runCommand(
      'go',
      [
        'test',
        '-race',
        './internal/ratelimit',
        '-run',
        '^TestRedisStoreAgainstIntegrationRedis$',
        '-count=1',
      ],
      {
        cwd: gatewayRoot,
        env: {
          ...process.env,
          RUN_REDIS_INTEGRATION: '1',
          REDIS_TEST_URL: `redis://127.0.0.1:${redisPort}/0`,
          REDIS_PASSWORD: redisTestPassword,
        },
        timeoutMs: goTestTimeoutMs,
      },
    );
    requireSuccess(result, 'Go Redis integration test');
  } catch (error) {
    primaryError = error;
  } finally {
    if (composeAttempted) {
      try {
        const stopped = await runCompose(
          composeFile,
          project,
          ['down', '--volumes', '--remove-orphans'],
          cleanupTimeoutMs,
        );
        requireSuccess(stopped, 'isolated Redis Compose cleanup');
      } catch (error) {
        cleanupError = error;
      }
    }
    if (directory) {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        cleanupError ??= error;
      }
    }
  }

  if (primaryError) {
    if (cleanupError) {
      primaryError.message += `\nCleanup also failed: ${cleanupError.message}`;
    }
    throw primaryError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
};

describe('Go Gateway Redis rate-limit contract', () => {
  it('uses the dedicated go-redis client and conversion namespace', async () => {
    const [goMod, redisSource] = await Promise.all([
      readFile(goModPath, 'utf8'),
      readFile(redisSourcePath, 'utf8'),
    ]);

    expect(goMod).toMatch(/github\.com\/redis\/go-redis\/v9\s+v[0-9.]+/u);
    expect(redisSource).toContain('options.DB = 1');
    expect(redisSource).toContain('options.Password = password');
    expect(redisSource).toContain('options.ContextTimeoutEnabled = true');
    expect(redisSource).toContain('options.MaxRetries = -1');
    expect(redisSource).toContain('conversionRateKeyPrefix = "subweb:rate:convert:"');
    expect(redisSource).toContain('subweb:rate:convert:');
  });

  it('keeps counter increment and expiry in one Lua operation', async () => {
    const redisSource = await readFile(redisSourcePath, 'utf8');

    expect(redisSource).toContain('redisIncrementScript');
    expect(redisSource).toMatch(/redis\.call\(\\?"INCR"/u);
    expect(redisSource).toMatch(/redis\.call\(\\?"TTL"/u);
    expect(redisSource).toMatch(/redis\.call\(\\?"EXPIRE"/u);
    expect(redisSource).toContain('store.executor.Eval(');
    expect(redisSource).toContain('return { count, ttl }');
  });

  it('allows only hashed identifiers into Redis and never logs identities', async () => {
    const [redisSource, hashSource] = await Promise.all([
      readFile(redisSourcePath, 'utf8'),
      readFile(hashSourcePath, 'utf8'),
    ]);

    expect(redisSource).toContain('namespacedConversionKey');
    expect(redisSource).toContain('if !isHashDigest(key)');
    expect(redisSource).toContain('strings.HasPrefix(key, conversionRateKeyPrefix)');
    expect(redisSource).not.toMatch(/log\.(?:Print|Printf|Println)/u);
    expect(hashSource).toContain('hmac.New(sha256.New, hasher.secret)');
    expect(hashSource).toContain('hex.EncodeToString');
    expect(hashSource).toContain('netip.ParseAddr(ip)');
    expect(hashSource).not.toMatch(/log\.(?:Print|Printf|Println)/u);
  });

  it.skipIf(!redisIntegrationEnabled)(
    'runs Redis Lua, DB isolation, expiry, and atomicity against an isolated temporary Compose service',
    runIsolatedRedisTest,
    300_000,
  );
});
