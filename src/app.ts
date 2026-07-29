// Express application factory. Imported by server.ts (boots the listener +
// sockets) and by integration tests (mounted via supertest, no listener).
// It does NOT call listen(), init sockets, or load env — those are server.ts's
// job / the npm script's job.
import '@models/index'; // side-effect: registers every model association once
import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { optionalEnv } from '@utils/env';
import { apiLimiter, setRateLimitDisabled } from '@middlewares/rateLimiter';
import { checkReadiness } from '@utils/readiness';
import { NotFoundError } from '@middlewares/error';
import errorMiddleware from '@middlewares/error';
import { requestLogger } from '@middlewares/requestLogger';
import apiRouter from '@routes/index';
import { stripeWebhook } from '@controllers/webhookController';

export interface CreateAppOptions {
  disableRateLimit?: boolean;
}

export const createApp = (options: CreateAppOptions = {}): Express => {
  const app = express();
  const prefix = optionalEnv('API_PREFIX', '/v1');

  setRateLimitDisabled(options.disableRateLimit ?? false);

  // Trust the first proxy hop (LB / Cloudflare) so req.ip and rate-limit keys
  // see the real client, not the load balancer.
  app.set('trust proxy', 1);

  // CORS — the native app sends no Origin (always allowed); browser origins must
  // be listed in FRONTEND_URLS.
  const allowed = new Set(
    optionalEnv('FRONTEND_URLS')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );
  app.use(
    cors({
      origin: (origin, cb) =>
        !origin || allowed.has(origin) ? cb(null, true) : cb(null, false),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(helmet({ contentSecurityPolicy: false }));

  // Stripe webhook MUST see the raw request bytes for signature verification, so
  // it is mounted BEFORE the JSON body parser. It's not under apiRouter (which
  // json-parses everything) for the same reason.
  app.post(
    `${prefix}/webhooks/stripe`,
    express.raw({ type: 'application/json' }),
    stripeWebhook
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());
  app.use(requestLogger);

  // Probes — no auth, no rate-limit cost.
  //   /live   liveness  — is the process up? (never touches a dependency)
  //   /health readiness — can it serve? (DB + Redis; 503 when it can't)
  //
  // Deliberately NOT wrapped in the { success, message, data } envelope: these
  // are read by a load balancer / orchestrator, not by the app, and those
  // consumers key off the status code and a flat body. They live outside the
  // versioned /v1 prefix for the same reason.
  app.get('/live', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });
  app.get('/health', async (_req: Request, res: Response) => {
    const report = await checkReadiness();
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });

  // API routes under the versioned prefix the mobile client points at.
  if (!options.disableRateLimit) app.use(prefix, apiLimiter);
  app.use(prefix, apiRouter);

  // Unknown route → 404 through the error middleware, so it carries the same
  // { success: false, message, code } shape as every other failure.
  app.use((req: Request, _res: Response, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.path}`));
  });

  app.use(errorMiddleware);
  return app;
};
