'use strict';

/**
 * Generalize a post's attachments from images-only to mixed MEDIA: a post can now
 * carry images AND/OR videos (Instagram-style). Renames `post_images` → `post_media`
 * and adds:
 *   media_type    — 'image' | 'video' (existing rows default to 'image')
 *   thumbnail_url — video poster (null for images)
 *   duration_ms   — video length (null for images)
 *
 * ALTER TYPE for the enum is created implicitly by addColumn. The rename keeps the
 * old index name (post_images_post_position) — harmless, and renaming it too would
 * be churn for no behavioural gain.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { TEXT, INTEGER, ENUM } = Sequelize;
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.renameTable('post_images', 'post_media', opts);
      // renameTable does NOT rename columns — the PK is still post_image_id.
      await queryInterface.renameColumn('post_media', 'post_image_id', 'post_media_id', opts);
      await queryInterface.addColumn(
        'post_media',
        'media_type',
        { type: ENUM('image', 'video'), allowNull: false, defaultValue: 'image' },
        opts
      );
      await queryInterface.addColumn(
        'post_media',
        'thumbnail_url',
        { type: TEXT, allowNull: true },
        opts
      );
      await queryInterface.addColumn(
        'post_media',
        'duration_ms',
        { type: INTEGER, allowNull: true },
        opts
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.removeColumn('post_media', 'duration_ms', opts);
      await queryInterface.removeColumn('post_media', 'thumbnail_url', opts);
      await queryInterface.removeColumn('post_media', 'media_type', opts);
      await queryInterface.renameColumn('post_media', 'post_media_id', 'post_image_id', opts);
      await queryInterface.renameTable('post_media', 'post_images', opts);
    });
    // Drop the now-orphaned enum type (Postgres leaves it after removeColumn).
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_post_media_media_type";');
  },
};
