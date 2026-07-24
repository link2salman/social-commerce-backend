import fs from 'fs';
import { Sequelize, type Options } from 'sequelize';
import { boolEnv, numberEnv, optionalEnv, required } from '@utils/env';
import logger from '@utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Single shared Sequelize instance. Every model imports `sequelize` from here.
//
// Connection source, in priority order:
//   1. DATABASE_URL — a full Postgres URL. For Supabase use the SESSION-mode
//      pooler URL (port 5432): it speaks the full wire protocol Sequelize needs
//      (advisory locks, prepared statements inside transactions, LISTEN/NOTIFY).
//      The transaction pooler (6543) does not and will break those.
//   2. Discrete DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD — the local
//      / self-hosted dev default (Homebrew Postgres uses trust auth: no password).
//
// TLS: enabled when DB_SSL=true, when a remote URL is used, or in production.
// Point DB_SSL_CA_PATH at the provider CA bundle (Supabase `prod-ca-2021.crt`)
// to get hostname verification. In PRODUCTION a CA is REQUIRED — without it the
// connection would negotiate TLS but skip certificate verification, leaving the
// DB link open to MITM, so we FAIL CLOSED unless DB_SSL_ALLOW_UNVERIFIED=true
// explicitly accepts that risk. In dev we simply skip verification.
// ─────────────────────────────────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === 'production';

interface ConnectionTarget {
  url?: string;
  host: string;
  database: string;
}

const resolveTarget = (): ConnectionTarget => {
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      const parsed = new URL(url);
      return {
        url,
        host: parsed.hostname,
        database: parsed.pathname.replace(/^\//, '') || 'postgres',
      };
    } catch (err) {
      throw new Error(
        `[db] DATABASE_URL is not a valid Postgres URL: ${(err as Error).message}`
      );
    }
  }
  return {
    host: required('DB_HOST'),
    database: required('DB_NAME'),
  };
};

const isLocalHost = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1';

const buildSslOptions = (
  target: ConnectionTarget
): false | Record<string, unknown> => {
  const explicit = process.env.DB_SSL;
  const sslEnabled =
    explicit !== undefined && explicit !== ''
      ? boolEnv('DB_SSL')
      : isProd || (Boolean(target.url) && !isLocalHost(target.host));

  if (!sslEnabled) return false;

  const caPath = process.env.DB_SSL_CA_PATH;
  if (caPath) {
    try {
      const ca = fs.readFileSync(caPath, 'utf8');
      return { require: true, rejectUnauthorized: true, ca };
    } catch (err) {
      // Fail loudly — a misconfigured CA path in prod must never silently
      // downgrade to no-verify TLS.
      throw new Error(
        `[db] DB_SSL_CA_PATH=${caPath} could not be read: ${(err as Error).message}`
      );
    }
  }

  if (isProd && !boolEnv('DB_SSL_ALLOW_UNVERIFIED')) {
    // Fail closed: a production deploy without a verified DB certificate is a
    // MITM exposure, not a warning. Set DB_SSL_CA_PATH to the provider CA
    // bundle, or DB_SSL_ALLOW_UNVERIFIED=true to deliberately accept the risk.
    throw new Error(
      '[db] Refusing to connect in production without TLS certificate ' +
        'verification. Set DB_SSL_CA_PATH to the provider CA bundle (e.g. ' +
        "Supabase's prod-ca-2021.crt), or set DB_SSL_ALLOW_UNVERIFIED=true to " +
        'accept an unverified TLS link.'
    );
  }
  if (isProd) {
    logger.warn(
      '[db] DB_SSL_ALLOW_UNVERIFIED=true — TLS without certificate ' +
        'verification. The DB link is exposed to MITM; set DB_SSL_CA_PATH.'
    );
  }
  return { require: true, rejectUnauthorized: false };
};

const target = resolveTarget();
const sslOptions = buildSslOptions(target);

const commonOptions: Options = {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ...(sslOptions ? { ssl: sslOptions } : {}),
    application_name: optionalEnv('DB_APP_NAME', 'social-commerce-api'),
    keepAlive: true,
  },
  define: {
    // Every table gets snake_case columns + created_at/updated_at by default.
    underscored: true,
  },
  pool: {
    max: numberEnv('DB_POOL_MAX', 10),
    min: 0,
    acquire: 60000,
    idle: 10000,
    evict: 30000,
  },
};

export const sequelize = target.url
  ? new Sequelize(target.url, commonOptions)
  : new Sequelize(
      required('DB_NAME'),
      required('DB_USER'),
      process.env.DB_PASSWORD ?? '',
      {
        ...commonOptions,
        host: required('DB_HOST'),
        port: numberEnv('DB_PORT', 5432),
      }
    );

export const testConnection = async (): Promise<void> => {
  await sequelize.authenticate();
  logger.info(
    { host: target.host, database: target.database },
    'database connection established'
  );
};

export { Sequelize };
