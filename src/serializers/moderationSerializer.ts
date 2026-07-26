import type { ReportModel } from '@models/moderation/Report';
import type { UserModel } from '@models/user/User';
import type { VideoModel } from '@models/feed/Video';
import type { CommentModel } from '@models/feed/Comment';
import type { PostModel } from '@models/feed/Post';
import type { PostCommentModel } from '@models/feed/PostComment';
import type { ReportStatus, ReportTargetType } from '@constants/enums';

// The /admin surface has no mobile client (the app never calls it), so these
// shapes are for a moderation console, not pinned by the app's Zod schemas.
// They are snake_case anyway: one casing convention across the whole API is the
// point, and a console built later should not have to learn two.

export interface ReporterJSON {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface ReportJSON {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: string;
  status: ReportStatus;
  reporter: ReporterJSON | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

// The resolved target, so a moderator sees WHAT they're acting on. `null` when
// the target was already removed (a deleted video, a suspended-then-purged
// account) — a report can outlive its target, and that must not 500.
export type ResolvedTarget =
  | { type: 'video'; id: string; caption: string; author_id: string; thumbnail_url: string | null; removed: boolean }
  | { type: 'user'; id: string; username: string; display_name: string; is_active: boolean }
  | { type: 'comment'; id: string; body: string; author_id: string; video_id: string }
  | { type: 'post'; id: string; body: string; author_id: string; image_url: string | null; removed: boolean }
  | { type: 'post_comment'; id: string; body: string; author_id: string; post_id: string }
  | null;

export interface ReportDetailJSON extends ReportJSON {
  target: ResolvedTarget;
}

const reporterOf = (u: UserModel | null | undefined): ReporterJSON | null =>
  u
    ? { id: u.user_id, username: u.username, display_name: u.display_name, avatar_url: u.avatar_url }
    : null;

export const serializeReport = (r: ReportModel, reporter?: UserModel | null): ReportJSON => ({
  id: r.report_id,
  target_type: r.target_type,
  target_id: r.target_id,
  reason: r.reason,
  status: r.status,
  reporter: reporterOf(reporter ?? undefined),
  reviewed_by: r.reviewed_by,
  reviewed_at: r.reviewed_at ? r.reviewed_at.toISOString() : null,
  resolution_note: r.resolution_note,
  created_at: r.created_at.toISOString(),
});

export const serializeVideoTarget = (v: VideoModel): ResolvedTarget => ({
  type: 'video',
  id: v.video_id,
  caption: v.caption,
  author_id: v.author_id,
  thumbnail_url: v.thumbnail_url,
  removed: v.deleted_at !== null,
});

export const serializeUserTarget = (u: UserModel): ResolvedTarget => ({
  type: 'user',
  id: u.user_id,
  username: u.username,
  display_name: u.display_name,
  is_active: u.is_active,
});

export const serializeCommentTarget = (c: CommentModel): ResolvedTarget => ({
  type: 'comment',
  id: c.comment_id,
  body: c.body,
  author_id: c.author_id,
  video_id: c.video_id,
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
  author_id: p.author_id,
  image_url: firstImageUrl,
  removed: p.deleted_at !== null,
});

export const serializePostCommentTarget = (
  c: PostCommentModel
): ResolvedTarget => ({
  type: 'post_comment',
  id: c.post_comment_id,
  body: c.body,
  author_id: c.author_id,
  post_id: c.post_id,
});
