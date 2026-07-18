import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import { getFeed } from '@services/feedService';
import { clampPageSize } from '@utils/cursor';

const cursorParam = (req: Request): string | null => {
  const raw = req.query.cursor;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};

// GET /v1/feed/for-you?cursor= → FeedPage
export const getForYou = asyncHandler(async (req: Request, res: Response) => {
  const page = await getFeed({
    viewerId: requireUserId(req),
    scope: 'for-you',
    cursor: cursorParam(req),
    pageSize: clampPageSize(req.query.limit),
  });
  send(res, page);
});

// GET /v1/feed/following?cursor= → FeedPage
export const getFollowing = asyncHandler(async (req: Request, res: Response) => {
  const page = await getFeed({
    viewerId: requireUserId(req),
    scope: 'following',
    cursor: cursorParam(req),
    pageSize: clampPageSize(req.query.limit),
  });
  send(res, page);
});
