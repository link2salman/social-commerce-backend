import type { NotificationModel } from '@models/notification/Notification';
import type { NotificationType, NotificationTargetType } from '@constants/enums';
import type { UserSummaryJSON } from '@serializers/userSerializer';

// Mirrors the app's notification.schema.ts, snake_case on the wire. The actor is
// a viewer-relative UserSummary (so the feed can offer "follow back"), null for
// a system row or one whose actor has since deleted their account. `target` is
// the polymorphic pointer the client opens on tap: a user profile, the video a
// comment lives on, a post, or — for a `message` row — the conversation. It is
// passed straight through from the row, with no per-type branching anywhere on
// this path, so widening NOTIFICATION_TARGET_TYPES is all a new target needs.
export interface NotificationJSON {
  id: string;
  type: NotificationType;
  actor: UserSummaryJSON | null;
  target: { type: NotificationTargetType; id: string };
  is_read: boolean;
  created_at: string;
}

export const serializeNotification = (
  n: NotificationModel,
  actor: UserSummaryJSON | null
): NotificationJSON => ({
  id: n.notification_id,
  type: n.type,
  actor,
  target: { type: n.target_type, id: n.target_id },
  is_read: n.read_at !== null,
  created_at: n.created_at.toISOString(),
});
