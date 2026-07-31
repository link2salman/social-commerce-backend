import { randomUUID } from 'crypto';
import { Op, type WhereOptions } from 'sequelize';
import { sequelize } from '@config/db';
import { ForbiddenError, NotFoundError } from '@middlewares/error';
import Post, { type PostModel } from '@models/feed/Post';
import PostMedia from '@models/feed/PostMedia';
import PostEngagement from '@models/feed/PostEngagement';
import Follow from '@models/social/Follow';
import Mute from '@models/social/Mute';
import User from '@models/user/User';
import { enqueue } from '@services/mediaJobService';
import { decodeCursor, encodeCursor, keysetWhere } from '@utils/cursor';
import {
  serializePost,
  type PostJSON,
  type PostMediaJSON,
} from '@serializers/postSerializer';
import type { EngagementType } from '@constants/enums';

export interface PostFeedPageJSON {
  items: PostJSON[];
  nextCursor: string | null;
}

// Batched hydration: given a page of posts + the viewer, resolve authors, the
// viewer's per-post engagement flags, which authors the viewer follows, and each
// post's ordered media (images/videos) — all in a fixed number of queries (no
// N+1). Mirrors hydrateVideos. Reused by the feed, profile grid, and saved list.
export const hydratePosts = async (
  posts: PostModel[],
  viewerId: string
): Promise<PostJSON[]> => {
  if (posts.length === 0) return [];

  const postIds = posts.map(p => p.post_id);
  const authorIds = [...new Set(posts.map(p => p.author_id))];

  const [authors, engagements, follows, media] = await Promise.all([
    User.findAll({
      where: { user_id: { [Op.in]: authorIds } },
      attributes: ['user_id', 'username', 'avatar_url'],
    }),
    PostEngagement.findAll({
      where: { user_id: viewerId, post_id: { [Op.in]: postIds } },
      attributes: ['post_id', 'type'],
    }),
    Follow.findAll({
      where: { follower_id: viewerId, followee_id: { [Op.in]: authorIds } },
      attributes: ['followee_id'],
    }),
    PostMedia.findAll({
      where: { post_id: { [Op.in]: postIds } },
      order: [['position', 'ASC']],
    }),
  ]);

  const authorById = new Map(authors.map(a => [a.user_id, a]));
  const engByPost = new Map<string, Set<EngagementType>>();
  for (const e of engagements) {
    const set = engByPost.get(e.post_id) ?? new Set<EngagementType>();
    set.add(e.type);
    engByPost.set(e.post_id, set);
  }
  const followed = new Set(follows.map(f => f.followee_id));
  const mediaByPost = new Map<string, PostMediaJSON[]>();
  for (const m of media) {
    const arr = mediaByPost.get(m.post_id) ?? [];
    arr.push({
      type: m.media_type,
      url: m.url,
      thumbnail_url: m.thumbnail_url,
      duration_ms: m.duration_ms,
      position: m.position,
    });
    mediaByPost.set(m.post_id, arr);
  }

  return posts.map(post => {
    const author = authorById.get(post.author_id);
    return serializePost(post, {
      author: author ?? {
        user_id: post.author_id,
        username: 'unknown',
        avatar_url: null,
      },
      isFollowingAuthor: followed.has(post.author_id),
      viewerEngagements: engByPost.get(post.post_id) ?? new Set(),
      media: mediaByPost.get(post.post_id) ?? [],
    });
  });
};

const pageFrom = async (
  rows: PostModel[],
  viewerId: string,
  pageSize: number
): Promise<PostFeedPageJSON> => {
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const items = await hydratePosts(page, viewerId);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ ts: last.created_at.toISOString(), id: last.post_id })
      : null;
  return { items, nextCursor };
};

// The POST /posts media entries (validators/postValidators.ts), so snake_case.
// Optional fields — see the warning on socialService's ProfilePatch.
export interface CreatePostMediaInput {
  type: 'image' | 'video';
  url: string;
  thumbnail_url?: string | null;
  duration_ms?: number | null;
}

export interface CreatePostInput {
  body: string;
  media: CreatePostMediaInput[];
}

// Create an image/text/video post. The media already lives in storage (the
// client uploaded via a signed URL), so we just persist the row + ordered media
// and hydrate it into the exact feed-card shape so the app can prepend it without
// a refetch. The "must have body or media" rule is enforced by the validator.
//
// PLACEHOLDER POSTER: a video without its own thumbnail gets a RANDOM STOCK PHOTO
// from picsum (seeded by post+position so it's stable) — the same stopgap the
// video pipeline uses (services/videoService.ts), since there is no transcode /
// frame-grab step. Replace by extracting a real frame on upload.
export const createPost = async (
  userId: string,
  input: CreatePostInput
): Promise<PostJSON> => {
  const postId = randomUUID();
  const post = await sequelize.transaction(async transaction => {
    const created = await Post.create(
      { post_id: postId, author_id: userId, body: input.body },
      { transaction }
    );
    if (input.media.length > 0) {
      const rows = await PostMedia.bulkCreate(
        input.media.map((m, position) => ({
          post_id: postId,
          media_type: m.type,
          url: m.url,
          thumbnail_url:
            m.type === 'video'
              ? m.thumbnail_url ??
                `https://picsum.photos/seed/${postId}-${position}/800/1400`
              : null,
          duration_ms: m.type === 'video' ? m.duration_ms ?? null : null,
          position,
        })),
        { transaction }
      );

      // Queue a transcode per video attachment, inside the same transaction as
      // the rows themselves: a job whose post_media never committed would fail
      // forever against a subject that does not exist. Images are not queued —
      // there is no image pipeline, and enqueuing one would only burn the retry
      // budget on a permanent failure.
      //
      // The picsum poster set above is the placeholder the worker replaces with
      // a real frame; it stays as the fallback for the window before the job
      // runs, and for good if the worker is not running.
      await Promise.all(
        rows
          .filter(row => row.media_type === 'video')
          .map(row => enqueue('post_media_transcode', row.post_media_id, transaction))
      );
    }
    return created;
  });

  const [json] = await hydratePosts([post], userId);
  return json!;
};

// A single post, hydrated for the viewer (the detail screen). 404s for a removed
// post (findByPk respects the paranoid soft-delete scope).
export const getPost = async (
  postId: string,
  viewerId: string
): Promise<PostJSON> => {
  const post = await Post.findByPk(postId);
  if (!post) throw new NotFoundError('Post');
  const [json] = await hydratePosts([post], viewerId);
  return json!;
};

// The home Posts feed — reverse-chronological over posts from authors the viewer
// follows, plus their own, keyset-paginated. Muted authors drop out (the follow
// edge stays). When the viewer follows nobody yet, fall back to a global recent
// feed (still excluding muted authors) so the surface is never empty in the demo.
export const getPostFeed = async ({
  viewerId,
  cursor,
  pageSize = 10,
}: {
  viewerId: string;
  cursor?: string | null;
  pageSize?: number;
}): Promise<PostFeedPageJSON> => {
  const [following, muted] = await Promise.all([
    Follow.findAll({
      where: { follower_id: viewerId },
      attributes: ['followee_id'],
    }),
    Mute.findAll({ where: { muter_id: viewerId }, attributes: ['muted_id'] }),
  ]);
  const mutedIds = new Set(muted.map(m => m.muted_id));
  const followeeIds = following
    .map(f => f.followee_id)
    .filter(id => !mutedIds.has(id));

  const keyset = keysetWhere(decodeCursor(cursor), 'post_id');
  let where: WhereOptions;
  if (followeeIds.length === 0) {
    // No follows yet → global recent, minus muted authors.
    where = mutedIds.size
      ? { author_id: { [Op.notIn]: [...mutedIds] }, ...keyset }
      : { ...keyset };
  } else {
    where = { author_id: { [Op.in]: [...followeeIds, viewerId] }, ...keyset };
  }

  const rows = await Post.findAll({
    where,
    order: [
      ['created_at', 'DESC'],
      ['post_id', 'DESC'],
    ],
    limit: pageSize + 1,
  });
  return pageFrom(rows, viewerId, pageSize);
};

// A single user's posts (the profile grid), same shape + pagination as the feed.
export const getUserPosts = async ({
  viewerId,
  authorId,
  cursor,
  pageSize = 12,
}: {
  viewerId: string;
  authorId: string;
  cursor?: string | null;
  pageSize?: number;
}): Promise<PostFeedPageJSON> => {
  const rows = await Post.findAll({
    where: { author_id: authorId, ...keysetWhere(decodeCursor(cursor), 'post_id') },
    order: [
      ['created_at', 'DESC'],
      ['post_id', 'DESC'],
    ],
    limit: pageSize + 1,
  });
  return pageFrom(rows, viewerId, pageSize);
};

// The viewer's saved posts — posts they have a 'save' engagement on, newest post
// first. Ordered by the post's own recency (not save time) so it shares the same
// keyset cursor as every other post list.
export const getSavedPosts = async ({
  viewerId,
  cursor,
  pageSize = 12,
}: {
  viewerId: string;
  cursor?: string | null;
  pageSize?: number;
}): Promise<PostFeedPageJSON> => {
  const saved = await PostEngagement.findAll({
    where: { user_id: viewerId, type: 'save' },
    attributes: ['post_id'],
  });
  const savedIds = saved.map(s => s.post_id);
  if (savedIds.length === 0) return { items: [], nextCursor: null };

  const rows = await Post.findAll({
    where: { post_id: { [Op.in]: savedIds }, ...keysetWhere(decodeCursor(cursor), 'post_id') },
    order: [
      ['created_at', 'DESC'],
      ['post_id', 'DESC'],
    ],
    limit: pageSize + 1,
  });
  return pageFrom(rows, viewerId, pageSize);
};

// Record a share. share_count is denormalized (the feed never COUNTs); bump it
// atomically and return the new value for the client's optimistic UI. Sharing a
// removed post 404s (findByPk respects the paranoid scope).
export const recordPostShare = async (
  postId: string
): Promise<{ share_count: number }> => {
  const post = await Post.findByPk(postId);
  if (!post) throw new NotFoundError('Post');
  await post.increment('share_count', { by: 1 });
  await post.reload();
  return { share_count: post.share_count };
};

/**
 * Delete your own post. Same rules as `deleteVideo` — see the long note there
 * for why there is no admin bypass and why this is a soft delete.
 *
 * The attached `post_media` rows are left alone. They are scoped to the post, so
 * nothing can reach them once it is gone, and leaving them intact is what makes
 * a restore whole rather than a text-only shell.
 */
export const deletePost = async (userId: string, postId: string): Promise<void> => {
  const post = await Post.findByPk(postId);
  if (!post) throw new NotFoundError('Post');
  if (post.author_id !== userId) {
    throw new ForbiddenError('You can only delete your own posts');
  }
  await post.update({ deleted_by: 'author' });
  await post.destroy();
};
