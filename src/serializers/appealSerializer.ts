import type { AppealModel } from '@models/moderation/Appeal';
import type { UserModel } from '@models/user/User';
import type { AppealStatus, AppealTargetType } from '@constants/enums';
import type { ResolvedTarget } from '@serializers/moderationSerializer';

// The /admin appeals surface + the appellant's own submissions. Like the
// moderation serializer, these shapes are for the moderation console — the app
// only ever WRITES appeals (submit), it never lists another user's.

export interface AppellantJSON {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface AppealJSON {
  id: string;
  targetType: AppealTargetType;
  targetId: string;
  reason: string;
  status: AppealStatus;
  appellant: AppellantJSON | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

// The resolved target so a moderator sees WHAT is being appealed. Reuses the
// moderation serializer's target shape (video/user/post — the restorable kinds);
// appeals never target a comment, but the shared union is harmless. `null` when
// the target is gone.
export interface AppealDetailJSON extends AppealJSON {
  target: ResolvedTarget;
}

const appellantOf = (u: UserModel | null | undefined): AppellantJSON | null =>
  u
    ? { id: u.user_id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url }
    : null;

export const serializeAppeal = (
  a: AppealModel,
  appellant?: UserModel | null
): AppealJSON => ({
  id: a.appeal_id,
  targetType: a.target_type,
  targetId: a.target_id,
  reason: a.reason,
  status: a.status,
  appellant: appellantOf(appellant ?? undefined),
  reviewedBy: a.reviewed_by,
  reviewedAt: a.reviewed_at ? a.reviewed_at.toISOString() : null,
  resolutionNote: a.resolution_note,
  createdAt: a.created_at.toISOString(),
});
