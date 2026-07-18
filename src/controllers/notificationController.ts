import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import * as notifications from '@services/notificationService';
import type { MarkReadBody } from '@validators/notificationValidators';

// GET /v1/notifications?cursor=&limit= → { items, nextCursor }
export const list = asyncHandler(async (req: Request, res: Response) => {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = typeof req.query.limit === 'string' ? req.query.limit : undefined;
  send(res, await notifications.listNotifications(requireUserId(req), cursor, limit));
});

// GET /v1/notifications/unread-count → { count }
export const unreadCount = asyncHandler(async (req: Request, res: Response) => {
  send(res, await notifications.unreadCount(requireUserId(req)));
});

// POST /v1/notifications/read { ids? } → { count } (rows newly marked read)
export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body as MarkReadBody;
  send(res, await notifications.markRead(requireUserId(req), ids));
});
