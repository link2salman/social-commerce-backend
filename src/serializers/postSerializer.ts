import type { PostModel } from '@models/feed/Post';
import type { EngagementType, PostMediaType } from '@constants/enums';

// The client's post schema (features/posts/schemas/post.schema.ts). These
// interfaces ARE the wire contract — the client's Zod boundary parses exactly
// this shape, snake_case throughout. Mirrors VideoJSON's author/stats/viewer
// sub-shapes so the app can reuse its engagement patterns; the content itself is
// `body` + ordered `media` (images and/or videos) instead of a single video.
export interface PostMediaJSON {
  type: PostMediaType;
  url: string;
  /** Video poster; null for an image. */
  thumbnail_url: string | null;
  /** Video length in ms; null for an image. */
  duration_ms: number | null;
  position: number;
}

export interface PostJSON {
  id: string;
  body: string;
  media: PostMediaJSON[];
  author: {
    id: string;
    username: string;
    avatar_url: string | null;
    is_following: boolean;
  };
  stats: {
    likes: number;
    dislikes: number;
    comments: number;
    shares: number;
    saves: number;
  };
  viewer: {
    has_liked: boolean;
    has_disliked: boolean;
    has_saved: boolean;
    has_bookmarked: boolean;
    has_favorited: boolean;
  };
  created_at: string;
}

export interface PostAuthorInput {
  user_id: string;
  username: string;
  avatar_url: string | null;
}

export interface SerializePostContext {
  author: PostAuthorInput;
  isFollowingAuthor: boolean;
  /** The set of engagement types the viewer has on this post. */
  viewerEngagements: Set<EngagementType>;
  /** Carousel media (images/videos), already sorted by position. */
  media: PostMediaJSON[];
}

export const serializePost = (
  post: PostModel,
  ctx: SerializePostContext
): PostJSON => ({
  id: post.post_id,
  body: post.body,
  media: ctx.media,
  author: {
    id: ctx.author.user_id,
    username: ctx.author.username,
    avatar_url: ctx.author.avatar_url,
    is_following: ctx.isFollowingAuthor,
  },
  stats: {
    likes: post.like_count,
    dislikes: post.dislike_count,
    comments: post.comment_count,
    shares: post.share_count,
    saves: post.save_count,
  },
  viewer: {
    has_liked: ctx.viewerEngagements.has('like'),
    has_disliked: ctx.viewerEngagements.has('dislike'),
    has_saved: ctx.viewerEngagements.has('save'),
    has_bookmarked: ctx.viewerEngagements.has('bookmark'),
    has_favorited: ctx.viewerEngagements.has('favorite'),
  },
  created_at: post.created_at.toISOString(),
});
