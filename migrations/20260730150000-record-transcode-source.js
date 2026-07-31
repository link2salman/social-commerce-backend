'use strict';

/**
 * Records the pre-transcode original on the row that superseded it.
 *
 * ## Why this is needed, and what it prevents
 *
 * `transcodeService` deliberately keeps the source object after a successful
 * encode — it is the only copy of what the user actually shot — but it repoints
 * the row at the new rendition. The original is therefore still in the bucket and
 * referenced by nothing.
 *
 * That made it indistinguishable from a true orphan. The retention sweep
 * (mediaRetentionService) deletes unreferenced objects, so once a clip's original
 * aged past the grace period the sweep would have destroyed it — silently doing
 * the exact irreversible thing the transcode was written to avoid. A production
 * dry run showed 4 unreferenced objects on a 4-clip database: every original.
 *
 * Storing the URL makes the original *referenced*, so the generic column scan sees
 * it and the sweep leaves it alone. Reclaiming originals stays a separate,
 * deliberate decision rather than a side effect of running a cleanup.
 *
 * It is also useful on its own: provenance, and the ability to re-encode from the
 * source rather than from an already-lossy rendition if the ladder changes.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('videos', 'source_url', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('post_media', 'source_url', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('videos', 'source_url');
    await queryInterface.removeColumn('post_media', 'source_url');
  },
};
