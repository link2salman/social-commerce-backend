import { sequelize } from '@config/db';
import { NotFoundError } from '@middlewares/error';
import Post, { type PostAttributes } from '@models/feed/Post';
import PostEngagement from '@models/feed/PostEngagement';
import { createNotification } from '@services/notificationService';
import type { EngagementType } from '@constants/enums';

// Which engagement types maintain a denormalized counter on the post row.
// Bookmark / favorite are private viewer flags with no public count (same as
// videos — see engagementService).
const COUNTER_COLUMN: Partial<Record<EngagementType, keyof PostAttributes>> = {
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
 * Toggle a post engagement (POST = on, DELETE = off). Keeps the post's
 * denormalized counters coherent in the same transaction, and enforces
 * like/dislike mutual exclusion — a byte-for-byte mirror of toggleEngagement
 * (engagementService.ts) on the post tables.
 */
export const togglePostEngagement = async (
  userId: string,
  postId: string,
  type: EngagementType,
  on: boolean
): Promise<void> => {
  const post = await Post.findByPk(postId);
  if (!post) throw new NotFoundError('Post');

  let likeCreated = false;
  await sequelize.transaction(async transaction => {
    if (on) {
      const opposite = OPPOSITE[type];
      if (opposite) {
        const removed = await PostEngagement.destroy({
          where: { user_id: userId, post_id: postId, type: opposite },
          transaction,
        });
        const oppCol = COUNTER_COLUMN[opposite];
        if (removed > 0 && oppCol) {
          await post.decrement(oppCol, { by: removed, transaction });
        }
      }
      const [, created] = await PostEngagement.findOrCreate({
        where: { user_id: userId, post_id: postId, type },
        defaults: { user_id: userId, post_id: postId, type },
        transaction,
      });
      const col = COUNTER_COLUMN[type];
      if (created && col) {
        await post.increment(col, { by: 1, transaction });
      }
      if (created && type === 'like') likeCreated = true;
    } else {
      const removed = await PostEngagement.destroy({
        where: { user_id: userId, post_id: postId, type },
        transaction,
      });
      const col = COUNTER_COLUMN[type];
      if (removed > 0 && col) {
        await post.decrement(col, { by: removed, transaction });
      }
    }
  });

  // A durable feed row on a NEW like (no push — likes are high-frequency).
  // createNotification skips the self-like case. The target is the POST, which
  // has a standalone detail screen the app can open.
  if (likeCreated) {
    await createNotification({
      recipientId: post.author_id,
      actorId: userId,
      type: 'like',
      targetType: 'post',
      targetId: postId,
    });
  }
};
