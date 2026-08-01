import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.RUN_NGINX_GATEWAY_TESTS === '1';
const root = fileURLToPath(new URL('../../', import.meta.url));
const suffix = `${process.pid}-${Date.now()}`;
const network = `subweb-content-${suffix}`;
const upstream = `subweb-content-upstream-${suffix}`;
const gateway = `subweb-content-gateway-${suffix}`;
const token = 'c'.repeat(64);
let gatewayPort;

const pause = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

function run(command, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      const result = { code, stdout, stderr };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new Error(`${command} exited ${code}: ${stderr}`));
    });
  });
}

const docker = (...args) => run('docker', args);

async function diagnostics() {
  const details = [];
  for (const container of [upstream, gateway]) {
    const state = await run(
      'docker', ['inspect', '--format', '{{.State.Status}} {{.State.ExitCode}} {{.State.Error}}', container],
      { allowFailure: true },
    );
    const logs = await run('docker', ['logs', '--tail', '80', container], {
      allowFailure: true,
    });
    details.push(`${container}: ${state.stdout}${state.stderr}${logs.stdout}${logs.stderr}`);
  }
  return details.join('\n').split(token).join('[redacted]');
}

async function waitFor(label, probe, { timeoutMs = 20_000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await probe();
    if (result.code === 0) return;
    if (Date.now() < deadline) await pause(intervalMs);
  } while (Date.now() < deadline);

  throw new Error(`${label} did not become ready within ${timeoutMs}ms\n${await diagnostics()}`);
}

describe.skipIf(!enabled)('real Nginx short creation Content-Type gate', () => {
  beforeAll(async () => {
    await docker('network', 'create', network);
    await docker(
      'run', '--rm', '-d', '--name', upstream, '--network', network,
      '-e', `EXPECTED_AUTHORIZATION=Bearer ${token}`,
      'node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd',
      'node', '-e',
      "let count=0,expectedAuthorizationRequests=0,authorizationHeaderCount=0;const expected=process.env.EXPECTED_AUTHORIZATION;require('http').createServer((req,res)=>{req.resume();req.on('end',()=>{if(req.url==='/metrics'){res.setHeader('content-type','application/json');res.end(JSON.stringify({count,expectedAuthorizationRequests,authorizationHeaderCount}));return}if(req.url==='/count'){res.end(String(count));return}if(req.url.startsWith('/short')){count++;const values=req.headersDistinct.authorization||[];authorizationHeaderCount+=values.length;if(values.length===1&&values[0]===expected)expectedAuthorizationRequests++;res.statusCode=201;res.end('created');return}res.statusCode=404;res.end('not found')})}).listen(8080,'0.0.0.0')",
    );
    await docker(
      'run', '--rm', '-d', '--name', gateway, '--network', network,
      '-p', '127.0.0.1::8080',
      '-v', `${root}nginx:/gateway:ro`,
      '-v', `${root}scripts/render-gateway-config.sh:/render-gateway-config.sh:ro`,
      '--entrypoint', 'sh',
      '-e', 'GATEWAY_MODE=behind-proxy',
      '-e', 'APP_DOMAIN=app.example.test',
      '-e', 'API_DOMAIN=api.example.test',
      '-e', 'PUBLIC_SCHEME=https',
      '-e', 'GATEWAY_PORT=8080',
      '-e', 'SUBCONVERTER_UPSTREAM=http://subconverter:25500',
      '-e', `MYURLS_UPSTREAM=http://${upstream}:8080`,
      '-e', `MYURLS_API_TOKEN=${token}`,
      '-e', 'MYURLS_MAX_BODY_BYTES=1048576',
      '-e', 'TLS_CERT_PATH=',
      '-e', 'TLS_KEY_PATH=',
      'nginxinc/nginx-unprivileged:1.30.4-alpine@sha256:44e36330f74d4f3a1d4e222acca9e23b401fb87811a7597024502bb759c4dd49',
      '-c', 'mkdir -p /tmp/nginx/client_temp /tmp/nginx/proxy_temp /tmp/nginx/fastcgi_temp /tmp/nginx/uwsgi_temp /tmp/nginx/scgi_temp; sh /render-gateway-config.sh --template-root /gateway --output /tmp/nginx/nginx.conf --nginx-bin nginx; exec nginx -c /tmp/nginx/nginx.conf -g "daemon off;"',
    );
    const port = await docker('port', gateway, '8080/tcp');
    gatewayPort = port.stdout.trim().match(/:([0-9]+)$/)?.[1];
    expect(gatewayPort).toMatch(/^[0-9]+$/);

    await waitFor('upstream /count', () => run('docker', [
      'exec', upstream, 'node', '-e',
      "require('http').get('http://127.0.0.1:8080/count',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))",
    ], { allowFailure: true }));
    await waitFor('gateway /healthz', () => run('curl', [
      '--silent', '--show-error', '--fail', '--output', '/dev/null',
      '--connect-timeout', '1', '--max-time', '2',
      '-H', 'Host: app.example.test',
      `http://127.0.0.1:${gatewayPort}/healthz`,
    ], { allowFailure: true }));
  }, 120_000);

  afterAll(async () => {
    await run('docker', ['rm', '-f', gateway, upstream], { allowFailure: true });
    await run('docker', ['network', 'rm', network], { allowFailure: true });
  }, 30_000);

  const request = async (contentType, query = '') => {
    const args = [
      '--silent', '--output', '/dev/null', '--write-out', '%{http_code}',
      '--connect-timeout', '2', '--max-time', '5', '-X', 'POST',
      '-H', 'Host: app.example.test', '--data-binary', '{}',
    ];
    args.push('-H', contentType === null ? 'Content-Type:' : `Content-Type: ${contentType}`);
    args.push(`http://127.0.0.1:${gatewayPort}/short-api/short${query}`);
    return (await run('curl', args)).stdout;
  };

  it('forwards only allowed media types and keeps rejected bodies and secrets out of logs', async () => {
    expect(await request('application/json; charset=utf-8')).toBe('201');
    expect(await request('Application/X-Www-Form-Urlencoded; charset="utf-8"')).toBe('201');
    expect(await request('text/plain', '?private=content-type-sentinel')).toBe('415');
    expect(await request(null)).toBe('415');
    expect(await request('application/jsonp')).toBe('415');

    const metricsResult = await docker(
      'exec', upstream, 'node', '-e',
      "require('http').get('http://127.0.0.1:8080/metrics',r=>r.pipe(process.stdout))",
    );
    const metrics = JSON.parse(metricsResult.stdout);
    expect(metrics).toEqual({
      count: 2,
      expectedAuthorizationRequests: 2,
      authorizationHeaderCount: 2,
    });

    const [gatewayLogs, upstreamLogs] = await Promise.all([
      docker('logs', gateway),
      docker('logs', upstream),
    ]);
    const combinedLogs = [
      gatewayLogs.stdout,
      gatewayLogs.stderr,
      upstreamLogs.stdout,
      upstreamLogs.stderr,
    ].join('\n');
    expect(combinedLogs.includes('content-type-sentinel')).toBe(false);
    expect(combinedLogs.includes(token)).toBe(false);
    expect(combinedLogs.includes('?private=')).toBe(false);
  }, 60_000);
});
