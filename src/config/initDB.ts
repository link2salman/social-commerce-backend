// Local-dev database reset — the target of `npm run db:reset`.
//
// Wipes the `public` schema so `npm run migrate` can rebuild it from zero:
//
//   npm run db:reset && npm run migrate && npm run seed
//
// Semantics are the local twin of scripts/db-reset-supabase.sh (which does the
// same thing over the Supabase DIRECT connection with psql):
// DROP SCHEMA public CASCADE → CREATE SCHEMA public → re-grant, all in one
// transaction so a failure mid-way leaves the old schema intact. Dropping the
// schema also drops `SequelizeMeta`, so every migration re-runs from the
// baseline. It deliberately stops there rather than shelling out to
// sequelize-cli: `db:reset` stays composable, and the migrate step keeps using
// the one config (src/config/config.cjs) that already knows about direct-vs-
// pooler connections.
//
// Guards (this is destructive and unrecoverable):
//   1. NODE_ENV=production is refused outright, always.
//   2. A non-local database host is refused unless `--force` is passed — the
//      supported remote path is `npm run db:reset:supabase`.

import { sequelize } from '@config/db';
import { isProduction } from '@utils/env';
import logger from '@utils/logger';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);

const isLocalHost = (host: string): boolean => LOCAL_HOSTS.has(host);

interface ResetTarget {
  host: string;
  database: string;
}

// Read the connection Sequelize actually resolved (URL or discrete DB_* vars),
// so the guard below judges the real target rather than re-parsing env.
const describeTarget = (): ResetTarget => ({
  host: sequelize.config.host ?? '',
  database: sequelize.getDatabaseName(),
});

/**
 * Drop and recreate the `public` schema on the configured database.
 *
 * @param force allow a non-local host (still never allowed in production).
 */
export const resetDatabase = async (force = false): Promise<ResetTarget> => {
  if (isProduction()) {
    throw new Error(
      '[db:reset] refusing to run with NODE_ENV=production. This drops every ' +
        'table in the public schema. For a fresh Supabase project use ' +
        '`npm run db:reset:supabase`.'
    );
  }

  const target = describeTarget();
  if (!isLocalHost(target.host) && !force) {
    throw new Error(
      `[db:reset] refusing to wipe a non-local host (${target.host}). This is ` +
        'the local-dev reset; for a remote database use ' +
        '`npm run db:reset:supabase`, or pass --force if you are certain.'
    );
  }

  await sequelize.authenticate();

  // One transaction: Postgres DDL is transactional, so either the whole schema
  // is swapped or nothing changes.
  await sequelize.transaction(async transaction => {
    await sequelize.query('DROP SCHEMA IF EXISTS public CASCADE;', {
      transaction,
    });
    await sequelize.query('CREATE SCHEMA public;', { transaction });
    await sequelize.query('GRANT ALL ON SCHEMA public TO CURRENT_USER;', {
      transaction,
    });
    await sequelize.query('GRANT USAGE ON SCHEMA public TO public;', {
      transaction,
    });
  });

  return target;
};

// Postgres reports a missing database as SQLSTATE 3D000 — worth translating,
// since the fix (`createdb <name>`) is not obvious from the driver's message.
const missingDatabaseHint = (err: unknown, database: string): string | null => {
  const wrapped = err as {
    parent?: { code?: string };
    original?: { code?: string };
  };
  const code = wrapped?.parent?.code ?? wrapped?.original?.code;
  return code === '3D000'
    ? `database "${database}" does not exist — create it first: createdb ${database}`
    : null;
};

// Only run when executed directly (not when imported by a test).
if (require.main === module) {
  const force = process.argv.includes('--force');
  resetDatabase(force)
    .then(async target => {
      logger.info(
        { host: target.host, database: target.database },
        'database reset — public schema recreated. Next: npm run migrate && npm run seed'
      );
      await sequelize.close();
      process.exit(0);
    })
    .catch(err => {
      const hint = missingDatabaseHint(err, sequelize.getDatabaseName());
      logger.error({ err }, hint ?? 'database reset failed');
      process.exit(1);
    });
}
