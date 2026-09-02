import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const gatewayRoot = path.resolve(import.meta.dirname, '../../services/gateway');
const commandTimeoutMs = 120_000;

const runGoMyURLsTests = () => new Promise((resolve, reject) => {
  const child = spawn('go', [
    'test',
    '-race',
    './internal/myurls',
    '-count=1',
  ], {
    cwd: gatewayRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let settled = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, commandTimeoutMs);

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
    if (timedOut) stderr += `\ncommand timed out after ${commandTimeoutMs}ms`;
    resolve({ status: status ?? 1, signal, stdout, stderr, timedOut });
  });
});

describe('Go Gateway MyUrls adapter integration', () => {
  it('runs the Rust v2 adapter contract with the race detector', async () => {
    const result = await runGoMyURLsTests();
    expect(result.timedOut, result.stderr).toBe(false);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('ok');
  }, 150_000);
});
