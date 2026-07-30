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

// ── Post media ───────────────────────────────────────────────────────────────
// A post attachment is an image or a video (Instagram-style mixed carousels).
export const POST_MEDIA_TYPES = ['image', 'video'] as const;
export type PostMediaType = (typeof POST_MEDIA_TYPES)[number];

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
// video / user / comment are the original video-feed targets; post / post_comment
// are their image-text-feed counterparts. All resolved polymorphically (no FK).
export const REPORT_TARGET_TYPES = [
  'video',
  'user',
  'comment',
  'post',
  'post_comment',
] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

// A report's lifecycle: pending → actioned (the content/user was acted on) or
// dismissed (reviewed, no action). Terminal states are set by a moderator.
export const REPORT_STATUSES = ['pending', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

// What a moderator did when resolving. 'dismiss' closes with no side effect;
// 'remove_content' removes reported content (soft-delete for video/post, hard
// for comment/post_comment); 'suspend_user' deactivates the reported account.
// Each is valid only for matching targets.
export const MODERATION_ACTIONS = ['dismiss', 'remove_content', 'suspend_user'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

// What a user can appeal — the moderation actions that are reversible AND
// verifiable: a user suspension (reactivate), a removed video (restore), and a
// removed post (restore). Comment removals are hard-deletes with no surviving row
// to verify ownership or restore, so they are deliberately not appealable.
export const APPEAL_TARGET_TYPES = ['user', 'video', 'post'] as const;
export type AppealTargetType = (typeof APPEAL_TARGET_TYPES)[number];

// An appeal's lifecycle: pending → granted (the action was reversed) or denied
// (reviewed, action stands). Terminal states are set by a moderator.
export const APPEAL_STATUSES = ['pending', 'granted', 'denied'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

// What a moderator did with an appeal. 'grant' reverses the original action
// (reactivate user / restore video); 'deny' lets it stand.
export const APPEAL_DECISIONS = ['grant', 'deny'] as const;
export type AppealDecision = (typeof APPEAL_DECISIONS)[number];

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

// Physical-goods fulfillment lifecycle, tracked separately from payment: a paid
// order starts 'unfulfilled', a seller marks it 'shipped' (with tracking), then
// 'delivered'. Additive — the client's 3-value `status` (payment-derived) is
// unchanged; fulfillment is surfaced as its own field.
export const FULFILLMENT_STATUSES = ['unfulfilled', 'shipped', 'delivered'] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

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
  'like',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// What a notification points at. Deliberately narrower than REPORT_TARGET_TYPES:
// only surfaces the client can actually open are representable. A video comment
// notification targets the VIDEO (comments live in a sheet keyed by video id); a
// post like/comment targets the POST, which does have a standalone detail screen.
export const NOTIFICATION_TARGET_TYPES = ['user', 'video', 'post'] as const;
export type NotificationTargetType = (typeof NOTIFICATION_TARGET_TYPES)[number];

// ── Media jobs ───────────────────────────────────────────────────────────────
// Background media post-processing (see services/transcodeService). `kind` says
// what the job does and how to read `media_jobs.subject_id`, which is polymorphic
// and has no FK: 'video_transcode' → videos.video_id.
export const MEDIA_JOB_KINDS = ['video_transcode'] as const;
export type MediaJobKind = (typeof MEDIA_JOB_KINDS)[number];

// pending → running → done | failed. 'failed' is terminal: it means the retry
// budget is spent, not that a single attempt errored (a retriable attempt goes
// back to 'pending' with a later run_after).
export const MEDIA_JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export type MediaJobStatus = (typeof MEDIA_JOB_STATUSES)[number];

// ── Misc ─────────────────────────────────────────────────────────────────────
export const DEFAULT_CURRENCY = 'USD';
