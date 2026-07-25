import { Op, fn, col } from 'sequelize';
import { sequelize } from '@config/db';
import { NotFoundError } from '@middlewares/error';
import Post from '@models/feed/Post';
import User from '@models/user/User';
import PostComment, { type PostCommentModel } from '@models/feed/PostComment';
import PostCommentLike from '@models/feed/PostCommentLike';
import { createNotification } from '@services/notificationService';
import {
  serializePostComment,
  type PostCommentJSON,
} from '@serializers/postCommentSerializer';

// Batch-hydrate post comments: authors, reply counts (top-level only), and the
// viewer's like state — a fixed number of queries. Mirrors commentService.
const hydrateComments = async (
  comments: PostCommentModel[],
  viewerId: string
): Promise<PostCommentJSON[]> => {
  if (comments.length === 0) return [];
  const ids = comments.map(c => c.post_comment_id);
  const authorIds = [...new Set(comments.map(c => c.author_id))];

  const [authors, replyCounts, likedRows] = await Promise.all([
    User.findAll({
      where: { user_id: { [Op.in]: authorIds } },
      attributes: ['user_id', 'username', 'avatar_url'],
    }),
    PostComment.findAll({
      where: { parent_id: { [Op.in]: ids } },
      attributes: ['parent_id', [fn('COUNT', col('post_comment_id')), 'count']],
      group: ['parent_id'],
      raw: true,
    }) as unknown as Promise<Array<{ parent_id: string; count: string }>>,
    PostCommentLike.findAll({
      where: { user_id: viewerId, post_comment_id: { [Op.in]: ids } },
      attributes: ['post_comment_id'],
    }),
  ]);

  const authorById = new Map(authors.map(a => [a.user_id, a]));
  const replyCountByParent = new Map(
    replyCounts.map(r => [r.parent_id, Number(r.count)])
  );
  const likedSet = new Set(likedRows.map(r => r.post_comment_id));

  return comments.map(c =>
    serializePostComment(c, {
      author: authorById.get(c.author_id) ?? {
        user_id: c.author_id,
        username: 'unknown',
        avatar_url: null,
      },
      replyCount: replyCountByParent.get(c.post_comment_id) ?? 0,
      hasLiked: likedSet.has(c.post_comment_id),
    })
  );
};

// Top-level comments for a post, newest thread first.
export const listTopLevel = async (
  postId: string,
  viewerId: string
): Promise<PostCommentJSON[]> => {
  const comments = await PostComment.findAll({
    where: { post_id: postId, parent_id: null },
    order: [
      ['created_at', 'DESC'],
      ['post_comment_id', 'DESC'],
    ],
    limit: 100,
  });
  return hydrateComments(comments, viewerId);
};

// A thread's replies, oldest first (chronological).
export const listReplies = async (
  commentId: string,
  viewerId: string
): Promise<PostCommentJSON[]> => {
  const replies = await PostComment.findAll({
    where: { parent_id: commentId },
    order: [
      ['created_at', 'ASC'],
      ['post_comment_id', 'ASC'],
    ],
    limit: 200,
  });
  return hydrateComments(replies, viewerId);
};

// Post a comment or reply. Threads are one level deep: if the target parent is
// itself a reply, the new comment lands under that reply's parent (flat model).
// Keeps the post's comment_count coherent.
export const postComment = async (
  postId: string,
  authorId: string,
  body: string,
  parentId: string | null
): Promise<PostCommentJSON> => {
  const post = await Post.findByPk(postId);
  if (!post) throw new NotFoundError('Post');

  let resolvedParentId: string | null = null;
  let notifyRecipientId = post.author_id;
  let notifyType: 'comment' | 'comment_reply' = 'comment';
  if (parentId) {
    const parent = await PostComment.findByPk(parentId);
    if (!parent || parent.post_id !== postId) {
      throw new NotFoundError('Comment');
    }
    resolvedParentId = parent.parent_id ?? parent.post_comment_id;
    notifyRecipientId = parent.author_id;
    notifyType = 'comment_reply';
  }

  const comment = await sequelize.transaction(async transaction => {
    const created = await PostComment.create(
      {
        post_id: postId,
        author_id: authorId,
        parent_id: resolvedParentId,
        body,
      },
      { transaction }
    );
    await post.increment('comment_count', { by: 1, transaction });
    return created;
  });

  // Both kinds target the POST — the app opens its detail screen from the tap.
  await createNotification({
    recipientId: notifyRecipientId,
    actorId: authorId,
    type: notifyType,
    targetType: 'post',
    targetId: postId,
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
  const comment = await PostComment.findByPk(commentId);
  if (!comment) throw new NotFoundError('Comment');

  await sequelize.transaction(async transaction => {
    if (on) {
      const [, created] = await PostCommentLike.findOrCreate({
        where: { post_comment_id: commentId, user_id: userId },
        defaults: { post_comment_id: commentId, user_id: userId },
        transaction,
      });
      if (created) await comment.increment('like_count', { by: 1, transaction });
    } else {
      const removed = await PostCommentLike.destroy({
        where: { post_comment_id: commentId, user_id: userId },
        transaction,
      });
      if (removed > 0) {
        await comment.decrement('like_count', { by: removed, transaction });
      }
    }
  });
};
