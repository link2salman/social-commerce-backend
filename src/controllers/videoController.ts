import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send, sendOk } from '@utils/respond';
import { NotFoundError } from '@middlewares/error';
import { requireUserId } from '@middlewares/auth';
import { ENGAGEMENT_TYPES, type EngagementType } from '@constants/enums';
import { toggleEngagement } from '@services/engagementService';
import * as comments from '@services/commentService';
import { createVideo } from '@services/videoService';
import type { CommentPostBody } from '@validators/commentValidators';
import type { CreateVideoBody } from '@validators/videoValidators';

const ENGAGEMENT_SET = new Set<string>(ENGAGEMENT_TYPES);
const videoId = (req: Request): string => req.params.id as string;

// POST /v1/videos { videoUrl, caption, durationMs, … } → Video (201)
export const create = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CreateVideoBody;
  const video = await createVideo(requireUserId(req), {
    videoUrl: body.videoUrl,
    thumbnailUrl: body.thumbnailUrl,
    caption: body.caption,
    durationMs: body.durationMs,
    soundName: body.soundName,
    filterId: body.filterId,
    productIds: body.productIds,
  });
  send(res, video, 201);
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
    sendOk(res);
  });

export const addEngagement = engagement(true);
export const removeEngagement = engagement(false);

// GET /v1/videos/:id/comments → Comment[] (top-level)
export const listComments = asyncHandler(async (req: Request, res: Response) => {
  send(res, await comments.listTopLevel(videoId(req), requireUserId(req)));
});

// POST /v1/videos/:id/comments { body, parentId? } → Comment (201)
export const postComment = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CommentPostBody;
  const comment = await comments.postComment(
    videoId(req),
    requireUserId(req),
    body.body,
    body.parentId ?? null
  );
  send(res, comment, 201);
});
