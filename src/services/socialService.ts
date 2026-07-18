import { Op, fn, col, where } from 'sequelize';
import { sequelize } from '@config/db';
import { NotFoundError } from '@middlewares/error';
import User, { type UserModel } from '@models/user/User';
import Follow from '@models/social/Follow';
import FriendRequest from '@models/social/FriendRequest';
import Block from '@models/social/Block';
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
      isSelf: u.user_id === viewerId,
      isFollowing: following.has(u.user_id),
      friendStatus: friends.get(u.user_id) ?? 'none',
    })
  );
};

// ── Profile ──────────────────────────────────────────────────────────────────
export const getProfile = async (
  viewerId: string,
  targetId: string
): Promise<UserJSON> => {
  const user = await requireUser(targetId);

  const [followers, following, videos, likesSum] = await Promise.all([
    Follow.count({ where: { followee_id: targetId } }),
    Follow.count({ where: { follower_id: targetId } }),
    Video.count({ where: { author_id: targetId } }),
    Video.sum('like_count', { where: { author_id: targetId } }),
  ]);
  const stats: UserStats = {
    followers,
    following,
    likes: likesSum ?? 0,
    videos,
  };

  const isSelf = viewerId === targetId;
  if (isSelf) {
    return serializeUser(user, stats, {
      isSelf: true,
      isFollowing: false,
      isFollowedBy: false,
      friendStatus: 'none',
      isBlocked: false,
    });
  }

  const [following1, followedBy, friends, blocked] = await Promise.all([
    followingSet(viewerId, [targetId]),
    followerSet(viewerId, [targetId]),
    friendStatusMap(viewerId, [targetId]),
    blockedSet(viewerId, [targetId]),
  ]);

  return serializeUser(user, stats, {
    isSelf: false,
    isFollowing: following1.has(targetId),
    isFollowedBy: followedBy.has(targetId),
    friendStatus: friends.get(targetId) ?? 'none',
    isBlocked: blocked.has(targetId),
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

export const follow = async (
  viewerId: string,
  targetId: string
): Promise<void> => {
  assertNotSelf(viewerId, targetId);
  await requireUser(targetId);
  await Follow.findOrCreate({
    where: { follower_id: viewerId, followee_id: targetId },
    defaults: { follower_id: viewerId, followee_id: targetId },
  });
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
    return;
  }
  // Already friends or already outgoing → no-op. An existing INCOMING request
  // (they requested me) is accepted — the natural outcome of me also asking.
  if (
    existing.status === 'pending' &&
    existing.addressee_id === viewerId
  ) {
    await existing.update({ status: 'accepted' });
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
  if (pending) await pending.update({ status: 'accepted' });
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
