'use strict';

/**
 * Appeals — a user's challenge to a moderation action. The counterpart to
 * `reports`: reports flow user → moderator (flag content), appeals flow the
 * other way (contest a decision). Polymorphic target (target_type + target_id,
 * no FK) mirrors reports/notifications: 'user' → the appellant's suspension,
 * 'video' → their removed clip. Granting an appeal reverses the original action.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, DATE, TEXT, ENUM } = Sequelize;
    const now = Sequelize.literal('CURRENT_TIMESTAMP');

    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };

      await queryInterface.createTable(
        'appeals',
        {
          appeal_id: {
            type: UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          // The appellant. Their account going away takes the appeal with it.
          user_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          target_type: { type: ENUM('user', 'video'), allowNull: false },
          target_id: { type: UUID, allowNull: false },
          reason: { type: TEXT, allowNull: false },
          status: {
            type: ENUM('pending', 'granted', 'denied'),
            allowNull: false,
            defaultValue: 'pending',
          },
          // The moderator who resolved it — SET NULL so the appeal outlives them.
          reviewed_by: {
            type: UUID,
            allowNull: true,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          reviewed_at: { type: DATE, allowNull: true },
          resolution_note: { type: TEXT, allowNull: true },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );

      // A user's own appeal history.
      await queryInterface.addIndex('appeals', ['user_id'], {
        name: 'appeals_user',
        ...opts,
      });
      // The admin queue filters by (target) and by status; a partial index keeps
      // "pending work" cheap, the same shape reports uses.
      await queryInterface.addIndex('appeals', ['target_type', 'target_id'], {
        name: 'appeals_target',
        ...opts,
      });
      await queryInterface.sequelize.query(
        "CREATE INDEX appeals_pending ON appeals (created_at, appeal_id) WHERE status = 'pending';",
        opts
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.dropTable('appeals', opts);
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_appeals_target_type";',
        opts
      );
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_appeals_status";',
        opts
      );
    });
  },
};
