import supertest from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app';

// The app factory exists precisely for this: src/app.ts builds the Express app
// without calling listen() or booting sockets, so supertest can drive the real
// middleware stack (helmet → json → requestLogger → routes → error middleware)
// in-process. `disableRateLimit` turns the limiters into pass-throughs — the
// suite fires far more requests per window than a real client ever would.
let cached: Express | undefined;

export const app = (): Express => {
  cached ??= createApp({ disableRateLimit: true });
  return cached;
};

/** The versioned mount point the mobile client's API_URL ends in. */
export const PREFIX = process.env.API_PREFIX || '/v1';

/** `path('/auth/login')` → `/v1/auth/login`. */
export const path = (suffix: string): string => `${PREFIX}${suffix}`;

export const api = () => supertest(app());
