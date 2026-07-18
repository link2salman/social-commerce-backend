import { Op, fn, col } from 'sequelize';
import { sequelize } from '@config/db';
import { NotFoundError } from '@middlewares/error';
import Video from '@models/feed/Video';
import User from '@models/user/User';
import Comment, { type CommentModel } from '@models/feed/Comment';
import CommentLike from '@models/feed/CommentLike';
import { createNotification } from '@services/notificationService';
import {
  serializeComment,
  type CommentJSON,
} from '@serializers/commentSerializer';

// Batch-hydrate comments: authors, reply counts (top-level only), and the
// viewer's like state — a fixed number of queries regardless of page size.
const hydrateComments = async (
  comments: CommentModel[],
  viewerId: string
): Promise<CommentJSON[]> => {
  if (comments.length === 0) return [];
  const ids = comments.map(c => c.comment_id);
  const authorIds = [...new Set(comments.map(c => c.author_id))];

  const [authors, replyCounts, likedRows] = await Promise.all([
    User.findAll({
      where: { user_id: { [Op.in]: authorIds } },
      attributes: ['user_id', 'username', 'avatar_url'],
    }),
    Comment.findAll({
      where: { parent_id: { [Op.in]: ids } },
      attributes: ['parent_id', [fn('COUNT', col('comment_id')), 'count']],
      group: ['parent_id'],
      raw: true,
    }) as unknown as Promise<Array<{ parent_id: string; count: string }>>,
    CommentLike.findAll({
      where: { user_id: viewerId, comment_id: { [Op.in]: ids } },
      attributes: ['comment_id'],
    }),
  ]);

  const authorById = new Map(authors.map(a => [a.user_id, a]));
  const replyCountByParent = new Map(
    replyCounts.map(r => [r.parent_id, Number(r.count)])
  );
  const likedSet = new Set(likedRows.map(r => r.comment_id));

  return comments.map(c =>
    serializeComment(c, {
      author: authorById.get(c.author_id) ?? {
        user_id: c.author_id,
        username: 'unknown',
        avatar_url: null,
      },
      replyCount: replyCountByParent.get(c.comment_id) ?? 0,
      hasLiked: likedSet.has(c.comment_id),
    })
  );
};

// Top-level comments for a video, newest thread first (mirrors the mock).
export const listTopLevel = async (
  videoId: string,
  viewerId: string
): Promise<CommentJSON[]> => {
  const comments = await Comment.findAll({
    where: { video_id: videoId, parent_id: null },
    order: [
      ['created_at', 'DESC'],
      ['comment_id', 'DESC'],
    ],
    limit: 100,
  });
  return hydrateComments(comments, viewerId);
};

// A thread's replies, oldest first (chronological), like the mock.
export const listReplies = async (
  commentId: string,
  viewerId: string
): Promise<CommentJSON[]> => {
  const replies = await Comment.findAll({
    where: { parent_id: commentId },
    order: [
      ['created_at', 'ASC'],
      ['comment_id', 'ASC'],
    ],
    limit: 200,
  });
  return hydrateComments(replies, viewerId);
};

// Post a comment or reply. Threads are one level deep: if the target parent is
// itself a reply, the new comment lands under that reply's parent (TikTok's
// flat model). Keeps the video's comment_count coherent.
export const postComment = async (
  videoId: string,
  authorId: string,
  body: string,
  parentId: string | null
): Promise<CommentJSON> => {
  const video = await Video.findByPk(videoId);
  if (!video) throw new NotFoundError('Video');

  let resolvedParentId: string | null = null;
  // Who to notify: the replied-to comment's author for a reply, else the video
  // author. createNotification skips the self case (replying to your own
  // comment / commenting on your own video), so no guard is needed here.
  let notifyRecipientId = video.author_id;
  let notifyType: 'comment' | 'comment_reply' = 'comment';
  if (parentId) {
    const parent = await Comment.findByPk(parentId);
    if (!parent || parent.video_id !== videoId) {
      throw new NotFoundError('Comment');
    }
    resolvedParentId = parent.parent_id ?? parent.comment_id;
    notifyRecipientId = parent.author_id;
    notifyType = 'comment_reply';
  }

  const comment = await sequelize.transaction(async transaction => {
    const created = await Comment.create(
      {
        video_id: videoId,
        author_id: authorId,
        parent_id: resolvedParentId,
        body,
      },
      { transaction }
    );
    await video.increment('comment_count', { by: 1, transaction });
    return created;
  });

  // A comment thread lives on its video (the app has no standalone comment
  // screen), so both kinds target the video.
  await createNotification({
    recipientId: notifyRecipientId,
    actorId: authorId,
    type: notifyType,
    targetType: 'video',
    targetId: videoId,
  });

  const [hydrated] = await hydrateComments([comment], authorId);
  return hydrated!;
};

// Toggle a comment like (POST = liked, DELETE = unliked). Keeps like_count coherent.
export const toggleCommentLike = async (
  commentId: string,
  userId: string,
  on: boolean
): Promise<void> => {
  const comment = await Comment.findByPk(commentId);
  if (!comment) throw new NotFoundError('Comment');

  await sequelize.transaction(async transaction => {
    if (on) {
      const [, created] = await CommentLike.findOrCreate({
        where: { comment_id: commentId, user_id: userId },
        defaults: { comment_id: commentId, user_id: userId },
        transaction,
      });
      if (created) await comment.increment('like_count', { by: 1, transaction });
    } else {
      const removed = await CommentLike.destroy({
        where: { comment_id: commentId, user_id: userId },
        transaction,
      });
      if (removed > 0) {
        await comment.decrement('like_count', { by: removed, transaction });
      }
    }
  });
};
