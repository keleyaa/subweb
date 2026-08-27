import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.RUN_NGINX_GATEWAY_TESTS === '1';
const root = fileURLToPath(new URL('../../', import.meta.url));
const suffix = process.pid + '-' + Date.now();
const network = 'subweb-content-' + suffix;
const upstream = 'subweb-content-upstream-' + suffix;
const gateway = 'subweb-content-gateway-' + suffix;
const clientA = 'subweb-content-client-a-' + suffix;
const clientB = 'subweb-content-client-b-' + suffix;
let gatewayPort;

function run(command, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      const result = { code, stdout, stderr };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new Error(command + ' exited ' + code + ': ' + stderr));
    });
  });
}
const docker = (...args) => run('docker', args);

async function waitFor(probe) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await probe()).code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('temporary Nginx fixture did not become ready');
}

describe.skipIf(!enabled)('real Nginx MyUrls v2 adapter', () => {
  beforeAll(async () => {
    await docker('network', 'create', network);
    await docker(
      'run', '--rm', '-d', '--name', upstream, '--network', network, 'node:alpine', 'node', '-e',
      "let requests=[];require('http').createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{if(req.url==='/metrics'){res.setHeader('content-type','application/json');res.end(JSON.stringify(requests));return}if(req.url==='/'||req.url==='/assets/app.js'){res.statusCode=200;res.end(req.url==='/'?'<script src=\"/assets/app.js\"></script>':'console.log(\"MyUrls\")');return}if(req.url==='/api/v1/links'){requests.push({authorization:req.headers.authorization||'',cookie:req.headers.cookie||'',origin:req.headers.origin||'',forwarded:req.headers.forwarded||'',xForwardedFor:req.headers['x-forwarded-for']||'',xRealIp:req.headers['x-real-ip']||'',type:req.headers['content-type']||'',body});res.statusCode=201;res.setHeader('content-type','application/json');res.end('{\"code\":\"Code1234\",\"shortUrl\":\"https://short.example.test/Code1234\",\"expiresAt\":\"2099-01-01T00:00:00.000Z\"}');return}res.statusCode=404;res.end('not found')})}).listen(3000,'0.0.0.0')",
    );
    for (const client of [clientA, clientB]) {
      await docker(
        'run', '--rm', '-d', '--name', client, '--network', network,
        'node:alpine', 'node', '-e', 'setInterval(() => {}, 2 ** 31 - 1)',
      );
    }
    await docker(
      'run', '--rm', '-d', '--name', gateway, '--network', network,
      '-p', '127.0.0.1::8080', '-v', root + 'nginx:/gateway:ro',
      '-v', root + 'scripts/render-gateway-config.sh:/render-gateway-config.sh:ro',
      '--entrypoint', 'sh', '-e', 'APP_DOMAIN=app.example.test',
      '-e', 'API_DOMAIN=api.example.test', '-e', 'SHORT_DOMAIN=short.example.test',
      '-e', 'SUBCONVERTER_UPSTREAM=http://subconverter:25500',
      '-e', 'MYURLS_APP_UPSTREAM=http://' + upstream + ':3000',
      '-e', 'MYURLS_SHORT_UPSTREAM=http://' + upstream + ':3000',
      '-e', 'MYURLS_MAX_BODY_BYTES=16384', 'nginxinc/nginx-unprivileged:alpine',
      '-c', 'mkdir -p /tmp/nginx/client_temp /tmp/nginx/proxy_temp /tmp/nginx/fastcgi_temp /tmp/nginx/uwsgi_temp /tmp/nginx/scgi_temp; sh /render-gateway-config.sh --template-root /gateway --output /tmp/nginx/nginx.conf --nginx-bin nginx; exec nginx -c /tmp/nginx/nginx.conf -g "daemon off;"',
    );
    gatewayPort = (await docker('port', gateway, '8080/tcp')).stdout.trim().match(/:([0-9]+)$/)?.[1];
    await waitFor(() => run('curl', ['--fail', '--silent', '--output', '/dev/null', '-H', 'Host: app.example.test', 'http://127.0.0.1:' + gatewayPort + '/healthz'], { allowFailure: true }));
  }, 120_000);

  afterAll(async () => {
    await run('docker', ['rm', '-f', clientA, clientB, gateway, upstream], { allowFailure: true });
    await run('docker', ['network', 'rm', network], { allowFailure: true });
  });

  const request = async ({ type = 'application/json', origin = 'https://app.example.test', query = '', body = '{"url":"https://example.com"}' } = {}) =>
    (await run('curl', [
      '--silent', '--output', '/dev/null', '--write-out', '%{http_code}', '-X', 'POST',
      '-H', 'Host: app.example.test', '-H', 'Origin: ' + origin, '-H', 'Content-Type: ' + type,
      '-H', 'Authorization: Bearer browser-secret', '-H', 'Cookie: session=browser-secret',
      '--data-binary', body, 'http://127.0.0.1:' + gatewayPort + '/short-api/v1/links' + query,
    ])).stdout;

  const requestFromClient = async (client, spoofedIp) =>
    (await docker(
      'exec', client, 'node', '-e',
      `const http=require('node:http');const req=http.request({host:${JSON.stringify(gateway)},port:8080,path:'/short-api/v1/links',method:'POST',headers:{Host:'app.example.test',Origin:'https://app.example.test','Content-Type':'application/json',Authorization:'Bearer browser-secret',Cookie:'session=browser-secret','X-Forwarded-For':${JSON.stringify(spoofedIp)},Forwarded:${JSON.stringify(`for=${spoofedIp}`)} }},res=>{res.resume();res.on('end',()=>process.stdout.write(String(res.statusCode)))});req.on('error',error=>{console.error(error);process.exit(1)});req.end('{"url":"https://example.com"}');`,
    )).stdout;

  it('enforces the exact JSON endpoint and strips browser credentials and Origin', async () => {
    expect(await request()).toBe('201');
    expect(await request({ type: 'application/json; charset=utf-8' })).toBe('201');
    expect(await request({ type: 'application/x-www-form-urlencoded' })).toBe('415');
    expect(await request({ type: 'text/plain' })).toBe('415');
    expect(await request({ origin: 'https://evil.example.test' })).toBe('403');
    expect(await request({ query: '?private=sentinel' })).toBe('404');
    expect(await requestFromClient(clientA, '198.51.100.11')).toBe('201');
    expect(await requestFromClient(clientB, '203.0.113.23')).toBe('201');
    for (const path of ['/', '/assets/app.js']) {
      const status = await run('curl', ['--silent', '--output', '/dev/null', '--write-out', '%{http_code}', '-H', 'Host: short.example.test', 'http://127.0.0.1:' + gatewayPort + path]);
      expect(status.stdout).toBe('200');
    }
    const response = await docker('exec', upstream, 'node', '-e',
      "require('http').get('http://127.0.0.1:3000/metrics',r=>r.pipe(process.stdout))");
    const metrics = JSON.parse(response.stdout);
    expect(metrics).toHaveLength(4);
    for (const item of metrics) {
      expect(item).toMatchObject({ authorization: '', cookie: '', origin: '' });
      expect(item.type).toMatch(/^application\/json/i);
      expect(JSON.parse(item.body)).toEqual({ url: 'https://example.com' });
    }
    const directClientRequests = metrics.slice(-2);
    const clientIps = directClientRequests.map((item) => item.xForwardedFor);
    expect(new Set(clientIps).size).toBe(2);
    expect(clientIps).not.toContain('198.51.100.11');
    expect(clientIps).not.toContain('203.0.113.23');
    for (const item of directClientRequests) {
      expect(item.forwarded).toBe('');
      expect(item.xRealIp).toBe(item.xForwardedFor);
    }
  }, 60_000);
});
