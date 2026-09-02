import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const gatewayRoot = path.resolve(import.meta.dirname, '../../services/gateway');
const commandTimeoutMs = 120_000;

const runGoConversionTests = () => new Promise((resolve, reject) => {
  const child = spawn('go', [
    'test',
    '-race',
    './internal/conversion',
    '-count=1',
  ], {
    cwd: gatewayRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, commandTimeoutMs);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once('close', (status, signal) => {
    clearTimeout(timer);
    resolve({ status: status ?? 1, signal, stdout, stderr, timedOut });
  });
});

describe('Go Gateway conversion policy integration', () => {
  it('runs the conversion service through the API route contract', async () => {
    const result = await runGoConversionTests();
    expect(result.timedOut, result.stderr).toBe(false);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('ok');
  }, 150_000);
});
