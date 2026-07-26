import type { PostCommentModel } from '@models/feed/PostComment';

// Same wire shape as a video comment (the app reuses one comment.schema.ts for
// both content types), snake_case throughout. `reply_count` is derived
// (top-level only; always 0 on a reply) and `has_liked` is the viewer's own like
// state — both computed by postCommentService and passed in through the
// internal (camelCase) `ctx`.
export interface PostCommentJSON {
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

export interface PostCommentAuthorCore {
  user_id: string;
  username: string;
  avatar_url: string | null;
}

export const serializePostComment = (
  comment: PostCommentModel,
  ctx: { author: PostCommentAuthorCore; replyCount: number; hasLiked: boolean }
): PostCommentJSON => ({
  id: comment.post_comment_id,
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
