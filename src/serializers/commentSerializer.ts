import type { CommentModel } from '@models/feed/Comment';

// The client's comment.schema.ts shape, snake_case on the wire. `reply_count` is
// derived (top-level comments only; always 0 on a reply) and `has_liked` is the
// viewer's own like state — both computed by commentService and passed in
// through the internal (camelCase) `ctx`.
export interface CommentJSON {
  id: string;
  body: string;
  author: {
    id: string;
    username: string;
    avatar_url: string | null;
  };
  parent_id: string | null;
  likes: number;
  reply_count: number;
  has_liked: boolean;
  created_at: string;
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
    avatar_url: ctx.author.avatar_url,
  },
  parent_id: comment.parent_id,
  likes: comment.like_count,
  reply_count: ctx.replyCount,
  has_liked: ctx.hasLiked,
  created_at: comment.created_at.toISOString(),
});
