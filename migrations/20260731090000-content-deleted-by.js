'use strict';

/**
 * Records WHO removed a soft-deleted video or post.
 *
 * ## The bug this exists to prevent
 *
 * Until now `deleted_at` was set by exactly one code path — a moderator choosing
 * `remove_content` — so "soft-deleted" and "removed by moderation" were the same
 * fact, and `appealService` could treat them as interchangeable: it accepts an
 * appeal for any soft-deleted row the appellant authored.
 *
 * Letting authors delete their own content breaks that equivalence. Without this
 * column a user could delete their own video and then immediately appeal its
 * "removal", and the moderation queue would fill with appeals against actions no
 * moderator ever took — each one unresolvable, because there is no decision to
 * review. The queue is a shared resource; anyone could flood it on demand.
 *
 * So the distinction has to live in the data, not in a convention about which
 * code path ran. `appealService` gates on `deleted_by = 'moderator'`.
 *
 * ## Why existing rows backfill to 'moderator'
 *
 * Before this migration, moderation was the ONLY writer of `deleted_at`, so every
 * currently soft-deleted row is by definition a moderator removal. Backfilling
 * preserves the appeal rights of anyone whose content was taken down before the
 * column existed — defaulting them to 'author' would silently revoke the ability
 * to contest a removal they never made.
 *
 * Left nullable rather than defaulted: NULL means "not deleted", which keeps the
 * column honest for live rows instead of asserting an actor for a deletion that
 * never happened.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of ['videos', 'posts']) {
      await queryInterface.addColumn(table, 'deleted_by', {
        type: Sequelize.ENUM('author', 'moderator'),
        allowNull: true,
        defaultValue: null,
      });
      // Every pre-existing soft delete came from moderation; keep those appealable.
      await queryInterface.sequelize.query(
        `UPDATE ${table} SET deleted_by = 'moderator' WHERE deleted_at IS NOT NULL`
      );
    }
  },

  async down(queryInterface) {
    for (const table of ['videos', 'posts']) {
      await queryInterface.removeColumn(table, 'deleted_by');
      // Postgres keeps the enum type behind after the column goes.
      await queryInterface.sequelize.query(
        `DROP TYPE IF EXISTS "enum_${table}_deleted_by"`
      );
    }
  },
};
