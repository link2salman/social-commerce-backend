import { Op, QueryTypes } from 'sequelize';
import { sequelize } from '@config/db';
import Notification, { type NotificationModel } from '@models/notification/Notification';
import User from '@models/user/User';
import type { NotificationType, NotificationTargetType } from '@constants/enums';
import {
  serializeNotification,
  type NotificationJSON,
} from '@serializers/notificationSerializer';
import { hydrateUserSummaries } from '@services/socialService';
import { getSocketManager } from 'socket';
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

/** The realtime twin of a feed row. One event, one payload shape. */
export const NOTIFICATION_NEW_EVENT = 'notification:new';

// ── Realtime emit (best-effort; no-op if the socket layer isn't running) ─────
//
// The payload is `serializeNotification` — byte-identical to an item of
// GET /notifications — so the app validates a live notification with the very
// same Zod schema it uses for the list, and can prepend it to the feed as-is.
// That means hydrating the actor into a full viewer-relative UserSummary here
// (recipient as the viewer, exactly like listNotifications does), not shipping a
// slimmer ad-hoc shape that would drift.
//
// Same contract as `chatService.emitToMembers`: getSocketManager() throws when
// the socket layer never started (integration tests, the worker process), so the
// whole thing is wrapped and downgraded to a debug log.
const emitNotificationNew = async (row: NotificationModel): Promise<void> => {
  try {
    const manager = getSocketManager();
    const actorUser = row.actor_id ? await User.findByPk(row.actor_id) : null;
    const [actor] = actorUser
      ? await hydrateUserSummaries(row.recipient_id, [actorUser])
      : [];
    manager.sendToUser(
      row.recipient_id,
      NOTIFICATION_NEW_EVENT,
      serializeNotification(row, actor ?? null)
    );
  } catch (err) {
    logger.debug({ err }, 'notification: realtime emit skipped (socket not ready)');
  }
};

// The shared spine of every trigger: skip self-notifications, persist the row
// however this type persists, push it live, and never let a feed-write failure
// escape into the action that caused it.
//
// Never notify a user about their own action (commenting on your own video,
// etc.) — the DB has a CHECK for it too, but returning early keeps that from
// being an error path.
//
// The socket emit lives here rather than at each trigger for two reasons:
// nothing here takes a transaction and every caller invokes it after its own
// commit, so the row the client fetches next is guaranteed to exist; and every
// notification type gets realtime delivery from the one seam instead of seven
// call sites drifting apart.
const deliver = async (
  input: CreateNotificationInput,
  persist: (input: CreateNotificationInput) => Promise<NotificationModel>
): Promise<void> => {
  if (input.actorId && input.actorId === input.recipientId) return;
  try {
    const row = await persist(input);
    await emitNotificationNew(row);
  } catch (err) {
    logger.error({ err, input }, 'notification.create_failed');
  }
};

const insertRow = (input: CreateNotificationInput): Promise<NotificationModel> =>
  Notification.create({
    recipient_id: input.recipientId,
    actor_id: input.actorId,
    type: input.type,
    target_type: input.targetType,
    target_id: input.targetId,
  });

/**
 * Persist one feed row — the durable counterpart to the FCM push fired for the
 * same event — then push it live over the socket. Call it from the same place
 * the push fires.
 *
 * One event, one row: this is the behaviour every type except `message` wants
 * (two people commenting on your video are two notifications and must stay two).
 * Swallows its own failure and logs: a feed-write problem must never break the
 * action (a follow, a comment) that triggered it — awaited at the call site only
 * so the row is durable before the response returns.
 */
export const createNotification = async (
  input: CreateNotificationInput
): Promise<void> => deliver(input, insertRow);

// ── Chat messages: ONE coalesced row per conversation ────────────────────────
//
// This reverses the original design, in which chat wrote no feed rows at all.
// The product decision is that a message belongs in the notification feed
// alongside follows and friend requests — but naively, a 50-message thread would
// mean 50 rows, which is precisely the flood the old design was avoiding. So a
// message notification COALESCES: per (recipient, conversation) there is at most
// one UNREAD row, and each new message bumps it (newest actor, created_at moved
// to now so it sorts back to the top) instead of inserting another. The row
// leaves the unread set when the recipient reads their notifications OR opens
// the thread itself (markConversationNotificationRead, below), and the next
// message starts a fresh one.
//
// It is an upsert rather than a SELECT-then-UPDATE because the members of a busy
// group post concurrently: `notifications_message_unread_unique` (a partial
// UNIQUE index over (recipient_id, target_type, target_id) WHERE type='message'
// AND read_at IS NULL) makes ON CONFLICT the arbiter, so two simultaneous
// messages can never race two rows into existence. Raw SQL because Sequelize
// cannot express a conflict target that infers a *partial* index — and the
// literal 'message' / 'conversation' below are load-bearing for that inference,
// not incidental: a bind parameter there would fail to match the index predicate.
//
// Coalescing is deliberately message-only. Do not generalise it to the other
// types without the index to match.
const upsertUnreadMessageRow = async (
  input: CreateNotificationInput
): Promise<NotificationModel> => {
  const rows = await sequelize.query<NotificationModel>(
    `INSERT INTO notifications (recipient_id, actor_id, type, target_type, target_id, created_at)
          VALUES (:recipientId, :actorId, 'message', 'conversation', :targetId, NOW())
     ON CONFLICT (recipient_id, target_type, target_id)
             WHERE type = 'message' AND read_at IS NULL
     DO UPDATE SET actor_id = EXCLUDED.actor_id, created_at = EXCLUDED.created_at
       RETURNING *`,
    {
      replacements: {
        recipientId: input.recipientId,
        actorId: input.actorId,
        targetId: input.targetId,
      },
      type: QueryTypes.SELECT,
      model: Notification,
      mapToModel: true,
    }
  );
  const row = rows[0];
  if (!row) throw new Error('notification upsert returned no row');
  return row;
};

/**
 * A chat message landed in `conversationId` — give the recipient a feed row, or
 * bump the one they already have unread for that thread (see the note above).
 * The realtime `notification:new` emit fires either way, carrying the full
 * serialized notification, so the client can replace the row it already has by
 * id instead of guessing that nothing changed.
 *
 * Self-messages are impossible in practice (you are not notified of your own
 * send) but the shared self-check covers it anyway, so callers can just loop
 * over every member of the conversation.
 */
export const createMessageNotification = async (input: {
  recipientId: string;
  actorId: string;
  conversationId: string;
}): Promise<void> =>
  deliver(
    {
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: 'message',
      targetType: 'conversation',
      targetId: input.conversationId,
    },
    upsertUnreadMessageRow
  );

/**
 * Reading a conversation clears its notification. Called by `chatService` when
 * opening the thread writes the reader's `last_read_at`.
 *
 * Without this the feature is a badge you cannot dismiss by doing the obvious
 * thing: a user who reads every message still carries an unread notification
 * until they happen to open the notifications screen. Chat is the one type whose
 * content is consumed on a DIFFERENT screen from the feed row announcing it, so
 * it is the one type that needs this — a follow or a like has nowhere else to be
 * read.
 *
 * Narrow on purpose: one recipient, one conversation, only `type: 'message'`,
 * only already-unread rows. It cannot touch another type, another thread, or
 * another user, and it is idempotent (the `read_at: null` filter makes a second
 * open a no-op).
 *
 * Setting `read_at` also releases the row from
 * `notifications_message_unread_unique`, whose predicate is `read_at IS NULL` —
 * so the next message in the thread inserts a FRESH unread row rather than
 * bumping the one the reader just cleared. That interaction is the point, and it
 * is pinned by a test.
 *
 * Swallows and logs, like every other write on this path: failing to clear a
 * badge must never fail loading a thread. No socket event — there is no
 * `notification:read` in the contract, and `POST /notifications/read` doesn't
 * emit one either; the client refetches the count it already polls.
 */
export const markConversationNotificationRead = async (
  recipientId: string,
  conversationId: string
): Promise<void> => {
  try {
    await Notification.update(
      { read_at: new Date() },
      {
        where: {
          recipient_id: recipientId,
          type: 'message',
          target_type: 'conversation',
          target_id: conversationId,
          read_at: null,
        },
      }
    );
  } catch (err) {
    logger.error(
      { err, recipientId, conversationId },
      'notification.conversation_read_failed'
    );
  }
};

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
