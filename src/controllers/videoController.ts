import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendCursor, sendList, sendSuccess } from '@utils/responseHandler';
import { NotFoundError } from '@middlewares/error';
import { requireUserId } from '@middlewares/auth';
import { ENGAGEMENT_TYPES, type EngagementType } from '@constants/enums';
import { toggleEngagement } from '@services/engagementService';
import * as comments from '@services/commentService';
import { createVideo, deleteVideo, recordShare } from '@services/videoService';
import { getSavedVideos } from '@services/feedService';
import { clampPageSize } from '@utils/cursor';
import type { CommentPostBody } from '@validators/commentValidators';
import type { CreateVideoBody } from '@validators/videoValidators';

const ENGAGEMENT_SET = new Set<string>(ENGAGEMENT_TYPES);
const videoId = (req: Request): string => req.params.id as string;
const cursorParam = (req: Request): string | null => {
  const raw = req.query.cursor;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};

// GET /v1/videos/saved?cursor= → { items, next_cursor }
export const saved = asyncHandler(async (req: Request, res: Response) => {
  const page = await getSavedVideos({
    viewerId: requireUserId(req),
    cursor: cursorParam(req),
    pageSize: clampPageSize(req.query.limit),
  });
  sendCursor(res, 'Saved videos fetched', page.items, page.nextCursor);
});

// POST /v1/videos { video_url, caption, duration_ms, … } → { data: Video } (201)
export const create = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CreateVideoBody;
  const video = await createVideo(requireUserId(req), {
    video_url: body.video_url,
    thumbnail_url: body.thumbnail_url,
    caption: body.caption,
    duration_ms: body.duration_ms,
    sound_name: body.sound_name,
    filter_id: body.filter_id,
    product_ids: body.product_ids,
  });
  sendSuccess(res, 'Video published', video, 201);
});

// POST/DELETE /v1/videos/:id/:action  (like|dislike|save|bookmark|favorite)
const engagement = (on: boolean) =>
  asyncHandler(async (req: Request, res: Response) => {
    const action = req.params.action as string;
    if (!ENGAGEMENT_SET.has(action)) {
      throw new NotFoundError('Route');
    }
    await toggleEngagement(
      requireUserId(req),
      videoId(req),
      action as EngagementType,
      on
    );
    sendSuccess(res, on ? `Video ${action}d` : `Video un${action}d`);
  });

export const addEngagement = engagement(true);
export const removeEngagement = engagement(false);

// POST /v1/videos/:id/share → { data: { share_count } } — records a share and
// returns the new count. Not an engagement toggle (there's no per-user share
// row); it's a monotonic counter, so it lives outside the like/save toggle set.
export const share = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 'Share recorded', await recordShare(videoId(req)));
});

// DELETE /v1/videos/:id → 200. Author-only; a moderator takedown is a different
// action on a different route (see deleteVideo).
export const remove = asyncHandler(async (req: Request, res: Response) => {
  await deleteVideo(requireUserId(req), videoId(req));
  sendSuccess(res, 'Video deleted');
});

// GET /v1/videos/:id/comments → { items } (top-level)
export const listComments = asyncHandler(async (req: Request, res: Response) => {
  const items = await comments.listTopLevel(videoId(req), requireUserId(req));
  sendList(res, 'Comments fetched', items);
});

// POST /v1/videos/:id/comments { body, parent_id? } → { data: Comment } (201)
export const postComment = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CommentPostBody;
  const comment = await comments.postComment(
    videoId(req),
    requireUserId(req),
    body.body,
    body.parent_id ?? null
  );
  sendSuccess(res, 'Comment posted', comment, 201);
});
