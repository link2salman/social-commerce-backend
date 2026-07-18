import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

// Tests fire many requests in tight loops; the app factory flips this so the
// limiter becomes a pass-through rather than asserting against a 429.
let disabled = false;
export const setRateLimitDisabled = (value: boolean): void => {
  disabled = value;
};

const make = (windowMs: number, limit: number): RateLimitRequestHandler =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => disabled,
    message: { message: 'Too many requests, please try again later.' },
  });

// Auth endpoints are credential-adjacent — a tighter budget. Refresh is
// exempted at mount time (it's background traffic, ~4/hour per signed-in app).
export const authLimiter = make(15 * 60 * 1000, 40);

// General API budget. Generous — a browsing session on a mobile network bursts.
export const apiLimiter = make(60 * 1000, 300);
