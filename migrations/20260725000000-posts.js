'use strict';

/**
 * Posts — the image/text content type (Instagram/Twitter-style), a parallel
 * stack to videos so the tested video pipeline is untouched. Creates:
 *   posts               — the content row (paranoid soft-delete, denormalized counters)
 *   post_images         — ordered carousel images (media already in storage)
 *   post_engagements    — like/dislike/save/bookmark/favorite (mirror of engagements)
 *   post_comments       — comments + one-level replies (mirror of comments)
 *   post_comment_likes  — per-user comment likes (mirror of comment_likes)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, TEXT, INTEGER, DATE, ENUM } = Sequelize;
    const now = Sequelize.literal('CURRENT_TIMESTAMP');
    const genId = Sequelize.literal('gen_random_uuid()');
    const counter = () => ({ type: INTEGER, allowNull: false, defaultValue: 0 });

    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };

      // ── posts ────────────────────────────────────────────────────────────
      await queryInterface.createTable(
        'posts',
        {
          post_id: { type: UUID, primaryKey: true, allowNull: false, defaultValue: genId },
          author_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          body: { type: TEXT, allowNull: false, defaultValue: '' },
          like_count: counter(),
          dislike_count: counter(),
          comment_count: counter(),
          share_count: counter(),
          save_count: counter(),
          created_at: { type: DATE, allowNull: false, defaultValue: now },
          updated_at: { type: DATE, allowNull: false, defaultValue: now },
          deleted_at: { type: DATE, allowNull: true, defaultValue: null },
        },
        opts
      );
      await queryInterface.addIndex('posts', ['author_id'], {
        name: 'posts_author',
        ...opts,
      });
      await queryInterface.addIndex('posts', ['created_at', 'post_id'], {
        name: 'posts_keyset',
        ...opts,
      });

      // ── post_images ──────────────────────────────────────────────────────
      await queryInterface.createTable(
        'post_images',
        {
          post_image_id: { type: UUID, primaryKey: true, allowNull: false, defaultValue: genId },
          post_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'posts', key: 'post_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          url: { type: TEXT, allowNull: false },
          position: { type: INTEGER, allowNull: false, defaultValue: 0 },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex('post_images', ['post_id', 'position'], {
        name: 'post_images_post_position',
        ...opts,
      });

      // ── post_engagements ─────────────────────────────────────────────────
      await queryInterface.createTable(
        'post_engagements',
        {
          post_engagement_id: { type: UUID, primaryKey: true, allowNull: false, defaultValue: genId },
          user_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          post_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'posts', key: 'post_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          type: {
            type: ENUM('like', 'dislike', 'save', 'bookmark', 'favorite'),
            allowNull: false,
          },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex('post_engagements', ['user_id', 'post_id', 'type'], {
        unique: true,
        name: 'post_engagements_user_post_type_unique',
        ...opts,
      });
      await queryInterface.addIndex('post_engagements', ['post_id', 'type'], {
        name: 'post_engagements_post_type',
        ...opts,
      });
      await queryInterface.addIndex('post_engagements', ['user_id', 'type'], {
        name: 'post_engagements_user_type',
        ...opts,
      });

      // ── post_comments ────────────────────────────────────────────────────
      await queryInterface.createTable(
        'post_comments',
        {
          post_comment_id: { type: UUID, primaryKey: true, allowNull: false, defaultValue: genId },
          post_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'posts', key: 'post_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          author_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          parent_id: {
            type: UUID,
            allowNull: true,
            references: { model: 'post_comments', key: 'post_comment_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          body: { type: TEXT, allowNull: false },
          like_count: counter(),
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex('post_comments', ['post_id', 'parent_id', 'created_at'], {
        name: 'post_comments_post_parent_created',
        ...opts,
      });
      await queryInterface.addIndex('post_comments', ['parent_id'], {
        name: 'post_comments_parent',
        ...opts,
      });

      // ── post_comment_likes ───────────────────────────────────────────────
      await queryInterface.createTable(
        'post_comment_likes',
        {
          post_comment_like_id: { type: UUID, primaryKey: true, allowNull: false, defaultValue: genId },
          post_comment_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'post_comments', key: 'post_comment_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          user_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex('post_comment_likes', ['post_comment_id', 'user_id'], {
        unique: true,
        name: 'post_comment_likes_comment_user_unique',
        ...opts,
      });
    });
  },

  async down(queryInterface) {
    // Drop children before parents (FK order). Sequelize drops the ENUM type
    // with the table when it's the only user.
    await queryInterface.dropTable('post_comment_likes');
    await queryInterface.dropTable('post_comments');
    await queryInterface.dropTable('post_engagements');
    await queryInterface.dropTable('post_images');
    await queryInterface.dropTable('posts');
  },
};
