'use strict';

/**
 * Multi-seller supply side. Until now `sellers` were platform-owned catalog rows
 * with no link to an account; this links a seller to the user who runs the shop,
 * so a user can register as a seller and CRUD their own products.
 *
 * Nullable + unique: existing seed sellers stay platform-owned (`user_id` null);
 * a user has at most one seller profile. ON DELETE SET NULL keeps a shop's
 * products and order history intact if the owning account is ever removed (the
 * shop becomes platform-owned rather than cascading a delete through orders).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sellers', 'user_id', {
      type: Sequelize.UUID,
      allowNull: true,
      unique: true,
      references: { model: 'users', key: 'user_id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
    await queryInterface.addIndex('sellers', ['user_id'], {
      name: 'sellers_user_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('sellers', 'sellers_user_id');
    await queryInterface.removeColumn('sellers', 'user_id');
  },
};
