// src/config/config.cjs
//
// Sequelize CLI config (consumed by `sequelize-cli db:migrate` and friends).
// Authored as plain CommonJS, NOT TypeScript, on purpose:
//   1. sequelize-cli reads --config with require(); a compiled-from-TS file
//      exports { default: {...} } and the CLI then can't find the top-level
//      environment keys ("Dialect needs to be explicitly supplied").
//   2. It must run without a TS loader on a deploy box.
//
// The RUNTIME connection lives in src/config/db.ts — that is the source of
// truth for pool sizing and SSL at request time. This file only carries what
// the CLI needs to APPLY migrations, and mirrors db.ts's connection logic.
//
// Migrations should target the DIRECT database connection, not a pooler:
//   - Supabase: SUPABASE_DIRECT_URL (host db.<ref>.supabase.co, port 5432).
//   - Otherwise: DATABASE_URL, or the discrete DB_* vars (local dev).
const fs = require('fs');

const isProd = process.env.NODE_ENV === 'production';

const isLocalHost = host =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1';

const buildSsl = url => {
  const explicit = process.env.DB_SSL;
  let sslEnabled;
  if (explicit !== undefined && explicit !== '') {
    sslEnabled = explicit === 'true' || explicit === '1';
  } else if (url) {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      host = '';
    }
    sslEnabled = isProd || !isLocalHost(host);
  } else {
    sslEnabled = isProd;
  }
  if (!sslEnabled) return false;

  const caPath = process.env.DB_SSL_CA_PATH;
  if (caPath) {
    const ca = fs.readFileSync(caPath, 'utf8');
    return { require: true, rejectUnauthorized: true, ca };
  }
  return { require: true, rejectUnauthorized: false };
};

const buildConfig = () => {
  const url =
    process.env.SUPABASE_DIRECT_URL || process.env.DATABASE_URL || null;
  const ssl = buildSsl(url);
  const dialectOptions = ssl ? { ssl } : {};

  if (url) {
    return { url, dialect: 'postgres', dialectOptions };
  }
  return {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD || null,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    dialect: 'postgres',
    dialectOptions,
  };
};

const config = buildConfig();

module.exports = {
  development: config,
  test: config,
  staging: config,
  production: config,
};
