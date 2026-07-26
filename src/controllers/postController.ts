import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendCursor, sendList, sendSuccess } from '@utils/responseHandler';
import { NotFoundError } from '@middlewares/error';
import { requireUserId } from '@middlewares/auth';
import { ENGAGEMENT_TYPES, type EngagementType } from '@constants/enums';
import { clampPageSize } from '@utils/cursor';
import { togglePostEngagement } from '@services/postEngagementService';
import * as postComments from '@services/postCommentService';
import {
  createPost,
  getPost,
  getPostFeed,
  getSavedPosts,
  recordPostShare,
} from '@services/postService';
import type { CommentPostBody } from '@validators/commentValidators';
import type { CreatePostBody } from '@validators/postValidators';

const ENGAGEMENT_SET = new Set<string>(ENGAGEMENT_TYPES);
const postId = (req: Request): string => req.params.id as string;
const cursorParam = (req: Request): string | null => {
  const raw = req.query.cursor;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};

// POST /v1/posts { body?, media? } → { data: Post } (201)
export const create = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CreatePostBody;
  const post = await createPost(requireUserId(req), {
    body: body.body,
    media: body.media,
  });
  sendSuccess(res, 'Post published', post, 201);
});

// GET /v1/posts/feed?cursor= → { items, next_cursor } (following + self)
export const feed = asyncHandler(async (req: Request, res: Response) => {
  const page = await getPostFeed({
    viewerId: requireUserId(req),
    cursor: cursorParam(req),
    pageSize: clampPageSize(req.query.limit),
  });
  sendCursor(res, 'Posts fetched', page.items, page.nextCursor);
});

// GET /v1/posts/saved?cursor= → { items, next_cursor } (the viewer's saved posts)
export const saved = asyncHandler(async (req: Request, res: Response) => {
  const page = await getSavedPosts({
    viewerId: requireUserId(req),
    cursor: cursorParam(req),
    pageSize: clampPageSize(req.query.limit),
  });
  sendCursor(res, 'Saved posts fetched', page.items, page.nextCursor);
});

// GET /v1/posts/:id → { data: Post } (single, hydrated for the viewer)
export const detail = asyncHandler(async (req: Request, res: Response) => {
  const post = await getPost(postId(req), requireUserId(req));
  sendSuccess(res, 'Post fetched', post);
});

// POST/DELETE /v1/posts/:id/:action  (like|dislike|save|bookmark|favorite)
const engagement = (on: boolean) =>
  asyncHandler(async (req: Request, res: Response) => {
    const action = req.params.action as string;
    if (!ENGAGEMENT_SET.has(action)) {
      throw new NotFoundError('Route');
    }
    await togglePostEngagement(
      requireUserId(req),
      postId(req),
      action as EngagementType,
      on
    );
    sendSuccess(res, on ? `Post ${action}d` : `Post un${action}d`);
  });

export const addEngagement = engagement(true);
export const removeEngagement = engagement(false);

// POST /v1/posts/:id/share → { data: { share_count } }
export const share = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 'Share recorded', await recordPostShare(postId(req)));
});

// GET /v1/posts/:id/comments → { items } (top-level)
export const listComments = asyncHandler(async (req: Request, res: Response) => {
  const items = await postComments.listTopLevel(postId(req), requireUserId(req));
  sendList(res, 'Comments fetched', items);
});

// POST /v1/posts/:id/comments { body, parent_id? } → { data: Comment } (201)
export const postComment = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CommentPostBody;
  const comment = await postComments.postComment(
    postId(req),
    requireUserId(req),
    body.body,
    body.parent_id ?? null
  );
  sendSuccess(res, 'Comment posted', comment, 201);
});
