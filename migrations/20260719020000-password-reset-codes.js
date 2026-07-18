'use strict';

/**
 * Phase 6 schema — password reset. One row per issued reset code (SHA-256 hash
 * only). Short-lived, single-use.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, STRING, DATE } = Sequelize;
    await queryInterface.createTable('password_reset_codes', {
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
      code_hash: { type: STRING(64), allowNull: false },
      expires_at: { type: DATE, allowNull: false },
      used_at: { type: DATE, allowNull: true },
      created_at: {
        type: DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex('password_reset_codes', ['user_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('password_reset_codes');
  },
};
