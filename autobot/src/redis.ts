import Redis from 'ioredis';
import { CONFIG } from './config';

export const redis = new Redis(CONFIG.redisUrl, {
  maxRetriesPerRequest: 5,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', (error) => {
  console.error('[redis] error', error);
});
