import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendList, sendSuccess } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import * as chat from '@services/chatService';
import type {
  GroupInputBody,
  AddMembersBody,
  MemberRoleBody,
  MessageInputBody,
} from '@validators/chatValidators';

const convId = (req: Request): string => req.params.id as string;

// GET /v1/conversations → { items }
export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await chat.getConversations(requireUserId(req));
  sendList(res, 'Conversations fetched', result.items);
});

// POST /v1/conversations/with/:id → { data: Conversation } (201 new / 200 existing)
export const openWith = asyncHandler(async (req: Request, res: Response) => {
  const { conversation, created } = await chat.openWith(
    requireUserId(req),
    req.params.id as string
  );
  sendSuccess(
    res,
    created ? 'Conversation created' : 'Conversation opened',
    conversation,
    created ? 201 : 200
  );
});

// POST /v1/conversations/group { title, participant_ids } → { data: Conversation } (201)
export const createGroup = asyncHandler(async (req: Request, res: Response) => {
  const { title, participant_ids } = req.body as GroupInputBody;
  const conversation = await chat.createGroup(
    requireUserId(req),
    title,
    participant_ids
  );
  sendSuccess(res, 'Group created', conversation, 201);
});

// POST /v1/conversations/:id/members { user_ids } → { data: Conversation }
export const addMembers = asyncHandler(async (req: Request, res: Response) => {
  const { user_ids } = req.body as AddMembersBody;
  const conversation = await chat.addMembers(
    requireUserId(req),
    convId(req),
    user_ids
  );
  sendSuccess(res, 'Members added', conversation);
});

// PATCH /v1/conversations/:id/members/:userId { role } → { data: Conversation }
export const setMemberRole = asyncHandler(async (req: Request, res: Response) => {
  const { role } = req.body as MemberRoleBody;
  const conversation = await chat.setMemberRole(
    requireUserId(req),
    convId(req),
    req.params.userId as string,
    role
  );
  sendSuccess(res, 'Member role updated', conversation);
});

// DELETE /v1/conversations/:id/members/:userId → { data: Conversation }, OR
// DELETE /v1/conversations/:id/members/me → leave the group (no data)
export const removeMemberOrLeave = asyncHandler(
  async (req: Request, res: Response) => {
    const viewerId = requireUserId(req);
    const target = req.params.userId as string;
    if (target === 'me') {
      await chat.leaveGroup(viewerId, convId(req));
      return sendSuccess(res, 'Left the group');
    }
    const conversation = await chat.removeMember(
      viewerId,
      convId(req),
      target
    );
    sendSuccess(res, 'Member removed', conversation);
  }
);

// GET /v1/conversations/:id/messages → { items, typing }
export const getMessages = asyncHandler(async (req: Request, res: Response) => {
  const result = await chat.getMessages(requireUserId(req), convId(req));
  sendList(res, 'Messages fetched', result.items, { typing: result.typing });
});

// POST /v1/conversations/:id/messages { body, image_url? } → { data: Message } (201)
export const postMessage = asyncHandler(async (req: Request, res: Response) => {
  const { body, image_url } = req.body as MessageInputBody;
  const message = await chat.postMessage(
    requireUserId(req),
    convId(req),
    body,
    image_url
  );
  sendSuccess(res, 'Message sent', message, 201);
});
