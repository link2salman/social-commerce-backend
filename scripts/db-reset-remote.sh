#!/usr/bin/env bash
#
# Nuclear-wipe a remote Postgres `public` schema and re-run migrations from
# scratch. Intended for a FRESH database during bring-up.
#
# DESTRUCTIVE: drops every table/type/function in `public`. Never run against a
# database that holds real user data. Uses the DIRECT connection (bypassing any
# connection pooler) because DDL relies on session state.
#
# For the local docker-compose Postgres use `npm run db:reset` instead — same
# semantics, no psql required.
#
# Usage:
#   bash scripts/db-reset-remote.sh [env-file]     # default: .env.production
#
# The env file must define the direct connection as either:
#   DATABASE_DIRECT_URL=postgresql://<user>:<pw>@<direct-host>:5432/<database>
#   (or DATABASE_URL), OR the discrete DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${ROOT}/.env.production}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: env file not found: $ENV_FILE" >&2
  exit 1
fi

# Source only the keys we need, ignoring comments/quotes.
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
  [[ "$key" =~ ^(DATABASE_DIRECT_URL|DATABASE_URL|DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASSWORD)$ ]] || continue
  value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
  export "$key=$value"
done < "$ENV_FILE"

# Prefer an explicit direct URL; otherwise build one from discrete vars.
CONN="${DATABASE_DIRECT_URL:-${DATABASE_URL:-}}"
if [[ -z "$CONN" ]]; then
  : "${DB_HOST:?set DATABASE_DIRECT_URL/DATABASE_URL or DB_HOST in $ENV_FILE}"
  : "${DB_USER:?DB_USER not set}"; : "${DB_NAME:?DB_NAME not set}"
  : "${DB_PORT:=5432}"; : "${DB_PASSWORD:=}"
  export PGPASSWORD="$DB_PASSWORD"
  CONN="host=$DB_HOST port=$DB_PORT user=$DB_USER dbname=$DB_NAME sslmode=require"
fi

echo "==> wiping public schema (atomic) ..."
psql "$CONN" -v ON_ERROR_STOP=1 -c "
  BEGIN;
  DROP SCHEMA public CASCADE;
  CREATE SCHEMA public;
  GRANT ALL ON SCHEMA public TO CURRENT_USER;
  GRANT USAGE ON SCHEMA public TO public;
  COMMIT;
"

echo "==> applying migrations ..."
cd "$ROOT"
npx dotenv -e "$ENV_FILE" -- sequelize-cli db:migrate --config src/config/config.cjs --migrations-path migrations

echo "==> verifying ..."
psql "$CONN" -tA -c "
  SELECT 'tables=' || COUNT(*) FROM pg_tables WHERE schemaname='public'
  UNION ALL SELECT 'migrations=' || COUNT(*) FROM \"SequelizeMeta\";
"
echo "==> done. Run 'npm run seed:prod' to load demo data (optional)."
