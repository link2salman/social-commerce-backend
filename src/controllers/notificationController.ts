import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendCursor, sendSuccess } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import * as notifications from '@services/notificationService';
import type { MarkReadBody } from '@validators/notificationValidators';

// GET /v1/notifications?cursor=&limit= → { items, next_cursor }
export const list = asyncHandler(async (req: Request, res: Response) => {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = typeof req.query.limit === 'string' ? req.query.limit : undefined;
  const page = await notifications.listNotifications(
    requireUserId(req),
    cursor,
    limit
  );
  sendCursor(res, 'Notifications fetched', page.items, page.nextCursor);
});

// GET /v1/notifications/unread-count → { data: { count } }
export const unreadCount = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(
    res,
    'Unread count fetched',
    await notifications.unreadCount(requireUserId(req))
  );
});

// POST /v1/notifications/read { ids? } → { data: { count } } (newly marked read)
export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body as MarkReadBody;
  sendSuccess(
    res,
    'Notifications marked read',
    await notifications.markRead(requireUserId(req), ids)
  );
});
