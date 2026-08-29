import { createServer } from 'node:http';
import { connect as defaultConnect, isIP } from 'node:net';
import { PolicyError, resolvePublicAddresses } from './url-policy.mjs';

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const CONNECT_AUTHORITY = /^(?:\[([0-9a-fA-F:.]+)\]|([a-zA-Z0-9.-]+)):(\d{1,5})$/;

const reject = (code, status) => {
  throw new PolicyError(code, status);
};

const parseAuthority = (authority) => {
  if (typeof authority !== 'string' || authority.length > 255) reject('url_not_allowed', 403);
  const match = CONNECT_AUTHORITY.exec(authority);
  if (!match) reject('url_not_allowed', 403);

  const hostname = match[1] ?? match[2];
  const port = Number(match[3]);
  if (!hostname || port !== 443) reject('url_not_allowed', 403);

  if (!isIP(hostname)) {
    try {
      const parsed = new URL(`https://${hostname}`);
      if (parsed.hostname !== hostname.toLowerCase() || parsed.pathname !== '/') reject('url_not_allowed', 403);
    } catch {
      reject('url_not_allowed', 403);
    }
  }

  return { hostname, port };
};

const connectToAddress = ({ address, port, connect, timeoutMs }) => new Promise((resolve, rejectConnect) => {
  let settled = false;
  let timer;
  let socket;

  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    callback(value);
  };

  try {
    socket = connect({ host: address, port });
    socket.once('connect', () => finish(resolve, socket));
    socket.once('error', () => finish(rejectConnect, new PolicyError('egress_unavailable', 502)));
    timer = setTimeout(() => {
      socket.destroy();
      finish(rejectConnect, new PolicyError('egress_timeout', 504));
    }, timeoutMs);
  } catch {
    finish(rejectConnect, new PolicyError('egress_unavailable', 502));
  }
});

const connectToVerifiedAddress = async ({ hostname, port, lookup, connect, dnsTimeoutMs, connectTimeoutMs }) => {
  const addresses = await resolvePublicAddresses(hostname, { lookup, dnsTimeoutMs });
  let error;
  for (const address of addresses) {
    try {
      return await connectToAddress({ address, port, connect, timeoutMs: connectTimeoutMs });
    } catch (nextError) {
      error = nextError;
    }
  }
  throw error ?? new PolicyError('egress_unavailable', 502);
};

const statusMessage = (status) => {
  if (status === 403) return 'Forbidden';
  if (status === 504) return 'Gateway Timeout';
  return 'Bad Gateway';
};

const closeWithError = (socket, error) => {
  const status = error instanceof PolicyError ? error.status : 502;
  socket.end(`HTTP/1.1 ${status} ${statusMessage(status)}\r\nConnection: close\r\n\r\n`);
};

export const createEgressProxy = ({
  lookup,
  connect = defaultConnect,
  dnsTimeoutMs,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  logger = () => {},
} = {}) => {
  const server = createServer((_, response) => {
    response.writeHead(405, { connection: 'close' });
    response.end();
  });

  server.on('connect', (request, clientSocket, head) => {
    void (async () => {
      try {
        const { hostname, port } = parseAuthority(request.url);
        const upstreamSocket = await connectToVerifiedAddress({
          hostname,
          port,
          lookup,
          connect,
          dnsTimeoutMs,
          connectTimeoutMs,
        });
        if (clientSocket.destroyed) {
          upstreamSocket.destroy();
          return;
        }

        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstreamSocket.write(head);
        clientSocket.pipe(upstreamSocket);
        upstreamSocket.pipe(clientSocket);
        clientSocket.once('error', () => upstreamSocket.destroy());
        upstreamSocket.once('error', () => clientSocket.destroy());
      } catch (error) {
        const status = error instanceof PolicyError ? error.status : 502;
        logger({ event: 'egress_connect', status, code: error instanceof PolicyError ? error.code : 'egress_unavailable' });
        closeWithError(clientSocket, error);
      }
    })();
  });

  return server;
};
