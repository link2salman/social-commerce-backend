import rateLimit, {
  type RateLimitRequestHandler,
  type Store,
} from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis } from '@config/redis';
import { TooManyRequestsError } from '@middlewares/error';
import logger from '@utils/logger';

// Tests fire many requests in tight loops; the app factory flips this so the
// limiter becomes a pass-through rather than asserting against a 429.
let disabled = false;
export const setRateLimitDisabled = (value: boolean): void => {
  disabled = value;
};

// With REDIS_URL set, limits are shared across replicas (correct behind a load
// balancer); otherwise the store is per-instance in-memory (undefined → the
// library's default MemoryStore).
const buildStore = (): Store | undefined => {
  const redis = getRedis();
  if (!redis) return undefined;
  logger.info('rate-limit: using Redis store (shared across instances)');
  return new RedisStore({
    // ioredis exposes call(command, ...args); cast bridges the variadic signature
    // and its reply type to what rate-limit-redis expects.
    sendCommand: ((...args: string[]) =>
      (redis.call as (...a: string[]) => Promise<unknown>)(...args)) as never,
  });
};

const make = (windowMs: number, limit: number): RateLimitRequestHandler =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => disabled,
    store: buildStore(),
    // Hand the rejection to the error middleware instead of letting the library
    // write its own body. That is what keeps a 429 inside the standard envelope
    // ({ success, message, code }) with a RATE_LIMITED code and a Retry-After
    // derived from the real window reset — the app renders it as a countdown.
    handler: (req, _res, next) => {
      // express-rate-limit attaches `req.rateLimit` at runtime but only
      // augments Express's Request type via its own AugmentedRequest, which the
      // handler signature does not use — hence the narrow local cast.
      const { resetTime } =
        (req as unknown as { rateLimit?: { resetTime?: Date } }).rateLimit ?? {};
      const retryAfter = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);
      next(
        new TooManyRequestsError(
          'Too many requests, please try again later.',
          retryAfter
        )
      );
    },
  });

// Auth endpoints are credential-adjacent — a tighter budget. Refresh is
// exempted at mount time (it's background traffic, ~4/hour per signed-in app).
export const authLimiter = make(15 * 60 * 1000, 40);

// General API budget. Generous — a browsing session on a mobile network bursts.
export const apiLimiter = make(60 * 1000, 300);
