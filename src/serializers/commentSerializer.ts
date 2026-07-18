import type { CommentModel } from '@models/feed/Comment';

// The client's comment.schema.ts shape. `replyCount` is derived (top-level
// comments only; always 0 on a reply) and `hasLiked` is the viewer's own like
// state — both computed by commentService and passed in.
export interface CommentJSON {
  id: string;
  body: string;
  author: {
    id: string;
    username: string;
    avatarUrl: string | null;
  };
  parentId: string | null;
  likes: number;
  replyCount: number;
  hasLiked: boolean;
  createdAt: string;
}

export interface CommentAuthorCore {
  user_id: string;
  username: string;
  avatar_url: string | null;
}

export const serializeComment = (
  comment: CommentModel,
  ctx: { author: CommentAuthorCore; replyCount: number; hasLiked: boolean }
): CommentJSON => ({
  id: comment.comment_id,
  body: comment.body,
  author: {
    id: ctx.author.user_id,
    username: ctx.author.username,
    avatarUrl: ctx.author.avatar_url,
  },
  parentId: comment.parent_id,
  likes: comment.like_count,
  replyCount: ctx.replyCount,
  hasLiked: ctx.hasLiked,
  createdAt: comment.created_at.toISOString(),
});
