'use strict';

/**
 * Phase 6 schema — push notifications. One row per device push token (FCM
 * registration token). Unique per token; a device re-registering upserts.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, TEXT, DATE, ENUM } = Sequelize;
    await queryInterface.createTable('device_tokens', {
      id: {
        type: UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      user_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'users', key: 'user_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      token: { type: TEXT, allowNull: false, unique: true },
      platform: { type: ENUM('ios', 'android'), allowNull: false },
      created_at: {
        type: DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex('device_tokens', ['user_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('device_tokens');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_device_tokens_platform";'
    );
  },
};
