'use strict';

/**
 * Phase 4 schema — messaging. Conversations (1:1 + groups), members with roles,
 * and messages. The conversation row denormalizes last_message_* for an
 * efficient inbox list; per-member last_read_at drives unread counts.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, TEXT, STRING, BOOLEAN, DATE, JSONB, ENUM } = Sequelize;
    const uuidPk = {
      type: UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: Sequelize.literal('gen_random_uuid()'),
    };
    const now = Sequelize.literal('CURRENT_TIMESTAMP');

    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };

      // ── conversations ──────────────────────────────────────────────────────
      await queryInterface.createTable(
        'conversations',
        {
          conversation_id: uuidPk,
          is_group: { type: BOOLEAN, allowNull: false, defaultValue: false },
          title: { type: STRING(120), allowNull: true },
          created_by: {
            type: UUID,
            allowNull: true,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          last_message_body: { type: TEXT, allowNull: true },
          last_sender_id: {
            type: UUID,
            allowNull: true,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          last_message_at: { type: DATE, allowNull: true },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
          updated_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );

      // ── conversation_members ───────────────────────────────────────────────
      await queryInterface.createTable(
        'conversation_members',
        {
          member_id: uuidPk,
          conversation_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'conversations', key: 'conversation_id' },
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
          role: {
            type: ENUM('owner', 'admin', 'member'),
            allowNull: false,
            defaultValue: 'member',
          },
          last_read_at: { type: DATE, allowNull: true },
          joined_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex(
        'conversation_members',
        ['conversation_id', 'user_id'],
        { unique: true, name: 'conversation_members_unique', ...opts }
      );
      await queryInterface.addIndex('conversation_members', ['user_id'], opts);

      // ── messages ───────────────────────────────────────────────────────────
      await queryInterface.createTable(
        'messages',
        {
          message_id: uuidPk,
          conversation_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'conversations', key: 'conversation_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          sender_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          body: { type: TEXT, allowNull: false, defaultValue: '' },
          image_url: { type: TEXT, allowNull: true },
          attachment: { type: JSONB, allowNull: true },
          status: {
            type: ENUM('sent', 'delivered', 'read'),
            allowNull: false,
            defaultValue: 'sent',
          },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
          read_at: { type: DATE, allowNull: true },
        },
        opts
      );
      await queryInterface.addIndex(
        'messages',
        ['conversation_id', 'created_at'],
        opts
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.dropTable('messages', opts);
      await queryInterface.dropTable('conversation_members', opts);
      await queryInterface.dropTable('conversations', opts);
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_conversation_members_role";',
        opts
      );
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_messages_status";',
        opts
      );
    });
  },
};
