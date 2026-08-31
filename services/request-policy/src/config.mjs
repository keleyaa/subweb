const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const secret = (name) => {
  const value = required(name);
  if (value.length < 32) throw new Error(`Environment variable ${name} must contain at least 32 characters`);
  return value;
};

const upstreamUrl = () => {
  const value = required('SUBCONVERTER_UPSTREAM');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Environment variable SUBCONVERTER_UPSTREAM must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Environment variable SUBCONVERTER_UPSTREAM must be an HTTP(S) URL without credentials');
  }
  return value;
};

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

const positiveInteger = (name, fallback, maximum = Number.MAX_SAFE_INTEGER) => {
  const value = process.env[name] ?? String(fallback);
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new Error(`Environment variable ${name} must be a positive integer no greater than ${maximum}`);
  }
  return number;
};

export const loadConfig = () => ({
  port: positiveInteger('PORT', 25501),
  egressProxyPort: positiveInteger('EGRESS_PROXY_PORT', 25502),
  egressConnectTimeoutMs: positiveInteger('CONVERSION_EGRESS_CONNECT_TIMEOUT_MS', 5000),
  upstreamBaseUrl: upstreamUrl(),
  redisUrl: required('REDIS_URL'),
  redisPassword: required('REDIS_PASSWORD'),
  ipHashSecret: secret('IP_HASH_SECRET'),
  rateLimit: positiveInteger('CONVERSION_RATE_LIMIT', 10),
  rateWindowSeconds: positiveInteger('CONVERSION_RATE_WINDOW_SECONDS', 60),
  maxRequestBytes: positiveInteger('CONVERSION_MAX_REQUEST_BYTES', 16 * 1024, MAX_REQUEST_BYTES),
  maxResponseBytes: positiveInteger('CONVERSION_MAX_RESPONSE_BYTES', 8 * 1024 * 1024, MAX_RESPONSE_BYTES),
  requestTimeoutMs: positiveInteger('CONVERSION_REQUEST_TIMEOUT_MS', 10_000),
  dnsTimeoutMs: positiveInteger('CONVERSION_DNS_TIMEOUT_MS', 2_000),
  maxConcurrency: positiveInteger('CONVERSION_MAX_CONCURRENCY', 2),
});
