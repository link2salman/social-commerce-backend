import type { VideoModel } from '@models/feed/Video';
import type { EngagementType } from '@constants/enums';

// The client's feed schemas (features/feed/schemas/video.schema.ts). These
// interfaces ARE the wire contract — the client's Zod boundary parses exactly
// this shape, snake_case throughout. `SerializeVideoContext` is internal input,
// not wire, and stays camelCase.
export interface ProductTagJSON {
  product_id: string;
  title: string;
  price: number; // major units (dollars) — commerce contract
  currency: string;
  thumbnail_url: string;
}

export interface VideoJSON {
  id: string;
  hls_url: string;
  thumbnail_url: string;
  caption: string;
  duration_ms: number;
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
  products: ProductTagJSON[];
  sound_name: string | null;
  created_at: string;
}

export interface VideoAuthorInput {
  user_id: string;
  username: string;
  avatar_url: string | null;
}

export interface SerializeVideoContext {
  author: VideoAuthorInput;
  isFollowingAuthor: boolean;
  /** The set of engagement types the viewer has on this video. */
  viewerEngagements: Set<EngagementType>;
  products?: ProductTagJSON[];
}

export const serializeVideo = (
  video: VideoModel,
  ctx: SerializeVideoContext
): VideoJSON => ({
  id: video.video_id,
  hls_url: video.hls_url,
  thumbnail_url: video.thumbnail_url,
  caption: video.caption,
  duration_ms: video.duration_ms,
  author: {
    id: ctx.author.user_id,
    username: ctx.author.username,
    avatar_url: ctx.author.avatar_url,
    is_following: ctx.isFollowingAuthor,
  },
  stats: {
    likes: video.like_count,
    dislikes: video.dislike_count,
    comments: video.comment_count,
    shares: video.share_count,
    saves: video.save_count,
  },
  viewer: {
    has_liked: ctx.viewerEngagements.has('like'),
    has_disliked: ctx.viewerEngagements.has('dislike'),
    has_saved: ctx.viewerEngagements.has('save'),
    has_bookmarked: ctx.viewerEngagements.has('bookmark'),
    has_favorited: ctx.viewerEngagements.has('favorite'),
  },
  products: ctx.products ?? [],
  sound_name: video.sound_name,
  created_at: video.created_at.toISOString(),
});
