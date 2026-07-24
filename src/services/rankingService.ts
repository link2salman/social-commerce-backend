import { Op } from 'sequelize';
import Video, { type VideoModel } from '@models/feed/Video';
import Follow from '@models/social/Follow';
import Block from '@models/social/Block';
import Engagement from '@models/feed/Engagement';
import { hydrateVideos, type FeedPageJSON } from '@services/feedService';
import { numberEnv } from '@utils/env';
import {
  decodeRankedCursor,
  encodeRankedCursor,
  DEFAULT_PAGE_SIZE,
} from '@utils/cursor';

// ─────────────────────────────────────────────────────────────────────────────
// "For You" ranking — a transparent, tunable HEURISTIC ranker (not a learned
// model). It's the standard v1 every product ships before it has the usage data
// to train a recommender, and it's a real improvement over reverse-chron:
//
//   score = engagement · recency · affinity
//
//   engagement = log1p(weighted likes/comments/shares/saves) + 1   (dampened,
//                so one viral clip doesn't swamp everything; +1 keeps a fresh
//                zero-engagement clip rankable, differentiated by recency)
//   recency    = 2 ^ (−ageHours / halfLife)                        (∈ (0,1])
//   affinity   = followBoost if the viewer follows the author,     (personal)
//                × seenPenalty if the viewer already engaged with it
//
// Cold start (a brand-new viewer with no follows/engagement) falls back to
// engagement·recency — a popularity-weighted freshness feed, never empty.
//
// Every weight is env-tunable (RANK_*), the same pattern as the pricing rates.
// Watch-time/impression signals would sharpen this further but need a client
// event pipeline — see DEFERRED-DECISIONS.md §4.
// ─────────────────────────────────────────────────────────────────────────────

const W_LIKE = numberEnv('RANK_W_LIKE', 1);
const W_COMMENT = numberEnv('RANK_W_COMMENT', 2);
const W_SHARE = numberEnv('RANK_W_SHARE', 3);
const W_SAVE = numberEnv('RANK_W_SAVE', 2);
const HALF_LIFE_HOURS = numberEnv('RANK_HALF_LIFE_HOURS', 24);
const FOLLOW_BOOST = numberEnv('RANK_FOLLOW_BOOST', 1.5);
const SEEN_PENALTY = numberEnv('RANK_SEEN_PENALTY', 0.1);
// Candidate window: For You considers videos from the last N days, capped at a
// bounded pool (freshness matters, and the pool is re-scored per page). At real
// scale the cap is where a proper retrieval layer (or a materialized score)
// would replace this in-app scan.
const WINDOW_DAYS = numberEnv('RANK_WINDOW_DAYS', 30);
const CANDIDATE_POOL = numberEnv('RANK_CANDIDATE_POOL', 500);

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Round so a score encoded in a cursor round-trips to the exact same value. */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

interface ScoredVideo {
  video: VideoModel;
  score: number;
}

const scoreVideo = (
  video: VideoModel,
  anchorMs: number,
  followed: Set<string>,
  engaged: Set<string>
): number => {
  const weighted =
    W_LIKE * video.like_count +
    W_COMMENT * video.comment_count +
    W_SHARE * video.share_count +
    W_SAVE * video.save_count;
  const engagement = Math.log1p(Math.max(0, weighted)) + 1;

  const ageHours = Math.max(0, (anchorMs - video.created_at.getTime()) / HOUR_MS);
  const recency = Math.pow(2, -ageHours / HALF_LIFE_HOURS);

  const affinity =
    (followed.has(video.author_id) ? FOLLOW_BOOST : 1) *
    (engaged.has(video.video_id) ? SEEN_PENALTY : 1);

  return round6(engagement * recency * affinity);
};

// Order (score DESC, video_id DESC) — the same order the cursor pages through.
const byScoreThenId = (a: ScoredVideo, z: ScoredVideo): number =>
  z.score !== a.score
    ? z.score - a.score
    : z.video.video_id.localeCompare(a.video.video_id);

export const getForYouRankedFeed = async ({
  viewerId,
  cursor,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  viewerId: string;
  cursor?: string | null;
  pageSize?: number;
}): Promise<FeedPageJSON> => {
  const decoded = decodeRankedCursor(cursor);
  // First page anchors the feed at "now"; later pages reuse the same anchor so
  // recency decay (and therefore the ordering) is identical across the session.
  const anchorMs = decoded?.anchorMs ?? Date.now();
  const windowStart = new Date(anchorMs - WINDOW_DAYS * DAY_MS);

  const [follows, blocks, engagements] = await Promise.all([
    Follow.findAll({ where: { follower_id: viewerId }, attributes: ['followee_id'] }),
    Block.findAll({ where: { blocker_id: viewerId }, attributes: ['blocked_id'] }),
    Engagement.findAll({ where: { user_id: viewerId }, attributes: ['video_id'] }),
  ]);
  const followed = new Set(follows.map(f => f.followee_id));
  const engaged = new Set(engagements.map(e => e.video_id));

  // Candidate pool: recent videos, excluding the viewer's own and any author the
  // viewer has blocked. Bounded and re-scored per page (see the cap note above).
  const excludeAuthors = [viewerId, ...blocks.map(b => b.blocked_id)];
  const candidates = await Video.findAll({
    where: {
      created_at: { [Op.gte]: windowStart },
      author_id: { [Op.notIn]: excludeAuthors },
    },
    order: [
      ['created_at', 'DESC'],
      ['video_id', 'DESC'],
    ],
    limit: CANDIDATE_POOL,
  });

  const ranked = candidates
    .map(video => ({ video, score: scoreVideo(video, anchorMs, followed, engaged) }))
    .sort(byScoreThenId);

  // Strictly "after" the cursor in (score DESC, id DESC) order.
  const after = decoded
    ? ranked.filter(
        s =>
          s.score < decoded.score ||
          (s.score === decoded.score && s.video.video_id < decoded.id)
      )
    : ranked;

  const pageItems = after.slice(0, pageSize);
  const items = await hydrateVideos(
    pageItems.map(s => s.video),
    viewerId
  );

  const last = pageItems[pageItems.length - 1];
  const nextCursor =
    after.length > pageItems.length && last
      ? encodeRankedCursor({ anchorMs, score: last.score, id: last.video.video_id })
      : null;

  return { items, nextCursor };
};
