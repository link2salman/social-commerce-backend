import { Op } from 'sequelize';
import Notification from '@models/notification/Notification';
import User from '@models/user/User';
import type { NotificationType, NotificationTargetType } from '@constants/enums';
import {
  serializeNotification,
  type NotificationJSON,
} from '@serializers/notificationSerializer';
import { hydrateUserSummaries } from '@services/socialService';
import {
  decodeCursor,
  encodeCursor,
  keysetWhere,
  clampPageSize,
} from '@utils/cursor';
import logger from '@utils/logger';

export interface CreateNotificationInput {
  recipientId: string;
  /** Who caused it; null for a system notification. */
  actorId: string | null;
  type: NotificationType;
  targetType: NotificationTargetType;
  targetId: string;
}

/**
 * Persist one feed row — the durable counterpart to the FCM push fired for the
 * same event. Call it from the same place the push fires.
 *
 * Never notify a user about their own action (commenting on your own video,
 * etc.) — the DB has a CHECK for it too, but returning early keeps that from
 * being an error path. Swallows its own failure and logs: a feed-write problem
 * must never break the action (a follow, a comment) that triggered it — awaited
 * at the call site only so the row is durable before the response returns.
 */
export const createNotification = async (
  input: CreateNotificationInput
): Promise<void> => {
  if (input.actorId && input.actorId === input.recipientId) return;
  try {
    await Notification.create({
      recipient_id: input.recipientId,
      actor_id: input.actorId,
      type: input.type,
      target_type: input.targetType,
      target_id: input.targetId,
    });
  } catch (err) {
    logger.error({ err, input }, 'notification.create_failed');
  }
};

// Chat messages deliberately do NOT create feed rows. The inbox already owns
// per-conversation unread state and a real-time channel; mirroring every
// message here would drown the social signals this feed exists for (follows,
// friend requests, comments) and split "unread messages" across two sources of
// truth. Messaging stays the inbox's concern.

const PAGE = 20;

export const listNotifications = async (
  recipientId: string,
  rawCursor?: string,
  rawLimit?: string
): Promise<{ items: NotificationJSON[]; nextCursor: string | null }> => {
  const cursor = decodeCursor(rawCursor);
  const limit = clampPageSize(rawLimit, PAGE);

  const rows = await Notification.findAll({
    where: {
      recipient_id: recipientId,
      ...keysetWhere(cursor, 'notification_id'),
    },
    order: [
      ['created_at', 'DESC'],
      ['notification_id', 'DESC'],
    ],
    limit: limit + 1, // one extra to detect a next page
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Hydrate distinct actors once, viewer-relative to the recipient (so the feed
  // can show "follow back"). A null actor stays null.
  const actorIds = [...new Set(page.map(n => n.actor_id).filter((id): id is string => id !== null))];
  const actors =
    actorIds.length > 0
      ? await User.findAll({ where: { user_id: { [Op.in]: actorIds } } })
      : [];
  const summaries = await hydrateUserSummaries(recipientId, actors);
  const byId = new Map(summaries.map(s => [s.id, s]));

  const items = page.map(n =>
    serializeNotification(n, n.actor_id ? byId.get(n.actor_id) ?? null : null)
  );

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ ts: last.created_at.toISOString(), id: last.notification_id })
      : null;

  return { items, nextCursor };
};

export const unreadCount = async (recipientId: string): Promise<{ count: number }> => {
  const count = await Notification.count({
    where: { recipient_id: recipientId, read_at: null },
  });
  return { count };
};

/**
 * Mark notifications read. With no ids → mark ALL of the recipient's unread rows
 * (the "mark all read" the app fires when the screen opens). With ids → only
 * those, and only if they belong to the caller (the recipient scope IS the
 * ownership check — another user's ids simply match nothing). Idempotent:
 * already-read rows are left untouched via the read_at null filter.
 */
export const markRead = async (
  recipientId: string,
  ids?: string[]
): Promise<{ count: number }> => {
  const where = {
    recipient_id: recipientId,
    read_at: null,
    ...(ids && ids.length > 0 ? { notification_id: { [Op.in]: ids } } : {}),
  };
  const [count] = await Notification.update({ read_at: new Date() }, { where });
  return { count };
};
