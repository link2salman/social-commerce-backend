'use strict';

/**
 * Follow-up for DBs that applied an earlier version of 20260725020000 which
 * renamed the table but not its primary-key column (left as post_image_id).
 * Guarded so it's a no-op on fresh DBs where 20260725020000 already renamed it.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'post_media' AND column_name = 'post_image_id'
        ) THEN
          ALTER TABLE post_media RENAME COLUMN post_image_id TO post_media_id;
        END IF;
      END $$;
    `);
  },

  async down() {
    // Reversed by 20260725020000's down; nothing to do here.
  },
};
