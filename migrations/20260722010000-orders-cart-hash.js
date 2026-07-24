'use strict';

/**
 * Checkout idempotency. A double-tap on "Pay" used to create a second order +
 * PaymentIntent every time. `cart_hash` is the SHA-256 of the canonical cart
 * (sorted productId:variantId:quantity); the order service reuses an existing
 * still-unpaid order with the same hash for the same user instead of minting a
 * duplicate. Nullable because legacy rows predate the column.
 *
 * The composite (user_id, cart_hash) index serves the reuse lookup directly.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('orders', 'cart_hash', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await queryInterface.addIndex('orders', ['user_id', 'cart_hash'], {
      name: 'orders_user_cart_hash',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('orders', 'orders_user_cart_hash');
    await queryInterface.removeColumn('orders', 'cart_hash');
  },
};
