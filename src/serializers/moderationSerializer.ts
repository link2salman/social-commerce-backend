import type { ReportModel } from '@models/moderation/Report';
import type { UserModel } from '@models/user/User';
import type { VideoModel } from '@models/feed/Video';
import type { CommentModel } from '@models/feed/Comment';
import type { PostModel } from '@models/feed/Post';
import type { PostCommentModel } from '@models/feed/PostComment';
import type { ReportStatus, ReportTargetType } from '@constants/enums';

// The /admin surface has no mobile client (the app never calls it), so these
// shapes are for a moderation console, not pinned by the app's Zod schemas.

export interface ReporterJSON {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ReportJSON {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  status: ReportStatus;
  reporter: ReporterJSON | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

// The resolved target, so a moderator sees WHAT they're acting on. `null` when
// the target was already removed (a deleted video, a suspended-then-purged
// account) — a report can outlive its target, and that must not 500.
export type ResolvedTarget =
  | { type: 'video'; id: string; caption: string; authorId: string; thumbnailUrl: string | null; removed: boolean }
  | { type: 'user'; id: string; username: string; displayName: string; isActive: boolean }
  | { type: 'comment'; id: string; body: string; authorId: string; videoId: string }
  | { type: 'post'; id: string; body: string; authorId: string; imageUrl: string | null; removed: boolean }
  | { type: 'post_comment'; id: string; body: string; authorId: string; postId: string }
  | null;

export interface ReportDetailJSON extends ReportJSON {
  target: ResolvedTarget;
}

const reporterOf = (u: UserModel | null | undefined): ReporterJSON | null =>
  u
    ? { id: u.user_id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url }
    : null;

export const serializeReport = (r: ReportModel, reporter?: UserModel | null): ReportJSON => ({
  id: r.report_id,
  targetType: r.target_type,
  targetId: r.target_id,
  reason: r.reason,
  status: r.status,
  reporter: reporterOf(reporter ?? undefined),
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
  resolutionNote: r.resolution_note,
  createdAt: r.created_at.toISOString(),
});

export const serializeVideoTarget = (v: VideoModel): ResolvedTarget => ({
  type: 'video',
  id: v.video_id,
  caption: v.caption,
  authorId: v.author_id,
  thumbnailUrl: v.thumbnail_url,
  removed: v.deleted_at !== null,
});

export const serializeUserTarget = (u: UserModel): ResolvedTarget => ({
  type: 'user',
  id: u.user_id,
  username: u.username,
  displayName: u.display_name,
  isActive: u.is_active,
});

export const serializeCommentTarget = (c: CommentModel): ResolvedTarget => ({
  type: 'comment',
  id: c.comment_id,
  body: c.body,
  authorId: c.author_id,
  videoId: c.video_id,
});

// A post target carries its first image URL (if any) so the console can show a
// thumbnail, mirroring how a video target carries its poster.
export const serializePostTarget = (
  p: PostModel,
  firstImageUrl: string | null
): ResolvedTarget => ({
  type: 'post',
  id: p.post_id,
  body: p.body,
  authorId: p.author_id,
  imageUrl: firstImageUrl,
  removed: p.deleted_at !== null,
});

export const serializePostCommentTarget = (
  c: PostCommentModel
): ResolvedTarget => ({
  type: 'post_comment',
  id: c.post_comment_id,
  body: c.body,
  authorId: c.author_id,
  postId: c.post_id,
});
