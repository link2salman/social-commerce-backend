import type { NextFunction, Request, Response } from 'express';
import logger from '@utils/logger';

// Lightweight access log: one line per request on completion, with latency and
// the authenticated user (if any). Debug level so it's on in dev, quiet in prod
// unless LOG_LEVEL is lowered. Probes (/live, /health) are skipped to avoid
// drowning the log under load-balancer health checks.
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.path === '/live' || req.path === '/health') return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.debug(
      {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Math.round(ms),
        userId: req.user?.user_id,
      },
      `${req.method} ${req.originalUrl} ${res.statusCode}`
    );
  });
  next();
};
