// Boot: DB connection → HTTP listener → sockets, with graceful shutdown.
// Aliases are resolved by tsconfig-paths in dev and module-alias in prod
// (see the dev/start npm scripts) — no in-source alias registration needed.
import http from 'http';
import { sequelize, testConnection } from '@config/db';
import { closeRedis } from '@config/redis';
import { closeSocketManager, initSocketManager } from 'socket';
import { numberEnv } from '@utils/env';
import { assertBootConfig } from '@utils/assertBootConfig';
import logger from '@utils/logger';
import { beginShutdown } from '@utils/readiness';
import { createApp } from './app';

// Fail fast on an insecure production config (e.g. a weak/placeholder
// JWT_SECRET) before anything else boots.
assertBootConfig();

const app = createApp();
const server = http.createServer(app);
const PORT = numberEnv('PORT', 5100);

// Realtime layer attaches to the same HTTP server.
initSocketManager(server);

// ── Graceful shutdown ────────────────────────────────────────────────────────
// Ordering matters: sockets never drain on their own, so they must be closed
// before server.close() (whose callback otherwise never fires), then DB, Redis.
const SHUTDOWN_BACKSTOP_MS = 20_000;
let shuttingDown = false;

const closeHttp = (): Promise<void> =>
  new Promise(resolve => {
    if (!server.listening) return resolve();
    server.close(err => {
      if (err) logger.error({ err }, 'error closing HTTP server');
      resolve();
    });
  });

const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn({ signal }, 'shutting down gracefully');
  beginShutdown(); // /health starts reporting 503 immediately

  const backstop = setTimeout(() => {
    logger.fatal('graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_BACKSTOP_MS);
  backstop.unref();

  try {
    await closeSocketManager();
  } catch (err) {
    logger.error({ err }, 'error closing sockets');
  }
  try {
    await closeHttp();
  } catch (err) {
    logger.error({ err }, 'error closing HTTP server');
  }
  try {
    await sequelize.close();
  } catch (err) {
    logger.error({ err }, 'error closing DB');
  }
  try {
    await closeRedis();
  } catch (err) {
    logger.error({ err }, 'error closing Redis');
  }

  clearTimeout(backstop);
  logger.info({ signal }, 'shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

const start = async (): Promise<void> => {
  try {
    await testConnection();
    server.listen(PORT, () => {
      logger.info(
        { port: PORT, env: process.env.NODE_ENV ?? 'development' },
        'server listening'
      );
    });
  } catch (err) {
    logger.error({ err }, 'failed to start server');
    process.exit(1);
  }
};

void start();
