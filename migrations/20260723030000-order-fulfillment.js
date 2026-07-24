'use strict';

/**
 * Order fulfillment. Adds a shipping address (collected at checkout) and a
 * fulfillment lifecycle a seller drives (unfulfilled → shipped → delivered)
 * with tracking. Tracked SEPARATELY from payment `status`, so the client's
 * payment-derived status enum is untouched — this is purely additive.
 *
 * Address is JSONB + nullable: legacy/free/digital orders may have none, and it
 * is written whole at checkout, never queried by field. NOT NULL-with-default on
 * fulfillment_status backfills existing rows to 'unfulfilled'.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { JSONB, DATE, STRING, ENUM } = Sequelize;
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.addColumn(
        'orders',
        'shipping_address',
        { type: JSONB, allowNull: true },
        { transaction }
      );
      await queryInterface.addColumn(
        'orders',
        'fulfillment_status',
        {
          type: ENUM('unfulfilled', 'shipped', 'delivered'),
          allowNull: false,
          defaultValue: 'unfulfilled',
        },
        { transaction }
      );
      await queryInterface.addColumn(
        'orders',
        'tracking_number',
        { type: STRING(120), allowNull: true },
        { transaction }
      );
      await queryInterface.addColumn(
        'orders',
        'carrier',
        { type: STRING(80), allowNull: true },
        { transaction }
      );
      await queryInterface.addColumn(
        'orders',
        'shipped_at',
        { type: DATE, allowNull: true },
        { transaction }
      );
      await queryInterface.addColumn(
        'orders',
        'delivered_at',
        { type: DATE, allowNull: true },
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.removeColumn('orders', 'delivered_at', { transaction });
      await queryInterface.removeColumn('orders', 'shipped_at', { transaction });
      await queryInterface.removeColumn('orders', 'carrier', { transaction });
      await queryInterface.removeColumn('orders', 'tracking_number', { transaction });
      await queryInterface.removeColumn('orders', 'fulfillment_status', { transaction });
      await queryInterface.removeColumn('orders', 'shipping_address', { transaction });
    });
    // Drop the enum type Sequelize created for the fulfillment_status column.
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_orders_fulfillment_status";'
    );
  },
};
