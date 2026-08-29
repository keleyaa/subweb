import { createServer as createTcpServer, connect as connectTcp } from 'node:net';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createEgressProxy } from '../../../services/request-policy/src/egress-proxy.mjs';

const listen = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};

const close = async (server) => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
};

const sendConnect = async (port, authority, payload = '') => new Promise((resolve, reject) => {
  const request = connectTcp({ host: '127.0.0.1', port });
  const chunks = [];
  request.once('connect', () => {
    request.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n${payload}`);
  });
  request.on('data', (chunk) => chunks.push(chunk));
  request.once('end', () => resolve(Buffer.concat(chunks).toString()));
  request.once('error', reject);
});

describe('request policy egress proxy', () => {
  it('connects to the address it validated without resolving the host again', async () => {
    const upstream = createTcpServer((socket) => {
      socket.on('data', (chunk) => {
        if (chunk.toString().includes('ping')) {
          socket.end('pong');
        }
      });
    });
    const upstreamPort = await listen(upstream);
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const connect = vi.fn(() => connectTcp({ host: '127.0.0.1', port: upstreamPort }));
    const proxy = createEgressProxy({ lookup, connect, connectTimeoutMs: 100 });
    const proxyPort = await listen(proxy);

    const response = await sendConnect(proxyPort, 'example.com:443', 'ping');

    expect(response).toContain('HTTP/1.1 200 Connection Established');
    expect(response).toContain('pong');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({ host: '93.184.216.34', port: 443 });

    await close(proxy);
    await close(upstream);
  });

  it('rejects private addresses before opening an outbound connection', async () => {
    const connect = vi.fn();
    const proxy = createEgressProxy({
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      connect,
      connectTimeoutMs: 100,
    });
    const proxyPort = await listen(proxy);

    const response = await sendConnect(proxyPort, 'private.example:443');

    expect(response).toContain('HTTP/1.1 403 Forbidden');
    expect(connect).not.toHaveBeenCalled();
    await close(proxy);
  });

  it('rejects non-HTTPS CONNECT ports before resolving the host', async () => {
    const lookup = vi.fn();
    const proxy = createEgressProxy({ lookup, connect: vi.fn(), connectTimeoutMs: 100 });
    const proxyPort = await listen(proxy);

    const response = await sendConnect(proxyPort, 'example.com:8443');

    expect(response).toContain('HTTP/1.1 403 Forbidden');
    expect(lookup).not.toHaveBeenCalled();
    await close(proxy);
  });
});
