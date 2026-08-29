import { createClient } from 'redis';
import { loadConfig } from './config.mjs';
import { createRedisIncrement } from './rate-limiter.mjs';
import { createPolicyServer } from './server.mjs';
import { createEgressProxy } from './egress-proxy.mjs';

const config = loadConfig();
const redis = createClient({ url: config.redisUrl, password: config.redisPassword });
redis.on('error', () => {});
await redis.connect();

const logger = (entry) => console.log(JSON.stringify(entry));
const server = createPolicyServer({
  config,
  rateStore: { increment: createRedisIncrement(redis) },
  logger,
});
const egressProxy = createEgressProxy({
  dnsTimeoutMs: config.dnsTimeoutMs,
  connectTimeoutMs: config.egressConnectTimeoutMs,
  logger,
});

server.listen(config.port, '0.0.0.0');
egressProxy.listen(config.egressProxyPort, '0.0.0.0');

const shutdown = async () => {
  server.close();
  egressProxy.close();
  if (redis.isOpen) await redis.quit();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
