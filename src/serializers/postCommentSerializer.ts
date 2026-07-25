import type { PostCommentModel } from '@models/feed/PostComment';

// Same wire shape as a video comment (the app reuses one comment.schema.ts for
// both content types). `replyCount` is derived (top-level only; always 0 on a
// reply) and `hasLiked` is the viewer's own like state — both computed by
// postCommentService and passed in.
export interface PostCommentJSON {
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
    avatarUrl: ctx.author.avatar_url,
  },
  parentId: comment.parent_id,
  likes: comment.like_count,
  replyCount: ctx.replyCount,
  hasLiked: ctx.hasLiked,
  createdAt: comment.created_at.toISOString(),
});
