import { sequelize } from '@config/db';
import { NotFoundError } from '@middlewares/error';
import Video, { type VideoAttributes } from '@models/feed/Video';
import Engagement from '@models/feed/Engagement';
import type { EngagementType } from '@constants/enums';

// Which engagement types maintain a denormalized counter on the video row.
// Bookmark / favorite are private viewer flags with no public count.
const COUNTER_COLUMN: Partial<Record<EngagementType, keyof VideoAttributes>> = {
  like: 'like_count',
  dislike: 'dislike_count',
  save: 'save_count',
};

// Like and dislike are mutually exclusive.
const OPPOSITE: Partial<Record<EngagementType, EngagementType>> = {
  like: 'dislike',
  dislike: 'like',
};

/**
 * Toggle an engagement (POST = on, DELETE = off). Keeps the video's
 * denormalized counters coherent in the same transaction, and enforces
 * like/dislike mutual exclusion — mirroring the client's optimistic logic so a
 * refetch always agrees.
 */
export const toggleEngagement = async (
  userId: string,
  videoId: string,
  type: EngagementType,
  on: boolean
): Promise<void> => {
  const video = await Video.findByPk(videoId);
  if (!video) throw new NotFoundError('Video');

  await sequelize.transaction(async transaction => {
    if (on) {
      // Remove the opposite reaction first (like ⇄ dislike).
      const opposite = OPPOSITE[type];
      if (opposite) {
        const removed = await Engagement.destroy({
          where: { user_id: userId, video_id: videoId, type: opposite },
          transaction,
        });
        const oppCol = COUNTER_COLUMN[opposite];
        if (removed > 0 && oppCol) {
          await video.decrement(oppCol, { by: removed, transaction });
        }
      }
      const [, created] = await Engagement.findOrCreate({
        where: { user_id: userId, video_id: videoId, type },
        defaults: { user_id: userId, video_id: videoId, type },
        transaction,
      });
      const col = COUNTER_COLUMN[type];
      if (created && col) {
        await video.increment(col, { by: 1, transaction });
      }
    } else {
      const removed = await Engagement.destroy({
        where: { user_id: userId, video_id: videoId, type },
        transaction,
      });
      const col = COUNTER_COLUMN[type];
      if (removed > 0 && col) {
        await video.decrement(col, { by: removed, transaction });
      }
    }
  });
};
