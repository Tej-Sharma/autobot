import { redis } from './redis';

export async function checkRateLimit(
  ip: string,
  limit: number,
  windowSec: number,
): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }> {
  const key = `autobot:ratelimit:try:${ip}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, windowSec);
  }
  const ttl = await redis.ttl(key);
  const remaining = Math.max(0, limit - current);
  return {
    allowed: current <= limit,
    remaining,
    retryAfterSec: ttl > 0 ? ttl : windowSec,
  };
}
