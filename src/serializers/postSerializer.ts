import type { PostModel } from '@models/feed/Post';
import type { EngagementType } from '@constants/enums';

// The client's post schema (features/posts/schemas/post.schema.ts). These
// interfaces ARE the wire contract — the client's Zod boundary parses exactly
// this shape. Mirrors VideoJSON's author/stats/viewer sub-shapes so the app can
// reuse its engagement patterns; the content itself is `body` + ordered `images`
// instead of a single video.
export interface PostImageJSON {
  url: string;
  position: number;
}

export interface PostJSON {
  id: string;
  body: string;
  images: PostImageJSON[];
  author: {
    id: string;
    username: string;
    avatarUrl: string | null;
    isFollowing: boolean;
  };
  stats: {
    likes: number;
    dislikes: number;
    comments: number;
    shares: number;
    saves: number;
  };
  viewer: {
    hasLiked: boolean;
    hasDisliked: boolean;
    hasSaved: boolean;
    hasBookmarked: boolean;
    hasFavorited: boolean;
  };
  createdAt: string;
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
  /** Carousel images, already sorted by position. */
  images: PostImageJSON[];
}

export const serializePost = (
  post: PostModel,
  ctx: SerializePostContext
): PostJSON => ({
  id: post.post_id,
  body: post.body,
  images: ctx.images,
  author: {
    id: ctx.author.user_id,
    username: ctx.author.username,
    avatarUrl: ctx.author.avatar_url,
    isFollowing: ctx.isFollowingAuthor,
  },
  stats: {
    likes: post.like_count,
    dislikes: post.dislike_count,
    comments: post.comment_count,
    shares: post.share_count,
    saves: post.save_count,
  },
  viewer: {
    hasLiked: ctx.viewerEngagements.has('like'),
    hasDisliked: ctx.viewerEngagements.has('dislike'),
    hasSaved: ctx.viewerEngagements.has('save'),
    hasBookmarked: ctx.viewerEngagements.has('bookmark'),
    hasFavorited: ctx.viewerEngagements.has('favorite'),
  },
  createdAt: post.created_at.toISOString(),
});
