import { Op, type WhereOptions } from 'sequelize';
import Video, { type VideoModel } from '@models/feed/Video';
import Engagement from '@models/feed/Engagement';
import Follow from '@models/social/Follow';
import Mute from '@models/social/Mute';
import User from '@models/user/User';
import {
  decodeCursor,
  encodeCursor,
  type KeysetCursor,
} from '@utils/cursor';
import VideoProduct from '@models/commerce/VideoProduct';
import { loadProductBundles } from '@services/productService';
import { toProductTag } from '@serializers/productSerializer';
import {
  serializeVideo,
  type VideoJSON,
  type ProductTagJSON,
} from '@serializers/videoSerializer';
import type { EngagementType } from '@constants/enums';

const firstImageUrl = (
  images: Array<{ url: string; position: number }>,
  fallbackSeed: string
): string =>
  [...images].sort((a, z) => a.position - z.position)[0]?.url ??
  `https://picsum.photos/seed/${encodeURIComponent(fallbackSeed)}/800/800`;

export interface FeedPageJSON {
  items: VideoJSON[];
  nextCursor: string | null;
}

// Keyset predicate for an ORDER BY (created_at DESC, video_id DESC): fetch rows
// strictly "after" the cursor. Stable under concurrent inserts (unlike offset).
const keysetWhere = (cursor: KeysetCursor | null): WhereOptions => {
  if (!cursor) return {};
  const ts = new Date(cursor.ts);
  return {
    [Op.or]: [
      { created_at: { [Op.lt]: ts } },
      { created_at: ts, video_id: { [Op.lt]: cursor.id } },
    ],
  };
};

// Batched hydration: given a page of videos + the viewer, resolve authors,
// the viewer's per-video engagement flags, and which authors the viewer
// follows — all in a fixed number of queries (no N+1). Reused by the feed and
// by profile video grids. Product tags are attached in the commerce phase.
export const hydrateVideos = async (
  videos: VideoModel[],
  viewerId: string
): Promise<VideoJSON[]> => {
  if (videos.length === 0) return [];

  const videoIds = videos.map(v => v.video_id);
  const authorIds = [...new Set(videos.map(v => v.author_id))];

  const [authors, engagements, follows, videoProducts] = await Promise.all([
    User.findAll({
      where: { user_id: { [Op.in]: authorIds } },
      attributes: ['user_id', 'username', 'avatar_url'],
    }),
    Engagement.findAll({
      where: { user_id: viewerId, video_id: { [Op.in]: videoIds } },
      attributes: ['video_id', 'type'],
    }),
    Follow.findAll({
      where: { follower_id: viewerId, followee_id: { [Op.in]: authorIds } },
      attributes: ['followee_id'],
    }),
    VideoProduct.findAll({
      where: { video_id: { [Op.in]: videoIds } },
      order: [['position', 'ASC']],
    }),
  ]);

  // Shoppable product tags: load each tagged product's bundle once, build pills.
  const bundles = await loadProductBundles([
    ...new Set(videoProducts.map(vp => vp.product_id)),
  ]);
  const tagsByVideo = new Map<string, ProductTagJSON[]>();
  for (const vp of videoProducts) {
    const bundle = bundles.get(vp.product_id);
    if (!bundle) continue;
    const arr = tagsByVideo.get(vp.video_id) ?? [];
    arr.push(
      toProductTag(
        bundle.product,
        firstImageUrl(bundle.images, bundle.product.product_id)
      )
    );
    tagsByVideo.set(vp.video_id, arr);
  }

  const authorById = new Map(authors.map(a => [a.user_id, a]));
  const engByVideo = new Map<string, Set<EngagementType>>();
  for (const e of engagements) {
    const set = engByVideo.get(e.video_id) ?? new Set<EngagementType>();
    set.add(e.type);
    engByVideo.set(e.video_id, set);
  }
  const followed = new Set(follows.map(f => f.followee_id));

  return videos.map(video => {
    const author = authorById.get(video.author_id);
    return serializeVideo(video, {
      author: author ?? {
        user_id: video.author_id,
        username: 'unknown',
        avatar_url: null,
      },
      isFollowingAuthor: followed.has(video.author_id),
      viewerEngagements: engByVideo.get(video.video_id) ?? new Set(),
      products: tagsByVideo.get(video.video_id) ?? [],
    });
  });
};

// The "Following" feed — strict reverse-chronological over videos from authors
// the viewer follows, **plus the viewer's own** (keyset paginated, stable under
// concurrent inserts). This stays chronological by design: "Following" is a
// catch-up timeline, not a ranked one. The ranked "For You" feed lives in
// rankingService, and deliberately still excludes you — discovery is other
// people. But a timeline that omits the clip you just published reads as a
// failed upload, and this matches `postService.getPostFeed`, which has always
// built its author set as `[...followeeIds, viewerId]`.
export const getFollowingFeed = async ({
  viewerId,
  cursor,
  pageSize = 10,
}: {
  viewerId: string;
  cursor?: string | null;
  pageSize?: number;
}): Promise<FeedPageJSON> => {
  const [following, muted] = await Promise.all([
    Follow.findAll({
      where: { follower_id: viewerId },
      attributes: ['followee_id'],
    }),
    Mute.findAll({ where: { muter_id: viewerId }, attributes: ['muted_id'] }),
  ]);
  // Muted authors drop out of the timeline (the follow edge stays — mute is not
  // an unfollow). A followee the viewer has muted simply isn't a candidate.
  const mutedIds = new Set(muted.map(m => m.muted_id));
  // The viewer is always in their own timeline. `Set` because following
  // yourself is possible in the data model and would otherwise duplicate the id
  // (harmless to SQL, but it makes the query log lie about what was asked for).
  const ids = [
    ...new Set([...following.map(f => f.followee_id).filter(id => !mutedIds.has(id)), viewerId]),
  ];

  const where: WhereOptions = {
    author_id: { [Op.in]: ids },
    ...keysetWhere(decodeCursor(cursor)),
  };

  const rows = await Video.findAll({
    where,
    order: [
      ['created_at', 'DESC'],
      ['video_id', 'DESC'],
    ],
    limit: pageSize + 1,
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const items = await hydrateVideos(page, viewerId);

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ ts: last.created_at.toISOString(), id: last.video_id })
      : null;

  return { items, nextCursor };
};

// The viewer's saved videos — videos they have a 'save' engagement on, newest
// video first. Shares the feed's keyset cursor (ordered by the video's own
// recency). Mirrors getSavedPosts in postService.
export const getSavedVideos = async ({
  viewerId,
  cursor,
  pageSize = 12,
}: {
  viewerId: string;
  cursor?: string | null;
  pageSize?: number;
}): Promise<FeedPageJSON> => {
  const saved = await Engagement.findAll({
    where: { user_id: viewerId, type: 'save' },
    attributes: ['video_id'],
  });
  const savedIds = saved.map(s => s.video_id);
  if (savedIds.length === 0) return { items: [], nextCursor: null };

  const rows = await Video.findAll({
    where: { video_id: { [Op.in]: savedIds }, ...keysetWhere(decodeCursor(cursor)) },
    order: [
      ['created_at', 'DESC'],
      ['video_id', 'DESC'],
    ],
    limit: pageSize + 1,
  });
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const items = await hydrateVideos(page, viewerId);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ ts: last.created_at.toISOString(), id: last.video_id })
      : null;
  return { items, nextCursor };
};

// A single user's videos (the profile grid), same shape + pagination as the feed.
export const getUserVideos = async ({
  viewerId,
  authorId,
  cursor,
  pageSize = 12,
}: {
  viewerId: string;
  authorId: string;
  cursor?: string | null;
  pageSize?: number;
}): Promise<FeedPageJSON> => {
  const rows = await Video.findAll({
    where: { author_id: authorId, ...keysetWhere(decodeCursor(cursor)) },
    order: [
      ['created_at', 'DESC'],
      ['video_id', 'DESC'],
    ],
    limit: pageSize + 1,
  });
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const items = await hydrateVideos(page, viewerId);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ ts: last.created_at.toISOString(), id: last.video_id })
      : null;
  return { items, nextCursor };
};
