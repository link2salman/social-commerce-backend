import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendList, sendSuccess } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import * as comments from '@services/commentService';

const commentId = (req: Request): string => req.params.id as string;

// GET /v1/comments/:id/replies → { items }
export const listReplies = asyncHandler(async (req: Request, res: Response) => {
  const items = await comments.listReplies(commentId(req), requireUserId(req));
  sendList(res, 'Replies fetched', items);
});

// POST/DELETE /v1/comments/:id/like
export const addLike = asyncHandler(async (req: Request, res: Response) => {
  await comments.toggleCommentLike(commentId(req), requireUserId(req), true);
  sendSuccess(res, 'Comment liked');
});
export const removeLike = asyncHandler(async (req: Request, res: Response) => {
  await comments.toggleCommentLike(commentId(req), requireUserId(req), false);
  sendSuccess(res, 'Comment unliked');
});
