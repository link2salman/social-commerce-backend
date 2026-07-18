import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send, sendOk } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import * as comments from '@services/commentService';

const commentId = (req: Request): string => req.params.id as string;

// GET /v1/comments/:id/replies → Comment[]
export const listReplies = asyncHandler(async (req: Request, res: Response) => {
  send(res, await comments.listReplies(commentId(req), requireUserId(req)));
});

// POST/DELETE /v1/comments/:id/like → { ok: true }
export const addLike = asyncHandler(async (req: Request, res: Response) => {
  await comments.toggleCommentLike(commentId(req), requireUserId(req), true);
  sendOk(res);
});
export const removeLike = asyncHandler(async (req: Request, res: Response) => {
  await comments.toggleCommentLike(commentId(req), requireUserId(req), false);
  sendOk(res);
});
