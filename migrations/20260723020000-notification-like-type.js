'use strict';

/**
 * Adds a 'like' value to the notification type enum so a like on your video
 * shows up in your notification feed (the highest-frequency re-engagement hook).
 *
 * ALTER TYPE ... ADD VALUE runs OUTSIDE a transaction on purpose — Postgres
 * forbids it inside a transaction block on older versions and a freshly-added
 * value can't be used in the same transaction anyway. IF NOT EXISTS makes it
 * idempotent. Postgres has no DROP VALUE, so `down` is a no-op (an unused enum
 * value is harmless) — documented rather than faked.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_notifications_type" ADD VALUE IF NOT EXISTS 'like';`
    );
  },

  async down() {
    // Postgres cannot remove an enum value; leaving 'like' in place is harmless.
  },
};
