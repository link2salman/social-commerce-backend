'use strict';

/**
 * Phase 6 schema — real payments (Stripe).
 *
 * Orders and paid event tickets now carry a payment lifecycle. `orders.status`
 * stays the 3-value wire enum the client validates; the new `payment_status`
 * ENUM is the internal Stripe-mirrored lifecycle that DRIVES it. A PaymentIntent
 * id links our row to Stripe for confirm + webhook reconciliation.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, DATE, ENUM } = Sequelize;

    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };

      // ── orders: payment lifecycle ────────────────────────────────────────────
      await queryInterface.addColumn(
        'orders',
        'payment_status',
        {
          type: ENUM(
            'requires_payment',
            'processing',
            'succeeded',
            'failed',
            'refunded'
          ),
          allowNull: false,
          defaultValue: 'requires_payment',
        },
        opts
      );
      await queryInterface.addColumn(
        'orders',
        'payment_intent_id',
        { type: STRING(255), allowNull: true, unique: true },
        opts
      );
      await queryInterface.addColumn(
        'orders',
        'refunded_at',
        { type: DATE, allowNull: true },
        opts
      );
      await queryInterface.addIndex('orders', ['payment_intent_id'], {
        name: 'orders_payment_intent_id',
        ...opts,
      });

      // ── event_attendees: link a paid ticket to its PaymentIntent ─────────────
      await queryInterface.addColumn(
        'event_attendees',
        'payment_intent_id',
        { type: STRING(255), allowNull: true },
        opts
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.removeColumn(
        'event_attendees',
        'payment_intent_id',
        opts
      );
      await queryInterface.removeIndex(
        'orders',
        'orders_payment_intent_id',
        opts
      );
      await queryInterface.removeColumn('orders', 'refunded_at', opts);
      await queryInterface.removeColumn('orders', 'payment_intent_id', opts);
      await queryInterface.removeColumn('orders', 'payment_status', opts);
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_orders_payment_status";',
        opts
      );
    });
  },
};
