import { createClient } from 'redis';
import { loadConfig } from './config.mjs';
import { createRedisIncrement } from './rate-limiter.mjs';
import { createPolicyServer } from './server.mjs';

const config = loadConfig();
const redis = createClient({ url: config.redisUrl, password: config.redisPassword });
redis.on('error', () => {});
await redis.connect();

const server = createPolicyServer({
  config,
  rateStore: { increment: createRedisIncrement(redis) },
});

server.listen(config.port, '0.0.0.0');

const shutdown = async () => {
  server.close();
  if (redis.isOpen) await redis.quit();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
