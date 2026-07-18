import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send, sendOk } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import * as social from '@services/socialService';
import { getUserVideos } from '@services/feedService';
import type { UpdateProfileBody } from '@validators/userValidators';

const cursor = (req: Request): string | null => {
  const raw = req.query.cursor;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};
const targetId = (req: Request): string => req.params.id as string;

// PATCH /v1/users/me { displayName?, bio?, avatarUrl? } → User (self)
export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  send(res, await social.updateProfile(requireUserId(req), req.body as UpdateProfileBody));
});

// GET /v1/users/:id → User
export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  send(res, await social.getProfile(requireUserId(req), targetId(req)));
});

// GET /v1/users/:id/videos?cursor= → FeedPage
export const getVideos = asyncHandler(async (req: Request, res: Response) => {
  send(
    res,
    await getUserVideos({
      viewerId: requireUserId(req),
      authorId: targetId(req),
      cursor: cursor(req),
    })
  );
});

// GET /v1/users/:id/followers|following|friends?cursor= → UserListResponse
export const getFollowers = asyncHandler(async (req: Request, res: Response) => {
  send(res, await social.getFollowers(requireUserId(req), targetId(req), cursor(req)));
});
export const getFollowing = asyncHandler(async (req: Request, res: Response) => {
  send(res, await social.getFollowing(requireUserId(req), targetId(req), cursor(req)));
});
export const getFriends = asyncHandler(async (req: Request, res: Response) => {
  send(res, await social.getFriends(requireUserId(req), targetId(req), cursor(req)));
});

// GET /v1/users/search?q= → UserListResponse (no cursor)
export const search = asyncHandler(async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  send(res, await social.searchUsers(requireUserId(req), q));
});

// GET /v1/friend-requests → UserListResponse (incoming, no cursor)
export const getFriendRequests = asyncHandler(
  async (req: Request, res: Response) => {
    send(res, await social.getIncomingFriendRequests(requireUserId(req)));
  }
);

// ── Mutations (all → { ok: true }) ──────────────────────────────────────────
export const follow = asyncHandler(async (req: Request, res: Response) => {
  await social.follow(requireUserId(req), targetId(req));
  sendOk(res);
});
export const unfollow = asyncHandler(async (req: Request, res: Response) => {
  await social.unfollow(requireUserId(req), targetId(req));
  sendOk(res);
});
export const sendFriendRequest = asyncHandler(
  async (req: Request, res: Response) => {
    await social.sendFriendRequest(requireUserId(req), targetId(req));
    sendOk(res);
  }
);
export const acceptFriendRequest = asyncHandler(
  async (req: Request, res: Response) => {
    await social.acceptFriendRequest(requireUserId(req), targetId(req));
    sendOk(res);
  }
);
export const removeFriend = asyncHandler(async (req: Request, res: Response) => {
  await social.removeFriend(requireUserId(req), targetId(req));
  sendOk(res);
});
export const block = asyncHandler(async (req: Request, res: Response) => {
  await social.block(requireUserId(req), targetId(req));
  sendOk(res);
});
export const unblock = asyncHandler(async (req: Request, res: Response) => {
  await social.unblock(requireUserId(req), targetId(req));
  sendOk(res);
});
