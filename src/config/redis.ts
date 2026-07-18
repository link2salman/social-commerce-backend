import { Redis } from 'ioredis';
import logger from '@utils/logger';

// Redis is OPTIONAL. It is only used to scale horizontally:
//   - the Socket.io Redis adapter (federating rooms across instances), and
//   - future distributed rate limiting.
// With no REDIS_URL the app runs single-instance on in-memory fallbacks — the
// correct default for local dev and small deployments.

let client: Redis | null = null;
let initialized = false;

export const getRedis = (): Redis | null => {
  if (initialized) return client;
  initialized = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('REDIS_URL not set — running with in-memory fallbacks (single instance).');
    return null;
  }

  client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    retryStrategy: times => Math.min(times * 200, 2000),
  });
  client.on('error', err => logger.error({ err }, 'redis error'));
  client.on('connect', () => logger.info('redis connected'));
  return client;
};

export const closeRedis = async (): Promise<void> => {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
  client = null;
  initialized = false;
};
