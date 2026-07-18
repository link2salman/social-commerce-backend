'use strict';

/**
 * Baseline schema — Phase 0/1: auth (users, user_sessions, revoked_tokens),
 * the follow graph, and the feed (videos, engagements).
 *
 * Migrations are hand-authored (they are the source of truth for the schema;
 * models never sync()). Columns are snake_case; PKs are UUIDs with a DB-side
 * gen_random_uuid() default so raw SQL seeds don't have to supply ids.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, STRING, TEXT, BOOLEAN, INTEGER, DATE, JSONB, ENUM } =
      Sequelize;
    const uuidPk = {
      type: UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: Sequelize.literal('gen_random_uuid()'),
    };
    const now = Sequelize.literal('CURRENT_TIMESTAMP');

    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };

      // ── users ──────────────────────────────────────────────────────────────
      await queryInterface.createTable(
        'users',
        {
          user_id: uuidPk,
          username: { type: STRING(24), allowNull: false },
          email: { type: STRING(255), allowNull: false },
          password_hash: { type: STRING(255), allowNull: true },
          display_name: { type: STRING(80), allowNull: false },
          avatar_url: { type: TEXT, allowNull: true },
          bio: { type: TEXT, allowNull: false, defaultValue: '' },
          is_active: { type: BOOLEAN, allowNull: false, defaultValue: true },
          email_verified: {
            type: BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
          updated_at: { type: DATE, allowNull: false, defaultValue: now },
          deleted_at: { type: DATE, allowNull: true },
        },
        opts
      );
      // Uniqueness scoped to live rows so a soft-deleted account can re-register.
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX users_username_unique_active ON users (username) WHERE deleted_at IS NULL;',
        opts
      );
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX users_email_unique_active ON users (email) WHERE deleted_at IS NULL;',
        opts
      );

      // ── user_sessions ──────────────────────────────────────────────────────
      await queryInterface.createTable(
        'user_sessions',
        {
          session_id: uuidPk,
          user_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          refresh_token_hash: { type: STRING(64), allowNull: false },
          user_agent: { type: TEXT, allowNull: true },
          ip_address: { type: STRING(45), allowNull: true },
          device_type: { type: STRING(50), allowNull: true },
          device_label: { type: STRING(120), allowNull: true },
          device_metadata: {
            type: JSONB,
            allowNull: false,
            defaultValue: {},
          },
          last_used_at: { type: DATE, allowNull: false, defaultValue: now },
          expires_at: { type: DATE, allowNull: false },
          revoked_at: { type: DATE, allowNull: true },
          revoked_reason: { type: STRING(50), allowNull: true },
          rotation_count: { type: INTEGER, allowNull: false, defaultValue: 0 },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
          updated_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex('user_sessions', ['refresh_token_hash'], {
        unique: true,
        name: 'user_sessions_refresh_token_hash_unique',
        ...opts,
      });
      await queryInterface.addIndex('user_sessions', ['user_id'], opts);
      await queryInterface.addIndex('user_sessions', ['expires_at'], opts);
      await queryInterface.addIndex(
        'user_sessions',
        ['user_id', 'revoked_at', 'expires_at'],
        { name: 'user_sessions_user_active', ...opts }
      );

      // ── revoked_tokens ─────────────────────────────────────────────────────
      await queryInterface.createTable(
        'revoked_tokens',
        {
          token_id: uuidPk,
          token_hash: { type: STRING(64), allowNull: false },
          user_id: {
            type: UUID,
            allowNull: true,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          expires_at: { type: DATE, allowNull: false },
          revoked_at: { type: DATE, allowNull: false, defaultValue: now },
          reason: { type: STRING(50), allowNull: true },
        },
        opts
      );
      await queryInterface.addIndex('revoked_tokens', ['token_hash'], {
        unique: true,
        name: 'revoked_tokens_token_hash_unique',
        ...opts,
      });
      await queryInterface.addIndex('revoked_tokens', ['user_id'], opts);
      await queryInterface.addIndex('revoked_tokens', ['expires_at'], opts);

      // ── follows ────────────────────────────────────────────────────────────
      await queryInterface.createTable(
        'follows',
        {
          follow_id: uuidPk,
          follower_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          followee_id: {
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
      await queryInterface.addIndex('follows', ['follower_id', 'followee_id'], {
        unique: true,
        name: 'follows_follower_followee_unique',
        ...opts,
      });
      await queryInterface.addIndex('follows', ['followee_id'], opts);
      await queryInterface.addIndex(
        'follows',
        ['follower_id', 'created_at'],
        opts
      );
      // Guard against self-follow rows at the DB level.
      await queryInterface.sequelize.query(
        'ALTER TABLE follows ADD CONSTRAINT follows_no_self_follow CHECK (follower_id <> followee_id);',
        opts
      );

      // ── videos ─────────────────────────────────────────────────────────────
      await queryInterface.createTable(
        'videos',
        {
          video_id: uuidPk,
          author_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          hls_url: { type: TEXT, allowNull: false },
          thumbnail_url: { type: TEXT, allowNull: false },
          caption: { type: TEXT, allowNull: false, defaultValue: '' },
          duration_ms: { type: INTEGER, allowNull: false },
          sound_name: { type: STRING(160), allowNull: true },
          like_count: { type: INTEGER, allowNull: false, defaultValue: 0 },
          dislike_count: { type: INTEGER, allowNull: false, defaultValue: 0 },
          comment_count: { type: INTEGER, allowNull: false, defaultValue: 0 },
          share_count: { type: INTEGER, allowNull: false, defaultValue: 0 },
          save_count: { type: INTEGER, allowNull: false, defaultValue: 0 },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
          updated_at: { type: DATE, allowNull: false, defaultValue: now },
          deleted_at: { type: DATE, allowNull: true },
        },
        opts
      );
      await queryInterface.addIndex('videos', ['author_id'], opts);
      await queryInterface.addIndex(
        'videos',
        ['created_at', 'video_id'],
        { name: 'videos_feed_keyset', ...opts }
      );

      // ── engagements ────────────────────────────────────────────────────────
      await queryInterface.createTable(
        'engagements',
        {
          engagement_id: uuidPk,
          user_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          video_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'videos', key: 'video_id' },
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
      await queryInterface.addIndex(
        'engagements',
        ['user_id', 'video_id', 'type'],
        {
          unique: true,
          name: 'engagements_user_video_type_unique',
          ...opts,
        }
      );
      await queryInterface.addIndex('engagements', ['video_id', 'type'], opts);
      await queryInterface.addIndex('engagements', ['user_id', 'type'], opts);
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.dropTable('engagements', opts);
      await queryInterface.dropTable('videos', opts);
      await queryInterface.dropTable('follows', opts);
      await queryInterface.dropTable('revoked_tokens', opts);
      await queryInterface.dropTable('user_sessions', opts);
      await queryInterface.dropTable('users', opts);
      // Drop the enum type created for engagements.type.
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_engagements_type";',
        opts
      );
    });
  },
};
