'use strict';

/**
 * `media_jobs` — a Postgres-backed work queue for media post-processing.
 *
 * Why a table and not Redis/BullMQ: the only job this queue has is "transcode a
 * clip", it runs at the rate people publish videos, and Postgres is already a
 * hard dependency. `FOR UPDATE SKIP LOCKED` is the standard, correct way to hand
 * a row to exactly one of N workers, so a table buys durability and retries with
 * no new infrastructure. REDIS_URL is already optional-and-absent here; adding a
 * broker for one job type would be the wrong trade.
 *
 * `subject_id` is polymorphic on `kind` and deliberately has NO foreign key —
 * same shape as `notifications.target_id`. A job whose subject was deleted before
 * the worker got to it fails once, cleanly, and stops (see MAX_ATTEMPTS in
 * mediaJobService); an FK with CASCADE would instead silently drop the audit
 * trail of what was attempted.
 *
 * The partial unique index is what makes `enqueue` idempotent: at most one live
 * (pending or running) job per subject per kind. Re-publishing or a retried
 * request can't queue the same transcode twice, and a finished job doesn't block
 * a future re-run of the same subject.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, ENUM, INTEGER, TEXT, DATE, NOW } = Sequelize;

    await queryInterface.createTable('media_jobs', {
      job_id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      // One value today. An enum rather than free text so a typo'd kind is a
      // write error instead of a job no worker ever claims.
      kind: { type: ENUM('video_transcode'), allowNull: false },
      subject_id: { type: UUID, allowNull: false },
      status: {
        type: ENUM('pending', 'running', 'done', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      attempts: { type: INTEGER, allowNull: false, defaultValue: 0 },
      // Claim gate: a failed attempt pushes this into the future (backoff), so
      // the same poll loop implements both "next job" and "retry later".
      run_after: { type: DATE, allowNull: false, defaultValue: NOW },
      // Set when a worker takes the row; lets a supervisor spot a job orphaned
      // by a hard kill (status still 'running' long after locked_at).
      locked_at: { type: DATE, allowNull: true, defaultValue: null },
      last_error: { type: TEXT, allowNull: true, defaultValue: null },
      created_at: { type: DATE, allowNull: false, defaultValue: NOW },
      updated_at: { type: DATE, allowNull: false, defaultValue: NOW },
    });

    // The claim query's access path: cheapest-first over the runnable set.
    await queryInterface.addIndex('media_jobs', ['status', 'run_after'], {
      name: 'media_jobs_status_run_after',
    });

    // Idempotent enqueue — see the note above.
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX media_jobs_live_subject
        ON media_jobs (kind, subject_id)
        WHERE status IN ('pending', 'running');
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS media_jobs_live_subject;');
    await queryInterface.removeIndex('media_jobs', 'media_jobs_status_run_after');
    await queryInterface.dropTable('media_jobs');
    // Postgres keeps enum types behind after dropTable.
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_media_jobs_kind";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_media_jobs_status";');
  },
};
