import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const portsLibrary = new URL('../../scripts/local/lib/ports.sh', import.meta.url).pathname;
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('local source port ownership', () => {
  it('reports an occupied port and leaves the unrelated listener alive', async () => {
    const server = net.createServer((socket) => socket.end());
    servers.push(server);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;

    const result = spawnSync(
      'sh',
      ['-c', '. "$1"; assert_port_available "$2" LOCAL_APP_PORT', 'sh', portsLibrary, String(port)],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(String(port));
    expect(result.stderr).toContain('LOCAL_APP_PORT');
    await expect(new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', reject);
    })).resolves.toBe(true);
  });

  it('accepts an available loopback port without opening it', async () => {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));

    const result = spawnSync(
      'sh',
      ['-c', '. "$1"; assert_port_available "$2" LOCAL_API_PORT', 'sh', portsLibrary, String(port)],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
  });
});
