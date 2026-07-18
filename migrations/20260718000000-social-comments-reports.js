'use strict';

/**
 * Phase 2 schema — friend requests, blocks, comments (+ replies), comment
 * likes, and reports. Follows/engagements already exist (baseline).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, TEXT, STRING, INTEGER, DATE, ENUM } = Sequelize;
    const uuidPk = {
      type: UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: Sequelize.literal('gen_random_uuid()'),
    };
    const now = Sequelize.literal('CURRENT_TIMESTAMP');
    const userFk = allowNull => ({
      type: UUID,
      allowNull,
      references: { model: 'users', key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });

    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };

      // ── friend_requests ────────────────────────────────────────────────────
      // One row per (requester, addressee). friendStatus is derived from these
      // relative to the viewer: pending+requester=me → outgoing, pending+
      // addressee=me → incoming, accepted → friends.
      await queryInterface.createTable(
        'friend_requests',
        {
          request_id: uuidPk,
          requester_id: userFk(false),
          addressee_id: userFk(false),
          status: {
            type: ENUM('pending', 'accepted'),
            allowNull: false,
            defaultValue: 'pending',
          },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
          updated_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex(
        'friend_requests',
        ['requester_id', 'addressee_id'],
        { unique: true, name: 'friend_requests_pair_unique', ...opts }
      );
      await queryInterface.addIndex(
        'friend_requests',
        ['addressee_id', 'status'],
        opts
      );
      await queryInterface.sequelize.query(
        'ALTER TABLE friend_requests ADD CONSTRAINT friend_requests_no_self CHECK (requester_id <> addressee_id);',
        opts
      );

      // ── blocks ─────────────────────────────────────────────────────────────
      await queryInterface.createTable(
        'blocks',
        {
          block_id: uuidPk,
          blocker_id: userFk(false),
          blocked_id: userFk(false),
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex('blocks', ['blocker_id', 'blocked_id'], {
        unique: true,
        name: 'blocks_pair_unique',
        ...opts,
      });
      await queryInterface.addIndex('blocks', ['blocked_id'], opts);
      await queryInterface.sequelize.query(
        'ALTER TABLE blocks ADD CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id);',
        opts
      );

      // ── comments ───────────────────────────────────────────────────────────
      // One flat table; a reply carries parent_id (a top-level comment's id).
      // Threads are one level deep (enforced in the service).
      await queryInterface.createTable(
        'comments',
        {
          comment_id: uuidPk,
          video_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'videos', key: 'video_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          author_id: userFk(false),
          parent_id: {
            type: UUID,
            allowNull: true,
            references: { model: 'comments', key: 'comment_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          body: { type: TEXT, allowNull: false },
          like_count: { type: INTEGER, allowNull: false, defaultValue: 0 },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex(
        'comments',
        ['video_id', 'parent_id', 'created_at'],
        { name: 'comments_video_thread', ...opts }
      );
      await queryInterface.addIndex('comments', ['parent_id'], opts);

      // ── comment_likes ──────────────────────────────────────────────────────
      await queryInterface.createTable(
        'comment_likes',
        {
          like_id: uuidPk,
          comment_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'comments', key: 'comment_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          user_id: userFk(false),
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex(
        'comment_likes',
        ['comment_id', 'user_id'],
        { unique: true, name: 'comment_likes_unique', ...opts }
      );

      // ── reports ────────────────────────────────────────────────────────────
      // Polymorphic target (video | user | comment); target_id has no FK.
      await queryInterface.createTable(
        'reports',
        {
          report_id: uuidPk,
          reporter_id: userFk(false),
          target_type: {
            type: ENUM('video', 'user', 'comment'),
            allowNull: false,
          },
          target_id: { type: UUID, allowNull: false },
          reason: { type: STRING(120), allowNull: false },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex(
        'reports',
        ['target_type', 'target_id'],
        opts
      );
      await queryInterface.addIndex('reports', ['reporter_id'], opts);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.dropTable('reports', opts);
      await queryInterface.dropTable('comment_likes', opts);
      await queryInterface.dropTable('comments', opts);
      await queryInterface.dropTable('blocks', opts);
      await queryInterface.dropTable('friend_requests', opts);
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_friend_requests_status";',
        opts
      );
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_reports_target_type";',
        opts
      );
    });
  },
};
