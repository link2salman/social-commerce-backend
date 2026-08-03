import { Op, fn, col, where } from 'sequelize';
import { sequelize } from '@config/db';
import { NotFoundError } from '@middlewares/error';
import User, { type UserModel } from '@models/user/User';
import Follow from '@models/social/Follow';
import FriendRequest from '@models/social/FriendRequest';
import Block from '@models/social/Block';
import Mute from '@models/social/Mute';
import Video from '@models/feed/Video';
import {
  serializeUser,
  serializeUserSummary,
  type UserJSON,
  type UserSummaryJSON,
  type UserStats,
  type UserCore,
} from '@serializers/userSerializer';
import type { FriendStatus } from '@constants/enums';
import { sendToUser } from '@services/pushService';
import { createNotification } from '@services/notificationService';
import {
  decodeCursor,
  encodeCursor,
  keysetWhere,
} from '@utils/cursor';

export interface UserListPage {
  items: UserSummaryJSON[];
  nextCursor: string | null;
}

const USER_LIST_PAGE_SIZE = 6;

const requireUser = async (userId: string): Promise<UserModel> => {
  const user = await User.findByPk(userId);
  if (!user) throw new NotFoundError('User');
  return user;
};

// ── Relationship helpers (batched — no N+1) ──────────────────────────────────
/** For each `otherId`, the viewer's friendStatus. Missing = 'none'. */
const friendStatusMap = async (
  viewerId: string,
  otherIds: string[]
): Promise<Map<string, FriendStatus>> => {
  const map = new Map<string, FriendStatus>();
  if (otherIds.length === 0) return map;
  const rows = await FriendRequest.findAll({
    where: {
      [Op.or]: [
        { requester_id: viewerId, addressee_id: { [Op.in]: otherIds } },
        { addressee_id: viewerId, requester_id: { [Op.in]: otherIds } },
      ],
    },
  });
  for (const row of rows) {
    const other =
      row.requester_id === viewerId ? row.addressee_id : row.requester_id;
    const status: FriendStatus =
      row.status === 'accepted'
        ? 'friends'
        : row.requester_id === viewerId
          ? 'outgoing'
          : 'incoming';
    map.set(other, status);
  }
  return map;
};

/** Which of `otherIds` the viewer follows. */
const followingSet = async (
  viewerId: string,
  otherIds: string[]
): Promise<Set<string>> => {
  if (otherIds.length === 0) return new Set();
  const rows = await Follow.findAll({
    where: { follower_id: viewerId, followee_id: { [Op.in]: otherIds } },
    attributes: ['followee_id'],
  });
  return new Set(rows.map(r => r.followee_id));
};

/** Which of `otherIds` follow the viewer (→ isFollowedBy). */
const followerSet = async (
  viewerId: string,
  otherIds: string[]
): Promise<Set<string>> => {
  if (otherIds.length === 0) return new Set();
  const rows = await Follow.findAll({
    where: { followee_id: viewerId, follower_id: { [Op.in]: otherIds } },
    attributes: ['follower_id'],
  });
  return new Set(rows.map(r => r.follower_id));
};

/** Which of `otherIds` the viewer has blocked. */
const blockedSet = async (
  viewerId: string,
  otherIds: string[]
): Promise<Set<string>> => {
  if (otherIds.length === 0) return new Set();
  const rows = await Block.findAll({
    where: { blocker_id: viewerId, blocked_id: { [Op.in]: otherIds } },
    attributes: ['blocked_id'],
  });
  return new Set(rows.map(r => r.blocked_id));
};

/** Which of `otherIds` the viewer has muted. */
const mutedSet = async (
  viewerId: string,
  otherIds: string[]
): Promise<Set<string>> => {
  if (otherIds.length === 0) return new Set();
  const rows = await Mute.findAll({
    where: { muter_id: viewerId, muted_id: { [Op.in]: otherIds } },
    attributes: ['muted_id'],
  });
  return new Set(rows.map(r => r.muted_id));
};

/** All user ids the viewer has muted — the feed-exclusion list. */
export const mutedAuthorIds = async (viewerId: string): Promise<string[]> => {
  const rows = await Mute.findAll({
    where: { muter_id: viewerId },
    attributes: ['muted_id'],
  });
  return rows.map(r => r.muted_id);
};

// Hydrate a list of users into UserSummaries with the viewer's relationship.
// Exported for reuse by chat/events (conversation participants, member rosters).
export const hydrateUserSummaries = async (
  viewerId: string,
  users: UserCore[]
): Promise<UserSummaryJSON[]> => {
  const ids = users.map(u => u.user_id).filter(id => id !== viewerId);
  const [following, friends] = await Promise.all([
    followingSet(viewerId, ids),
    friendStatusMap(viewerId, ids),
  ]);
  return users.map(u =>
    serializeUserSummary(u, {
      is_self: u.user_id === viewerId,
      is_following: following.has(u.user_id),
      friend_status: friends.get(u.user_id) ?? 'none',
    })
  );
};

// ── Profile ──────────────────────────────────────────────────────────────────
// The PATCH /users/me body (validators/userValidators.ts), so snake_case.
//
// Every field is optional, which is what makes this type dangerous: when it drifts
// from the validator, TypeScript sees a valid object with nothing set and the
// update silently becomes a no-op rather than failing. It did exactly that during
// the snake_case migration. The controller casts `req.body`, so tsc cannot catch
// it either — the integration test asserting the new display_name is the guard.
export interface ProfilePatch {
  display_name?: string;
  bio?: string;
  avatar_url?: string | null;
}

// Edit-profile. Updates only the fields present in the patch, then returns the
// caller's own profile (isSelf) exactly as GET /users/:id would.
export const updateProfile = async (
  userId: string,
  patch: ProfilePatch
): Promise<UserJSON> => {
  const user = await requireUser(userId);
  const changes: Partial<{
    display_name: string;
    bio: string;
    avatar_url: string | null;
  }> = {};
  if (patch.display_name !== undefined) changes.display_name = patch.display_name;
  if (patch.bio !== undefined) changes.bio = patch.bio;
  if (patch.avatar_url !== undefined) changes.avatar_url = patch.avatar_url;
  if (Object.keys(changes).length > 0) await user.update(changes);
  return getProfile(userId, userId);
};

export const getProfile = async (
  viewerId: string,
  targetId: string
): Promise<UserJSON> => {
  const user = await requireUser(targetId);

  // The two video figures come from ONE pass. `Video.count` and `Video.sum`
  // asked for a COUNT and a SUM over the identical row set — same predicate,
  // same `videos_author_id` index — so the second scan re-read exactly what the
  // first had just read. The follow counts stay separate: those are different
  // predicates against different indexes (`follows_followee_id` and
  // `follows_follower_id_created_at`), so merging them would mean an OR that
  // neither index serves cleanly. Sharing work is the reason to combine
  // queries; having two of them is not.
  const [followers, following, videoStats] = await Promise.all([
    Follow.count({ where: { followee_id: targetId } }),
    Follow.count({ where: { follower_id: targetId } }),
    Video.findOne({
      where: { author_id: targetId },
      attributes: [
        [fn('COUNT', col('video_id')), 'video_count'],
        // COALESCE because SUM over no rows is NULL, not 0 — an author with no
        // videos would otherwise serialize `likes: null` against a schema that
        // says number.
        [fn('COALESCE', fn('SUM', col('like_count')), 0), 'like_total'],
      ],
      raw: true,
    }) as unknown as Promise<{ video_count: string; like_total: string } | null>,
  ]);

  const stats: UserStats = {
    followers,
    following,
    // Postgres returns bigint aggregates as strings through pg (they can exceed
    // Number.MAX_SAFE_INTEGER), and Sequelize passes them through untouched —
    // so these are parsed, not cast. Without it `likes` would reach the app as
    // "0" and fail its Zod number check at the boundary.
    likes: Number(videoStats?.like_total ?? 0),
    videos: Number(videoStats?.video_count ?? 0),
  };

  const isSelf = viewerId === targetId;
  if (isSelf) {
    return serializeUser(
      user,
      stats,
      {
        is_self: true,
        is_following: false,
        is_followed_by: false,
        friend_status: 'none',
        is_blocked: false,
        is_muted: false,
      },
      user.is_admin // only the self view carries the viewer's moderator flag
    );
  }

  const [following1, followedBy, friends, blocked, muted] = await Promise.all([
    followingSet(viewerId, [targetId]),
    followerSet(viewerId, [targetId]),
    friendStatusMap(viewerId, [targetId]),
    blockedSet(viewerId, [targetId]),
    mutedSet(viewerId, [targetId]),
  ]);

  return serializeUser(user, stats, {
    is_self: false,
    is_following: following1.has(targetId),
    is_followed_by: followedBy.has(targetId),
    friend_status: friends.get(targetId) ?? 'none',
    is_blocked: blocked.has(targetId),
    is_muted: muted.has(targetId),
  });
};

// ── Paginated lists ──────────────────────────────────────────────────────────
// Followers / following are paginated over the Follow join rows; friends over
// accepted FriendRequests. Each returns UserSummaries with MY relationship to
// the listed user (relative to the viewer, not the profile owner).
const pageFromFollow = async (
  viewerId: string,
  where: Record<string, unknown>,
  otherKey: 'follower_id' | 'followee_id',
  cursor: string | null
): Promise<UserListPage> => {
  const decoded = decodeCursor(cursor);
  const rows = await Follow.findAll({
    where: { ...where, ...keysetWhere(decoded, 'follow_id') },
    order: [
      ['created_at', 'DESC'],
      ['follow_id', 'DESC'],
    ],
    limit: USER_LIST_PAGE_SIZE + 1,
  });
  const hasMore = rows.length > USER_LIST_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, USER_LIST_PAGE_SIZE) : rows;

  const userIds = page.map(r => r[otherKey]);
  const users = await User.findAll({ where: { user_id: { [Op.in]: userIds } } });
  const byId = new Map(users.map(u => [u.user_id, u]));
  const ordered = userIds
    .map(id => byId.get(id))
    .filter((u): u is UserModel => Boolean(u));

  const items = await hydrateUserSummaries(viewerId, ordered);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ ts: last.created_at.toISOString(), id: last.follow_id })
      : null;
  return { items, nextCursor };
};

export const getFollowers = (
  viewerId: string,
  targetId: string,
  cursor: string | null
): Promise<UserListPage> =>
  pageFromFollow(viewerId, { followee_id: targetId }, 'follower_id', cursor);

export const getFollowing = (
  viewerId: string,
  targetId: string,
  cursor: string | null
): Promise<UserListPage> =>
  pageFromFollow(viewerId, { follower_id: targetId }, 'followee_id', cursor);

export const getFriends = async (
  viewerId: string,
  targetId: string,
  cursor: string | null
): Promise<UserListPage> => {
  const decoded = decodeCursor(cursor);
  const rows = await FriendRequest.findAll({
    where: {
      status: 'accepted',
      [Op.or]: [{ requester_id: targetId }, { addressee_id: targetId }],
      ...keysetWhere(decoded, 'request_id', 'updated_at'),
    },
    order: [
      ['updated_at', 'DESC'],
      ['request_id', 'DESC'],
    ],
    limit: USER_LIST_PAGE_SIZE + 1,
  });
  const hasMore = rows.length > USER_LIST_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, USER_LIST_PAGE_SIZE) : rows;

  const friendIds = page.map(r =>
    r.requester_id === targetId ? r.addressee_id : r.requester_id
  );
  const users = await User.findAll({
    where: { user_id: { [Op.in]: friendIds } },
  });
  const byId = new Map(users.map(u => [u.user_id, u]));
  const ordered = friendIds
    .map(id => byId.get(id))
    .filter((u): u is UserModel => Boolean(u));

  const items = await hydrateUserSummaries(viewerId, ordered);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ ts: last.updated_at.toISOString(), id: last.request_id })
      : null;
  return { items, nextCursor };
};

// Incoming pending requests to the viewer. Non-paginated ({ items } only).
export const getIncomingFriendRequests = async (
  viewerId: string
): Promise<{ items: UserSummaryJSON[] }> => {
  const rows = await FriendRequest.findAll({
    where: { addressee_id: viewerId, status: 'pending' },
    order: [['created_at', 'DESC']],
    limit: 50,
  });
  const users = await User.findAll({
    where: { user_id: { [Op.in]: rows.map(r => r.requester_id) } },
  });
  const byId = new Map(users.map(u => [u.user_id, u]));
  const ordered = rows
    .map(r => byId.get(r.requester_id))
    .filter((u): u is UserModel => Boolean(u));
  return { items: await hydrateUserSummaries(viewerId, ordered) };
};

// People search. Case-insensitive over username/displayName; excludes self and
// users the viewer has blocked. Non-paginated ({ items } only).
export const searchUsers = async (
  viewerId: string,
  query: string
): Promise<{ items: UserSummaryJSON[] }> => {
  const q = query.trim();
  if (!q) return { items: [] };

  const blockedRows = await Block.findAll({
    where: { blocker_id: viewerId },
    attributes: ['blocked_id'],
  });
  const excluded = [viewerId, ...blockedRows.map(b => b.blocked_id)];
  const like = `%${q.toLowerCase()}%`;

  const users = await User.findAll({
    where: {
      user_id: { [Op.notIn]: excluded },
      [Op.or]: [
        where(fn('lower', col('username')), { [Op.like]: like }),
        where(fn('lower', col('display_name')), { [Op.like]: like }),
      ],
    },
    order: [['username', 'ASC']],
    limit: 20,
  });
  return { items: await hydrateUserSummaries(viewerId, users) };
};

// ── Mutations ────────────────────────────────────────────────────────────────
const assertNotSelf = (a: string, b: string): void => {
  if (a === b) throw new NotFoundError('User');
};

// Best-effort push from an actor to a target (new follower, friend request).
// Fetches the actor's display name for the notification body; never throws.
const notifyFromActor = async (
  actorId: string,
  targetId: string,
  build: (actorName: string) => { title: string; body: string; data: Record<string, string> }
): Promise<void> => {
  const actor = await User.findByPk(actorId, { attributes: ['display_name'] });
  await sendToUser(targetId, build(actor?.display_name ?? 'Someone'));
};

export const follow = async (
  viewerId: string,
  targetId: string
): Promise<void> => {
  assertNotSelf(viewerId, targetId);
  await requireUser(targetId);
  const [, created] = await Follow.findOrCreate({
    where: { follower_id: viewerId, followee_id: targetId },
    defaults: { follower_id: viewerId, followee_id: targetId },
  });
  if (created) {
    // Durable feed row (awaited) + transient push (best-effort). Target is the
    // follower's profile, so tapping the notification opens who followed you.
    await createNotification({
      recipientId: targetId,
      actorId: viewerId,
      type: 'follow',
      targetType: 'user',
      targetId: viewerId,
    });
    void notifyFromActor(viewerId, targetId, name => ({
      title: 'New follower',
      body: `${name} started following you`,
      data: { type: 'follow', user_id: viewerId },
    }));
  }
};

export const unfollow = async (
  viewerId: string,
  targetId: string
): Promise<void> => {
  await Follow.destroy({
    where: { follower_id: viewerId, followee_id: targetId },
  });
};

export const sendFriendRequest = async (
  viewerId: string,
  targetId: string
): Promise<void> => {
  assertNotSelf(viewerId, targetId);
  await requireUser(targetId);
  const existing = await FriendRequest.findOne({
    where: {
      [Op.or]: [
        { requester_id: viewerId, addressee_id: targetId },
        { requester_id: targetId, addressee_id: viewerId },
      ],
    },
  });
  if (!existing) {
    await FriendRequest.create({
      requester_id: viewerId,
      addressee_id: targetId,
      status: 'pending',
    });
    await createNotification({
      recipientId: targetId,
      actorId: viewerId,
      type: 'friend_request',
      targetType: 'user',
      targetId: viewerId,
    });
    void notifyFromActor(viewerId, targetId, name => ({
      title: 'Friend request',
      body: `${name} sent you a friend request`,
      data: { type: 'friend_request', user_id: viewerId },
    }));
    return;
  }
  // Already friends or already outgoing → no-op. An existing INCOMING request
  // (they requested me) is accepted — the natural outcome of me also asking.
  if (
    existing.status === 'pending' &&
    existing.addressee_id === viewerId
  ) {
    await existing.update({ status: 'accepted' });
    await createNotification({
      recipientId: existing.requester_id,
      actorId: viewerId,
      type: 'friend_accept',
      targetType: 'user',
      targetId: viewerId,
    });
    void notifyFromActor(viewerId, existing.requester_id, name => ({
      title: 'You are now friends',
      body: `${name} accepted your friend request`,
      data: { type: 'friend_accept', user_id: viewerId },
    }));
  }
};

export const acceptFriendRequest = async (
  viewerId: string,
  targetId: string
): Promise<void> => {
  const pending = await FriendRequest.findOne({
    where: {
      requester_id: targetId,
      addressee_id: viewerId,
      status: 'pending',
    },
  });
  if (pending) {
    await pending.update({ status: 'accepted' });
    await createNotification({
      recipientId: targetId,
      actorId: viewerId,
      type: 'friend_accept',
      targetType: 'user',
      targetId: viewerId,
    });
    void notifyFromActor(viewerId, targetId, name => ({
      title: 'You are now friends',
      body: `${name} accepted your friend request`,
      data: { type: 'friend_accept', user_id: viewerId },
    }));
  }
};

export const removeFriend = async (
  viewerId: string,
  targetId: string
): Promise<void> => {
  await FriendRequest.destroy({
    where: {
      [Op.or]: [
        { requester_id: viewerId, addressee_id: targetId },
        { requester_id: targetId, addressee_id: viewerId },
      ],
    },
  });
};

// Blocking severs the follow graph both ways and clears any friend
// relationship, then records the block — all atomically (mirrors the mock).
export const block = async (
  viewerId: string,
  targetId: string
): Promise<void> => {
  assertNotSelf(viewerId, targetId);
  await requireUser(targetId);
  await sequelize.transaction(async transaction => {
    await Follow.destroy({
      where: {
        [Op.or]: [
          { follower_id: viewerId, followee_id: targetId },
          { follower_id: targetId, followee_id: viewerId },
        ],
      },
      transaction,
    });
    await FriendRequest.destroy({
      where: {
        [Op.or]: [
          { requester_id: viewerId, addressee_id: targetId },
          { requester_id: targetId, addressee_id: viewerId },
        ],
      },
      transaction,
    });
    await Block.findOrCreate({
      where: { blocker_id: viewerId, blocked_id: targetId },
      defaults: { blocker_id: viewerId, blocked_id: targetId },
      transaction,
    });
  });
};

export const unblock = async (
  viewerId: string,
  targetId: string
): Promise<void> => {
  await Block.destroy({
    where: { blocker_id: viewerId, blocked_id: targetId },
  });
};

// Muting records a directed (viewer → target) edge and nothing else: the follow
// graph and friendship are deliberately left untouched (that's what makes it
// softer than a block), and the target is never notified. The feeds read the
// mute list to hide the muted user's videos (feedService / rankingService).
// Idempotent — muting an already-muted user is a no-op.
export const mute = async (
  viewerId: string,
  targetId: string
): Promise<void> => {
  assertNotSelf(viewerId, targetId);
  await requireUser(targetId);
  await Mute.findOrCreate({
    where: { muter_id: viewerId, muted_id: targetId },
    defaults: { muter_id: viewerId, muted_id: targetId },
  });
};

export const unmute = async (
  viewerId: string,
  targetId: string
): Promise<void> => {
  await Mute.destroy({
    where: { muter_id: viewerId, muted_id: targetId },
  });
};
