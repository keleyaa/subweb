import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { checkRateLimit, createIpHash, RateLimitError } from './rate-limiter.mjs';
import { createCircuitBreaker, createConcurrencyLimiter } from './concurrency.mjs';
import { PolicyError, validateConversionQuery } from './url-policy.mjs';

const FORWARDED_PARAMS = [
  'target',
  'ver',
  'url',
  'config',
  'include',
  'exclude',
  'emoji',
  'udp',
  'sort',
  'list',
  'scv',
  'append_type',
  'filename',
];
const DEFAULT_MAX_REQUEST_BYTES = 16 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_RATE_LIMIT = 10;
const DEFAULT_RATE_WINDOW_SECONDS = 60;
const ALLOWED_RESPONSE_TYPES = new Set([
  'application/json',
  'application/octet-stream',
  'application/yaml',
  'text/plain',
  'text/yaml',
  'text/x-yaml',
]);

const defaultLogger = (entry) => console.log(JSON.stringify(entry));

const safeRequestId = (value) => (
  typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : randomUUID()
);

const getClientIp = (request) => {
  const forwardedIp = request.headers['x-real-ip'];
  if (typeof forwardedIp === 'string' && isIP(forwardedIp)) return forwardedIp;
  return request.socket.remoteAddress || 'unknown';
};

const sendJson = (response, status, payload, requestId, retryAfter = 0) => {
  const body = JSON.stringify(payload);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-request-id': requestId,
  };
  if (retryAfter > 0) headers['retry-after'] = String(retryAfter);
  response.writeHead(status, headers);
  response.end(body);
};

const toErrorResponse = (error) => {
  if (error instanceof PolicyError || error instanceof RateLimitError) {
    return { status: error.status, code: error.code, retryAfter: error.retryAfter || 0 };
  }
  return { status: 502, code: 'upstream_error', retryAfter: 0 };
};

const createUpstreamUrl = (baseUrl, requestUrl) => {
  const upstreamUrl = new URL('/sub', baseUrl);
  for (const name of FORWARDED_PARAMS) {
    for (const value of requestUrl.searchParams.getAll(name)) upstreamUrl.searchParams.append(name, value);
  }
  return upstreamUrl.toString();
};

const cancelResponse = async (response) => {
  try {
    await response.body?.cancel();
  } catch {
    // The upstream stream may already be closed.
  }
};

const shouldRecordCircuitFailure = (error) => {
  if (!(error instanceof PolicyError)) return true;
  return error.code === 'upstream_timeout'
    || (error.code === 'upstream_error' && error.status >= 500);
};

const readResponseBody = async (response, maxBytes) => {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelResponse(response);
    throw new PolicyError('response_too_large', 413);
  }

  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PolicyError('response_too_large', 413);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The upstream stream may already be closed.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
};

const fetchWithTimeout = async (fetchImpl, url, options, timeoutMs, consume) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    return await consume(response);
  } catch (error) {
    if (error?.name === 'AbortError') throw new PolicyError('upstream_timeout', 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const createPolicyServer = ({
  config,
  lookup,
  rateStore,
  upstreamFetch = fetch,
  logger = defaultLogger,
} = {}) => {
  const settings = {
    upstreamBaseUrl: config?.upstreamBaseUrl,
    ipHashSecret: config?.ipHashSecret,
    rateLimit: config?.rateLimit ?? DEFAULT_RATE_LIMIT,
    rateWindowSeconds: config?.rateWindowSeconds ?? DEFAULT_RATE_WINDOW_SECONDS,
    maxRequestBytes: config?.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
    maxResponseBytes: config?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    requestTimeoutMs: config?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    dnsTimeoutMs: config?.dnsTimeoutMs ?? 2_000,
    maxConcurrency: config?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
  };
  if (!settings.upstreamBaseUrl || !settings.ipHashSecret || !rateStore?.increment) {
    throw new Error('request policy configuration is incomplete');
  }

  const upstreamBaseUrl = new URL(settings.upstreamBaseUrl);
  const concurrency = createConcurrencyLimiter(settings.maxConcurrency);
  const circuit = createCircuitBreaker();

  const handleConversion = async (request, response, requestUrl, requestId) => {
    if (requestUrl.toString().length > settings.maxRequestBytes) {
      throw new PolicyError('request_too_large', 413);
    }

    await validateConversionQuery(requestUrl.searchParams, { lookup, dnsTimeoutMs: settings.dnsTimeoutMs });
    const ipHash = createIpHash(getClientIp(request), settings.ipHashSecret);
    await checkRateLimit({
      increment: rateStore.increment.bind(rateStore),
      key: `subweb:rate:convert:${ipHash}`,
      limit: settings.rateLimit,
      windowSeconds: settings.rateWindowSeconds,
    });

    if (!circuit.beforeRequest()) throw new PolicyError('upstream_circuit_open', 503);
    if (!concurrency.tryAcquire()) throw new RateLimitError('concurrency_limited', 429, 1);

    const startedAt = Date.now();
    try {
      const { upstreamResponse, body } = await fetchWithTimeout(
        upstreamFetch,
        createUpstreamUrl(upstreamBaseUrl, requestUrl),
        {
          method: 'GET',
          headers: {
            accept: 'text/plain, text/yaml, application/yaml, application/json, */*',
            'user-agent': 'subweb-request-policy/1',
          },
        },
        settings.requestTimeoutMs,
        async (responseFromUpstream) => {
          if (!responseFromUpstream.ok) {
            await cancelResponse(responseFromUpstream);
            throw new PolicyError('upstream_error', responseFromUpstream.status >= 500 ? 502 : 400);
          }

          const contentType = (responseFromUpstream.headers.get('content-type') || 'text/plain')
            .split(';', 1)[0]
            .trim()
            .toLowerCase();
          if (!ALLOWED_RESPONSE_TYPES.has(contentType)) {
            await cancelResponse(responseFromUpstream);
            throw new PolicyError('unsupported_content_type', 502);
          }

          return { upstreamResponse: responseFromUpstream, body: await readResponseBody(responseFromUpstream, settings.maxResponseBytes) };
        },
      );
      circuit.recordSuccess();
      response.writeHead(200, {
        'content-type': upstreamResponse.headers.get('content-type') || 'text/plain; charset=utf-8',
        'content-length': body.length,
        'cache-control': 'no-store',
        'x-request-id': requestId,
      });
      response.end(body);
      logger({ requestId, route: '/sub', status: 200, elapsedMs: Date.now() - startedAt });
    } catch (error) {
      if (shouldRecordCircuitFailure(error)) circuit.recordFailure();
      throw error;
    } finally {
      concurrency.release();
    }
  };

  return createServer(async (request, response) => {
    const startedAt = Date.now();
    const requestId = safeRequestId(request.headers['x-request-id']);
    let status = 500;
    let errorCode;
    try {
      const requestUrl = new URL(request.url || '/', 'http://request-policy.invalid');
      if (requestUrl.pathname === '/healthz' && request.method === 'GET') {
        status = 200;
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end('{"status":"ok"}');
        return;
      }
      if (requestUrl.pathname !== '/sub') throw new PolicyError('not_found', 404);
      if (request.method !== 'GET') throw new PolicyError('method_not_allowed', 405);

      await handleConversion(request, response, requestUrl, requestId);
      status = 200;
      return;
    } catch (error) {
      const result = toErrorResponse(error);
      status = result.status;
      errorCode = result.code;
      sendJson(response, result.status, { error: { code: result.code } }, requestId, result.retryAfter);
    } finally {
      if (status !== 200 || errorCode) logger({ requestId, route: request.url?.split('?')[0] || '/', status, errorCode, elapsedMs: Date.now() - startedAt });
    }
  });
};
