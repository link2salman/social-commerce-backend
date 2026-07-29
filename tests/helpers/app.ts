import http from 'http';
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

// ONE listening server per test file, reused by every request.
//
// Handing supertest the bare Express app makes it bind a fresh ephemeral server
// for EVERY request and close it right after. At this suite's request rate that
// bind/close churn races on macOS and surfaces as transport-level flakes —
// `read ECONNRESET`, `socket hang up`, `Parse Error: Expected HTTP/…` — on
// assertions that are actually fine (~1 run in 5, even for a single file).
// Binding once removes the churn. Jest gives each file its own module registry,
// so this is one listener per file, reaped by `forceExit` (see jest.config.js).
let server: http.Server | undefined;

const testServer = (): http.Server => {
  server ??= http.createServer(app()).listen(0);
  return server;
};

/** The versioned mount point the mobile client's API_URL ends in. */
export const PREFIX = process.env.API_PREFIX || '/v1';

/** `path('/auth/login')` → `/v1/auth/login`. */
export const path = (suffix: string): string => `${PREFIX}${suffix}`;

export const api = () => supertest(testServer());
