'use strict';

/**
 * Phase 3 schema — commerce. Sellers, products (+ variants, images), the
 * shoppable video↔product join, orders and order items. Money is stored as
 * integer minor units (cents); the wire shape converts at serialization.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, TEXT, STRING, INTEGER, DATE, ENUM, REAL } = Sequelize;
    const uuidPk = {
      type: UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: Sequelize.literal('gen_random_uuid()'),
    };
    const now = Sequelize.literal('CURRENT_TIMESTAMP');

    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };

      // ── sellers ────────────────────────────────────────────────────────────
      await queryInterface.createTable(
        'sellers',
        {
          seller_id: uuidPk,
          name: { type: STRING(120), allowNull: false },
          rating: { type: REAL, allowNull: false, defaultValue: 5 },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );

      // ── products ───────────────────────────────────────────────────────────
      await queryInterface.createTable(
        'products',
        {
          product_id: uuidPk,
          seller_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'sellers', key: 'seller_id' },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
          },
          title: { type: STRING(200), allowNull: false },
          description: { type: TEXT, allowNull: false, defaultValue: '' },
          price_cents: { type: INTEGER, allowNull: false },
          currency: { type: STRING(3), allowNull: false, defaultValue: 'USD' },
          stock: { type: INTEGER, allowNull: false, defaultValue: 0 },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
          updated_at: { type: DATE, allowNull: false, defaultValue: now },
          deleted_at: { type: DATE, allowNull: true },
        },
        opts
      );
      await queryInterface.addIndex('products', ['seller_id'], opts);

      // ── product_variants ───────────────────────────────────────────────────
      await queryInterface.createTable(
        'product_variants',
        {
          variant_id: uuidPk,
          product_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'products', key: 'product_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          name: { type: STRING(120), allowNull: false },
          price_delta_cents: {
            type: INTEGER,
            allowNull: false,
            defaultValue: 0,
          },
          position: { type: INTEGER, allowNull: false, defaultValue: 0 },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex('product_variants', ['product_id'], opts);

      // ── product_images ─────────────────────────────────────────────────────
      await queryInterface.createTable(
        'product_images',
        {
          image_id: uuidPk,
          product_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'products', key: 'product_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          url: { type: TEXT, allowNull: false },
          position: { type: INTEGER, allowNull: false, defaultValue: 0 },
        },
        opts
      );
      await queryInterface.addIndex('product_images', ['product_id'], opts);

      // ── video_products (shoppable tags) ────────────────────────────────────
      await queryInterface.createTable(
        'video_products',
        {
          id: uuidPk,
          video_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'videos', key: 'video_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          product_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'products', key: 'product_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          position: { type: INTEGER, allowNull: false, defaultValue: 0 },
        },
        opts
      );
      await queryInterface.addIndex(
        'video_products',
        ['video_id', 'product_id'],
        { unique: true, name: 'video_products_unique', ...opts }
      );

      // ── orders ─────────────────────────────────────────────────────────────
      await queryInterface.createTable(
        'orders',
        {
          order_id: uuidPk,
          user_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          status: {
            type: ENUM('confirmed', 'processing', 'failed'),
            allowNull: false,
            defaultValue: 'confirmed',
          },
          currency: { type: STRING(3), allowNull: false, defaultValue: 'USD' },
          subtotal_cents: { type: INTEGER, allowNull: false },
          shipping_cents: { type: INTEGER, allowNull: false },
          tax_cents: { type: INTEGER, allowNull: false },
          total_cents: { type: INTEGER, allowNull: false },
          payment_token: { type: STRING(255), allowNull: true },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex('orders', ['user_id', 'created_at'], opts);

      // ── order_items ────────────────────────────────────────────────────────
      await queryInterface.createTable(
        'order_items',
        {
          order_item_id: uuidPk,
          order_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'orders', key: 'order_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          // Snapshot fields keep the order immutable if the product later changes.
          product_id: {
            type: UUID,
            allowNull: true,
            references: { model: 'products', key: 'product_id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          variant_id: { type: UUID, allowNull: true },
          title: { type: STRING(200), allowNull: false },
          variant_name: { type: STRING(120), allowNull: true },
          image_url: { type: TEXT, allowNull: false },
          unit_price_cents: { type: INTEGER, allowNull: false },
          quantity: { type: INTEGER, allowNull: false },
          line_total_cents: { type: INTEGER, allowNull: false },
          position: { type: INTEGER, allowNull: false, defaultValue: 0 },
        },
        opts
      );
      await queryInterface.addIndex('order_items', ['order_id'], opts);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.dropTable('order_items', opts);
      await queryInterface.dropTable('orders', opts);
      await queryInterface.dropTable('video_products', opts);
      await queryInterface.dropTable('product_images', opts);
      await queryInterface.dropTable('product_variants', opts);
      await queryInterface.dropTable('products', opts);
      await queryInterface.dropTable('sellers', opts);
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_orders_status";',
        opts
      );
    });
  },
};
