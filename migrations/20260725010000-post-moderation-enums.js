'use strict';

/**
 * Extend the polymorphic moderation/notification enums so posts plug in:
 *   reports.target_type        += 'post', 'post_comment'
 *   appeals.target_type        += 'post'
 *   notifications.target_type  += 'post'
 *
 * ALTER TYPE ... ADD VALUE runs OUTSIDE a transaction on purpose (Postgres
 * forbids it inside a transaction block on older versions, and a freshly-added
 * value can't be used in the same transaction anyway). IF NOT EXISTS makes each
 * idempotent. Postgres has no DROP VALUE, so `down` is a documented no-op.
 */
module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;
    await q.query(`ALTER TYPE "enum_reports_target_type" ADD VALUE IF NOT EXISTS 'post';`);
    await q.query(`ALTER TYPE "enum_reports_target_type" ADD VALUE IF NOT EXISTS 'post_comment';`);
    await q.query(`ALTER TYPE "enum_appeals_target_type" ADD VALUE IF NOT EXISTS 'post';`);
    await q.query(`ALTER TYPE "enum_notifications_target_type" ADD VALUE IF NOT EXISTS 'post';`);
  },

  async down() {
    // Postgres cannot remove an enum value; leaving these in place is harmless.
  },
};
