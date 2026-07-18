'use strict';

/**
 * Moderator flag. There is no role/permission system — this backend has exactly
 * two kinds of actor (a user and a moderator), so a boolean is the honest model
 * rather than speculative RBAC. `requireAdmin` middleware gates the /admin
 * surface on it.
 *
 * Additive and safe on populated data: NOT NULL with a default backfills every
 * existing row to false in the same statement.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'is_admin', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'is_admin');
  },
};
