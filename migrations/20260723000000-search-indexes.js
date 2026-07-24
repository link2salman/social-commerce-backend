'use strict';

/**
 * Discovery search indexes. `GET /search` matches products by title/description
 * and videos by caption with case-insensitive substring search
 * (`lower(col) LIKE '%q%'`) — a leading wildcard no b-tree can serve, so each
 * search would sequential-scan without these. pg_trgm GIN indexes on the lowered
 * columns let Postgres satisfy the substring match from the index (same pattern
 * as the people-search indexes in 20260722020000; the extension already exists).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
    );
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS products_title_trgm ' +
        'ON products USING gin (lower(title) gin_trgm_ops);'
    );
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS products_description_trgm ' +
        'ON products USING gin (lower(description) gin_trgm_ops);'
    );
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS videos_caption_trgm ' +
        'ON videos USING gin (lower(caption) gin_trgm_ops);'
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS products_title_trgm;');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS products_description_trgm;');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS videos_caption_trgm;');
  },
};
