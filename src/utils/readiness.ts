import { sequelize } from '@config/db';
import { getRedis } from '@config/redis';
import logger from '@utils/logger';

// Two distinct questions (see app.ts):
//   /live   — is the process up? (never touches a dependency)
//   /health — can it actually serve? (checks DB + Redis, 503 when it can't)
let shuttingDown = false;
export const beginShutdown = (): void => {
  shuttingDown = true;
};

export interface ReadinessReport {
  status: 'ok' | 'degraded' | 'shutting_down';
  checks: Record<string, 'ok' | 'error' | 'skipped'>;
  timestamp: string;
}

export const checkReadiness = async (): Promise<ReadinessReport> => {
  const checks: ReadinessReport['checks'] = {};

  try {
    await sequelize.query('SELECT 1');
    checks.database = 'ok';
  } catch (err) {
    logger.error({ err }, 'readiness: database check failed');
    checks.database = 'error';
  }

  const redis = getRedis();
  if (!redis) {
    checks.redis = 'skipped';
  } else {
    try {
      await redis.ping();
      checks.redis = 'ok';
    } catch (err) {
      logger.error({ err }, 'readiness: redis check failed');
      checks.redis = 'error';
    }
  }

  const dbOk = checks.database === 'ok';
  const status: ReadinessReport['status'] = shuttingDown
    ? 'shutting_down'
    : dbOk
      ? 'ok'
      : 'degraded';

  return { status, checks, timestamp: new Date().toISOString() };
};
