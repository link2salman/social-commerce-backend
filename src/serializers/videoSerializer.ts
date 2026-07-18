import type { VideoModel } from '@models/feed/Video';
import type { EngagementType } from '@constants/enums';

// The client's feed schemas (features/feed/schemas/video.schema.ts). These
// interfaces ARE the wire contract — the client's Zod boundary parses exactly
// this shape.
export interface ProductTagJSON {
  productId: string;
  title: string;
  price: number; // major units (dollars) — commerce contract
  currency: string;
  thumbnailUrl: string;
}

export interface VideoJSON {
  id: string;
  hlsUrl: string;
  thumbnailUrl: string;
  caption: string;
  durationMs: number;
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
  products: ProductTagJSON[];
  soundName: string | null;
  createdAt: string;
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
  hlsUrl: video.hls_url,
  thumbnailUrl: video.thumbnail_url,
  caption: video.caption,
  durationMs: video.duration_ms,
  author: {
    id: ctx.author.user_id,
    username: ctx.author.username,
    avatarUrl: ctx.author.avatar_url,
    isFollowing: ctx.isFollowingAuthor,
  },
  stats: {
    likes: video.like_count,
    dislikes: video.dislike_count,
    comments: video.comment_count,
    shares: video.share_count,
    saves: video.save_count,
  },
  viewer: {
    hasLiked: ctx.viewerEngagements.has('like'),
    hasDisliked: ctx.viewerEngagements.has('dislike'),
    hasSaved: ctx.viewerEngagements.has('save'),
    hasBookmarked: ctx.viewerEngagements.has('bookmark'),
    hasFavorited: ctx.viewerEngagements.has('favorite'),
  },
  products: ctx.products ?? [],
  soundName: video.sound_name,
  createdAt: video.created_at.toISOString(),
});
