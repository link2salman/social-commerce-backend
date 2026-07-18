// Loads .env.test into process.env for the integration suite.
//
// The app deliberately has no dotenv.config() call (see src/utils/env.ts) — env
// is supplied per-environment by dotenv-cli in the npm scripts. Jest has no such
// wrapper, so this runs as a `setupFiles` entry: before the test framework, and
// crucially before any module imports @config/db, which reads DB_HOST at import
// time and throws if it is missing.
//
// dotenv does NOT overwrite variables already present in process.env, so CI can
// export DB_HOST/DB_USER/... for its `postgres` service container and those win
// over the local-developer defaults in the committed .env.test.
import path from 'path';
import dotenv from 'dotenv';

export const ENV_FILE = path.resolve(__dirname, '..', '.env.test');

export const loadTestEnv = (): void => {
  dotenv.config({ path: ENV_FILE });
  // NODE_ENV must be 'test' regardless of what the shell had — it selects the
  // sequelize-cli config key and flips utils/env.isTest().
  process.env.NODE_ENV = 'test';
};

loadTestEnv();
