import type { UserModel } from '@models/user/User';
import type { FriendStatus } from '@constants/enums';

// The client's user.schema.ts shapes (User + UserSummary). Relationship + stats
// are computed by socialService and passed in; the serializer only maps.
//
// Wire keys are snake_case throughout (see utils/responseHandler.ts). The INPUT
// types below — `UserCore`, and the `isAdmin` argument — are internal plumbing,
// not the wire, and keep whatever casing their source uses.
export interface UserStats {
  followers: number;
  following: number;
  likes: number;
  videos: number;
}

export interface FullViewerState {
  is_self: boolean;
  is_following: boolean;
  is_followed_by: boolean;
  friend_status: FriendStatus;
  is_blocked: boolean;
  is_muted: boolean;
}

export interface UserJSON {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  // Whether the SIGNED-IN viewer is a moderator. Surfaced only on the viewer's
  // own profile (false everywhere else) so moderator status never leaks — the
  // self profile screen gates the admin console entry on it.
  is_admin: boolean;
  stats: UserStats;
  viewer: FullViewerState;
}

export interface UserSummaryJSON {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  viewer: {
    is_self: boolean;
    is_following: boolean;
    friend_status: FriendStatus;
  };
}

// Minimal user fields any serializer needs (a full model or a lean projection).
export interface UserCore {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio?: string;
}

export const serializeUser = (
  user: UserModel | UserCore,
  stats: UserStats,
  viewer: FullViewerState,
  // The viewer's own moderator flag — passed in by the service (which knows
  // whether this is the self view). Defaults false so it never leaks.
  isAdmin = false
): UserJSON => ({
  id: user.user_id,
  username: user.username,
  display_name: user.display_name,
  avatar_url: user.avatar_url,
  bio: user.bio ?? '',
  is_admin: isAdmin,
  stats,
  viewer,
});

export const serializeUserSummary = (
  user: UserCore,
  viewer: UserSummaryJSON['viewer']
): UserSummaryJSON => ({
  id: user.user_id,
  username: user.username,
  display_name: user.display_name,
  avatar_url: user.avatar_url,
  viewer,
});
