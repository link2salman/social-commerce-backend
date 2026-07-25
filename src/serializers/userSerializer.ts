import type { UserModel } from '@models/user/User';
import type { FriendStatus } from '@constants/enums';

// The client's user.schema.ts shapes (User + UserSummary). Relationship + stats
// are computed by socialService and passed in; the serializer only maps.
export interface UserStats {
  followers: number;
  following: number;
  likes: number;
  videos: number;
}

export interface FullViewerState {
  isSelf: boolean;
  isFollowing: boolean;
  isFollowedBy: boolean;
  friendStatus: FriendStatus;
  isBlocked: boolean;
  isMuted: boolean;
}

export interface UserJSON {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  // Whether the SIGNED-IN viewer is a moderator. Surfaced only on the viewer's
  // own profile (false everywhere else) so moderator status never leaks — the
  // self profile screen gates the admin console entry on it.
  isAdmin: boolean;
  stats: UserStats;
  viewer: FullViewerState;
}

export interface UserSummaryJSON {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  viewer: {
    isSelf: boolean;
    isFollowing: boolean;
    friendStatus: FriendStatus;
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
  displayName: user.display_name,
  avatarUrl: user.avatar_url,
  bio: user.bio ?? '',
  isAdmin,
  stats,
  viewer,
});

export const serializeUserSummary = (
  user: UserCore,
  viewer: UserSummaryJSON['viewer']
): UserSummaryJSON => ({
  id: user.user_id,
  username: user.username,
  displayName: user.display_name,
  avatarUrl: user.avatar_url,
  viewer,
});
