import type { AppealModel } from '@models/moderation/Appeal';
import type { UserModel } from '@models/user/User';
import type { AppealStatus, AppealTargetType } from '@constants/enums';
import type { ResolvedTarget } from '@serializers/moderationSerializer';

// The /admin appeals surface + the appellant's own submissions. Like the
// moderation serializer, these shapes are for the moderation console — the app
// only ever WRITES appeals (submit), it never lists another user's — and are
// snake_case for the same reason: one casing convention across the whole API.

export interface AppellantJSON {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface AppealJSON {
  id: string;
  target_type: AppealTargetType;
  target_id: string;
  reason: string;
  status: AppealStatus;
  appellant: AppellantJSON | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  resolution_note: string | null;
  created_at: string;
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
    ? { id: u.user_id, username: u.username, display_name: u.display_name, avatar_url: u.avatar_url }
    : null;

export const serializeAppeal = (
  a: AppealModel,
  appellant?: UserModel | null
): AppealJSON => ({
  id: a.appeal_id,
  target_type: a.target_type,
  target_id: a.target_id,
  reason: a.reason,
  status: a.status,
  appellant: appellantOf(appellant ?? undefined),
  reviewed_by: a.reviewed_by,
  reviewed_at: a.reviewed_at ? a.reviewed_at.toISOString() : null,
  resolution_note: a.resolution_note,
  created_at: a.created_at.toISOString(),
});
