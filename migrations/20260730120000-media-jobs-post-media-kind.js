'use strict';

/**
 * Adds `post_media_transcode` to the media_jobs kind enum.
 *
 * Feed videos have been transcoded since the queue landed, but a video attached
 * to a *post* still kept the raw upload and an unrelated picsum poster. The queue
 * was built to take a second kind; this is that kind. Its `subject_id` is a
 * `post_media.post_media_id` — subject_id is deliberately polymorphic on kind and
 * carries no foreign key, so nothing else has to change.
 *
 * ## Why raw SQL and IF NOT EXISTS
 *
 * Sequelize has no portable "add a value to an existing enum": changeColumn on an
 * ENUM drops and recreates the type, which fails while media_jobs.kind depends on
 * it and would destroy queued rows if it didn't. ADD VALUE is the only
 * non-destructive route. IF NOT EXISTS makes re-running the migration a no-op
 * rather than an error, which matters because the down() below cannot undo it.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      "ALTER TYPE enum_media_jobs_kind ADD VALUE IF NOT EXISTS 'post_media_transcode';"
    );
  },

  /**
   * Deliberately a no-op. PostgreSQL cannot remove a value from an enum — the
   * only route is recreating the type and rewriting every dependent column, which
   * on a rollback would mean destroying any queued or historical post-media jobs
   * to reclaim a label nothing is harmed by. An unused enum value is inert.
   */
  async down() {
    // intentionally empty — see above
  },
};
