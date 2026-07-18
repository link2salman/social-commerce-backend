'use strict';

/**
 * Notifications — the persisted counterpart to the FCM pushes the app already
 * receives. Push is transient (missed if the device is off); this table is the
 * durable feed with per-row read state.
 *
 * Polymorphic target (target_type + target_id, no FK) mirrors `reports`: the
 * row records WHAT the notification points at, and the reader resolves it.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, DATE, ENUM } = Sequelize;
    const now = Sequelize.literal('CURRENT_TIMESTAMP');

    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };

      await queryInterface.createTable(
        'notifications',
        {
          notification_id: {
            type: UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          // Whose feed this row belongs to. Their account going away takes the
          // feed with it.
          recipient_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          // The user who caused it. NULLable for two real reasons: a future
          // system/announcement notification has no actor, and a notification
          // must outlive the actor's account rather than vanish from the
          // recipient's history — hence SET NULL, not CASCADE.
          actor_id: {
            type: UUID,
            allowNull: true,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          type: {
            type: ENUM(
              'follow',
              'friend_request',
              'friend_accept',
              'comment',
              'comment_reply'
            ),
            allowNull: false,
          },
          // 'user' → the actor's profile; 'video' → the clip the comment thread
          // lives on. Only what the client can actually open is representable.
          target_type: { type: ENUM('user', 'video'), allowNull: false },
          target_id: { type: UUID, allowNull: false },
          read_at: { type: DATE, allowNull: true },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );

      // The list query: keyset over (created_at DESC, notification_id DESC)
      // scoped to one recipient.
      await queryInterface.addIndex(
        'notifications',
        ['recipient_id', 'created_at', 'notification_id'],
        { name: 'notifications_recipient_keyset', ...opts }
      );

      // The unread badge is polled far more often than the list is read, so it
      // gets a partial index — it stays small no matter how much history piles
      // up, because read rows leave it.
      await queryInterface.sequelize.query(
        'CREATE INDEX notifications_unread ON notifications (recipient_id) WHERE read_at IS NULL;',
        opts
      );

      // "Never notify a user about their own action" enforced in the schema,
      // the same way friend_requests/blocks forbid self-rows. The service also
      // guards it; this makes a future caller that forgets impossible rather
      // than merely unlikely. NULL actor (system) passes: NULL <> x is NULL.
      await queryInterface.sequelize.query(
        'ALTER TABLE notifications ADD CONSTRAINT notifications_no_self CHECK (recipient_id <> actor_id);',
        opts
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.dropTable('notifications', opts);
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_notifications_type";',
        opts
      );
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_notifications_target_type";',
        opts
      );
    });
  },
};
