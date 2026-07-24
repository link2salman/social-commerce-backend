'use strict';

/**
 * People-search performance. `searchUsers` does `lower(username) LIKE '%q%'`
 * (and the same on display_name) — a leading wildcard that no b-tree can serve,
 * so every search was a sequential scan on `users`. pg_trgm GIN indexes on the
 * lowered columns let Postgres satisfy the substring match from the index.
 *
 * The index expressions match the query's `lower(col)` exactly so the planner
 * can use them. pg_trgm ships with Postgres (and is available on Supabase);
 * CREATE EXTENSION IF NOT EXISTS is idempotent.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
    );
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS users_username_trgm ' +
        'ON users USING gin (lower(username) gin_trgm_ops);'
    );
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS users_display_name_trgm ' +
        'ON users USING gin (lower(display_name) gin_trgm_ops);'
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS users_username_trgm;');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS users_display_name_trgm;');
    // Leave the pg_trgm extension in place — other objects may depend on it.
  },
};
