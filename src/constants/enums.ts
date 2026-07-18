// Central enum definitions — the single source shared by models (DB ENUM /
// validation), validators (Zod), and serializers (wire shapes). Values here
// mirror EXACTLY what the mobile client's Zod schemas expect on the wire.

// ── Auth ─────────────────────────────────────────────────────────────────────
export const TOKEN_REVOCATION_REASONS = [
  'logout',
  'password_change',
  'refresh_reuse',
  'expired',
  'admin_revoke',
  'account_deleted',
] as const;
export type TokenRevocationReason = (typeof TOKEN_REVOCATION_REASONS)[number];

// ── Social graph ─────────────────────────────────────────────────────────────
// Viewer-facing friend relationship (User.viewer.friendStatus on the wire).
export const FRIEND_STATUSES = [
  'none',
  'outgoing',
  'incoming',
  'friends',
] as const;
export type FriendStatus = (typeof FRIEND_STATUSES)[number];

// Persisted friend-request lifecycle (DB). `friendStatus` above is DERIVED from
// this relative to the viewer.
export const FRIEND_REQUEST_STATUSES = ['pending', 'accepted'] as const;
export type FriendRequestStatus = (typeof FRIEND_REQUEST_STATUSES)[number];

// ── Engagement ───────────────────────────────────────────────────────────────
// Save / Bookmark / Favorite are deliberately separate lists (product decision).
export const ENGAGEMENT_TYPES = [
  'like',
  'dislike',
  'save',
  'bookmark',
  'favorite',
] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

// ── Moderation ───────────────────────────────────────────────────────────────
export const REPORT_TARGET_TYPES = ['video', 'user', 'comment'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

// A report's lifecycle: pending → actioned (the content/user was acted on) or
// dismissed (reviewed, no action). Terminal states are set by a moderator.
export const REPORT_STATUSES = ['pending', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

// What a moderator did when resolving. 'dismiss' closes with no side effect;
// 'remove_content' soft-deletes the reported video/comment; 'suspend_user'
// deactivates the reported account. Each is valid only for matching targets.
export const MODERATION_ACTIONS = ['dismiss', 'remove_content', 'suspend_user'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const REPORT_REASONS = [
  'Spam or scam',
  'Nudity or sexual content',
  'Violence or dangerous acts',
  'Hate speech or harassment',
  'False information',
  'Intellectual property',
  'Something else',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

// ── Messaging ────────────────────────────────────────────────────────────────
export const GROUP_ROLES = ['owner', 'admin', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

// The client's Message.status union. The server only ever persists the last
// three; 'sending' is a client-optimistic state.
export const MESSAGE_STATUSES = ['sent', 'delivered', 'read'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_ATTACHMENT_TYPES = ['product', 'video', 'image'] as const;
export type MessageAttachmentType = (typeof MESSAGE_ATTACHMENT_TYPES)[number];

// ── Commerce ─────────────────────────────────────────────────────────────────
// Fulfillment status on the wire (the client's OrderSchema.status enum). Derived
// from payment_status — the client never sees the payment lifecycle directly.
export const ORDER_STATUSES = ['confirmed', 'processing', 'failed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Internal payment lifecycle, mirrors Stripe PaymentIntent states. An order is
// created 'requires_payment', flips to 'succeeded' on confirm/webhook.
export const PAYMENT_STATUSES = [
  'requires_payment',
  'processing',
  'succeeded',
  'failed',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// Map the internal payment lifecycle onto the 3-value wire status the client
// validates. refunded still reads 'confirmed' (the order was fulfilled) — the
// refund is surfaced separately via paymentStatus on the order detail.
export const orderWireStatus = (payment: PaymentStatus): OrderStatus => {
  switch (payment) {
    case 'succeeded':
    case 'refunded':
      return 'confirmed';
    case 'failed':
      return 'failed';
    default:
      return 'processing';
  }
};

// ── Calls ────────────────────────────────────────────────────────────────────
export const CALL_DIRECTIONS = ['incoming', 'outgoing'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_OUTCOMES = ['completed', 'missed', 'declined'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

// ── Push notifications ───────────────────────────────────────────────────────
export const DEVICE_PLATFORMS = ['ios', 'android'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

// ── Notifications ────────────────────────────────────────────────────────────
// The persisted feed's row kinds. These values double as the FCM `data.type`
// the app routes a push tap on (core/push/push.ts) — one vocabulary for both
// channels, so the push and the feed row for the same event agree.
export const NOTIFICATION_TYPES = [
  'follow',
  'friend_request',
  'friend_accept',
  'comment',
  'comment_reply',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// What a notification points at. Deliberately narrower than REPORT_TARGET_TYPES:
// only surfaces the client can actually open are representable. A comment
// notification targets the VIDEO, because the app has no standalone comment
// screen — comments live in a sheet keyed by video id.
export const NOTIFICATION_TARGET_TYPES = ['user', 'video'] as const;
export type NotificationTargetType = (typeof NOTIFICATION_TARGET_TYPES)[number];

// ── Misc ─────────────────────────────────────────────────────────────────────
export const DEFAULT_CURRENCY = 'USD';
