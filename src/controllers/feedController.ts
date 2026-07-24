import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import { getFollowingFeed } from '@services/feedService';
import { getForYouRankedFeed } from '@services/rankingService';
import { clampPageSize } from '@utils/cursor';

const cursorParam = (req: Request): string | null => {
  const raw = req.query.cursor;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};

// GET /v1/feed/for-you?cursor= → FeedPage (personalized, ranked — see
// rankingService). Same wire shape as before; the cursor is opaque to the app.
export const getForYou = asyncHandler(async (req: Request, res: Response) => {
  const page = await getForYouRankedFeed({
    viewerId: requireUserId(req),
    cursor: cursorParam(req),
    pageSize: clampPageSize(req.query.limit),
  });
  send(res, page);
});

// GET /v1/feed/following?cursor= → FeedPage (reverse-chronological)
export const getFollowing = asyncHandler(async (req: Request, res: Response) => {
  const page = await getFollowingFeed({
    viewerId: requireUserId(req),
    cursor: cursorParam(req),
    pageSize: clampPageSize(req.query.limit),
  });
  send(res, page);
});
