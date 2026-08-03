'use strict';

/**
 * Chat messages now produce notification feed rows (this REVERSES the original
 * "chat creates no rows" decision — see ARCHITECTURE.md § Notifications):
 *   notifications.type        += 'message'
 *   notifications.target_type += 'conversation'
 *
 * ALTER TYPE ... ADD VALUE runs OUTSIDE a transaction on purpose (Postgres
 * forbids it inside a transaction block on older versions, and a freshly-added
 * value can't be used in the same transaction anyway — which is exactly why the
 * index below is a separate statement rather than part of a wrapping
 * transaction). IF NOT EXISTS makes each idempotent. Postgres has no DROP VALUE,
 * so the enum half of `down` is a documented no-op.
 *
 * The partial UNIQUE index is the anti-spam rule made structural: a 50-message
 * thread must leave ONE unread row in the recipient's feed, not 50. It lets
 * `notificationService` upsert with ON CONFLICT — atomic, so two members posting
 * at the same instant still cannot race two rows into existence — and it is
 * scoped to `type = 'message'` because coalescing is deliberately message-only.
 * Every other type still inserts one row per event (two people commenting on the
 * same video are two notifications and must stay two).
 *
 * The predicate is also the release mechanism: setting read_at — by reading the
 * feed, or by opening the thread, which clears this row too — drops the row out
 * of the index, so the next message inserts a fresh one instead of colliding.
 * That is the whole lifecycle.
 */
module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;
    await q.query(`ALTER TYPE "enum_notifications_type" ADD VALUE IF NOT EXISTS 'message';`);
    await q.query(
      `ALTER TYPE "enum_notifications_target_type" ADD VALUE IF NOT EXISTS 'conversation';`
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS notifications_message_unread_unique
         ON notifications (recipient_id, target_type, target_id)
         WHERE type = 'message' AND read_at IS NULL;`
    );
  },

  async down(queryInterface) {
    // Only the index is reversible — Postgres cannot remove an enum value, and
    // leaving 'message'/'conversation' in place is harmless.
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS notifications_message_unread_unique;'
    );
  },
};
