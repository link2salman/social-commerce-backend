'use strict';

/**
 * `videos.filter_id` — the camera filter the clip was SHOT with ('none',
 * 'vivid', 'warm', 'mono', 'beauty', …).
 *
 * Recorded intent only: nothing on the read path consumes it yet. The app's
 * filters are preview-only (VisionCamera records the unfiltered sensor stream),
 * so the uploaded file has no filter baked in. Persisting the selection is what
 * lets a future transcode/ffmpeg step actually apply it, instead of silently
 * losing which look the creator chose. See services/videoService.ts for the
 * write site and the fuller note.
 *
 * Nullable: every existing row predates the column, and an absent selection is
 * legitimate — null means "no filter recorded".
 *
 * Deliberately a plain VARCHAR, not an ENUM: the app owns the filter list
 * (features/camera/store/cameraStore.ts). An ENUM would make shipping a new
 * filter in the app require a backend migration + deploy.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('videos', 'filter_id', {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('videos', 'filter_id');
  },
};
