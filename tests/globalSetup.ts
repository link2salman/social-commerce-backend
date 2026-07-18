// Runs ONCE before the whole suite (jest `globalSetup`).
//
//   1. create the test database if it does not exist yet, then
//   2. apply every migration to it with sequelize-cli.
//
// Migrations are the schema's source of truth in this project (models never
// sync()), so the suite runs against exactly the schema production gets. This
// makes `npm test` self-contained: a clean checkout with a running Postgres
// needs no manual `createdb` / `migrate` step, locally or in CI.
import { execFileSync } from 'child_process';
import path from 'path';
import { Client } from 'pg';
import { loadTestEnv } from './loadEnv';

const REPO_ROOT = path.resolve(__dirname, '..');

interface DbTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
}

// Mirrors src/config/db.ts's resolution order: a full URL wins, otherwise the
// discrete DB_* vars (the local / CI-service default).
const resolveTarget = (): DbTarget => {
  const url = process.env.DATABASE_URL;
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 5432,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, '') || 'postgres',
      ssl: process.env.DB_SSL === 'true',
    };
  }
  return {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'social_commerce_test',
    ssl: process.env.DB_SSL === 'true',
  };
};

const assertTestDatabase = (target: DbTarget): void => {
  // The suite TRUNCATEs every table in `beforeAll`. Refuse to point that at a
  // database whose name doesn't announce itself as a test database.
  if (!/test/i.test(target.database)) {
    throw new Error(
      `[tests] refusing to run: DB_NAME="${target.database}" does not look like a ` +
        'test database (the suite truncates every table). Point DB_NAME/DATABASE_URL ' +
        'at a dedicated *_test database.'
    );
  }
};

const ensureDatabaseExists = async (target: DbTarget): Promise<void> => {
  // Connect to the `postgres` maintenance DB — CREATE DATABASE cannot run from
  // inside the database being created.
  const admin = new Client({
    host: target.host,
    port: target.port,
    user: target.user || undefined,
    password: target.password || undefined,
    database: 'postgres',
    ssl: target.ssl ? { rejectUnauthorized: false } : false,
  });

  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `[tests] cannot reach PostgreSQL at ${target.host}:${target.port} — the ` +
        'integration suite needs a real Postgres (this backend is Postgres-specific). ' +
        `Start one and re-run. Underlying error: ${(err as Error).message}`
    );
  }

  try {
    const { rows } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [target.database]
    );
    if (rows.length === 0) {
      // Identifier cannot be parameterized; the name is validated above and
      // comes from our own env, not from request input.
      await admin.query(`CREATE DATABASE "${target.database.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end();
  }
};

const runMigrations = (): void => {
  const bin = path.join(REPO_ROOT, 'node_modules', '.bin', 'sequelize-cli');
  execFileSync(
    bin,
    [
      'db:migrate',
      '--config',
      'src/config/config.cjs',
      '--migrations-path',
      'migrations',
    ],
    { cwd: REPO_ROOT, env: process.env, stdio: 'pipe' }
  );
};

export default async function globalSetup(): Promise<void> {
  loadTestEnv();
  const target = resolveTarget();
  assertTestDatabase(target);
  await ensureDatabaseExists(target);

  try {
    runMigrations();
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message: string };
    throw new Error(
      `[tests] migrating ${target.database} failed:\n` +
        `${e.stdout?.toString() ?? ''}\n${e.stderr?.toString() ?? e.message}`
    );
  }
}
