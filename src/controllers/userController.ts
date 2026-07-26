import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendCursor, sendList, sendSuccess } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import * as social from '@services/socialService';
import { getUserVideos } from '@services/feedService';
import { getUserPosts } from '@services/postService';
import type { UpdateProfileBody } from '@validators/userValidators';

const cursor = (req: Request): string | null => {
  const raw = req.query.cursor;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};
const targetId = (req: Request): string => req.params.id as string;

// PATCH /v1/users/me { display_name?, bio?, avatar_url? } → { data: User }
export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await social.updateProfile(
    requireUserId(req),
    req.body as UpdateProfileBody
  );
  sendSuccess(res, 'Profile updated', user);
});

// GET /v1/users/:id → { data: User }
export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = await social.getProfile(requireUserId(req), targetId(req));
  sendSuccess(res, 'Profile fetched', user);
});

// GET /v1/users/:id/videos?cursor= → { items, next_cursor }
export const getVideos = asyncHandler(async (req: Request, res: Response) => {
  const page = await getUserVideos({
    viewerId: requireUserId(req),
    authorId: targetId(req),
    cursor: cursor(req),
  });
  sendCursor(res, 'Videos fetched', page.items, page.nextCursor);
});

// GET /v1/users/:id/posts?cursor= → { items, next_cursor }
export const getPosts = asyncHandler(async (req: Request, res: Response) => {
  const page = await getUserPosts({
    viewerId: requireUserId(req),
    authorId: targetId(req),
    cursor: cursor(req),
  });
  sendCursor(res, 'Posts fetched', page.items, page.nextCursor);
});

// GET /v1/users/:id/followers|following|friends?cursor= → { items, next_cursor }
export const getFollowers = asyncHandler(async (req: Request, res: Response) => {
  const page = await social.getFollowers(
    requireUserId(req),
    targetId(req),
    cursor(req)
  );
  sendCursor(res, 'Followers fetched', page.items, page.nextCursor);
});
export const getFollowing = asyncHandler(async (req: Request, res: Response) => {
  const page = await social.getFollowing(
    requireUserId(req),
    targetId(req),
    cursor(req)
  );
  sendCursor(res, 'Following fetched', page.items, page.nextCursor);
});
export const getFriends = asyncHandler(async (req: Request, res: Response) => {
  const page = await social.getFriends(
    requireUserId(req),
    targetId(req),
    cursor(req)
  );
  sendCursor(res, 'Friends fetched', page.items, page.nextCursor);
});

// GET /v1/users/search?q= → { items } (no cursor)
export const search = asyncHandler(async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const result = await social.searchUsers(requireUserId(req), q);
  sendList(res, 'Users fetched', result.items);
});

// GET /v1/friend-requests → { items } (incoming, no cursor)
export const getFriendRequests = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await social.getIncomingFriendRequests(requireUserId(req));
    sendList(res, 'Friend requests fetched', result.items);
  }
);

// ── Mutations ───────────────────────────────────────────────────────────────
export const follow = asyncHandler(async (req: Request, res: Response) => {
  await social.follow(requireUserId(req), targetId(req));
  sendSuccess(res, 'Followed');
});
export const unfollow = asyncHandler(async (req: Request, res: Response) => {
  await social.unfollow(requireUserId(req), targetId(req));
  sendSuccess(res, 'Unfollowed');
});
export const sendFriendRequest = asyncHandler(
  async (req: Request, res: Response) => {
    await social.sendFriendRequest(requireUserId(req), targetId(req));
    sendSuccess(res, 'Friend request sent');
  }
);
export const acceptFriendRequest = asyncHandler(
  async (req: Request, res: Response) => {
    await social.acceptFriendRequest(requireUserId(req), targetId(req));
    sendSuccess(res, 'Friend request accepted');
  }
);
export const removeFriend = asyncHandler(async (req: Request, res: Response) => {
  await social.removeFriend(requireUserId(req), targetId(req));
  sendSuccess(res, 'Friend removed');
});
export const block = asyncHandler(async (req: Request, res: Response) => {
  await social.block(requireUserId(req), targetId(req));
  sendSuccess(res, 'User blocked');
});
export const unblock = asyncHandler(async (req: Request, res: Response) => {
  await social.unblock(requireUserId(req), targetId(req));
  sendSuccess(res, 'User unblocked');
});
export const mute = asyncHandler(async (req: Request, res: Response) => {
  await social.mute(requireUserId(req), targetId(req));
  sendSuccess(res, 'User muted');
});
export const unmute = asyncHandler(async (req: Request, res: Response) => {
  await social.unmute(requireUserId(req), targetId(req));
  sendSuccess(res, 'User unmuted');
});
