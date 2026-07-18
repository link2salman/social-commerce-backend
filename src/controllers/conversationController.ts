import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send, sendOk } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import * as chat from '@services/chatService';
import type {
  GroupInputBody,
  AddMembersBody,
  MemberRoleBody,
  MessageInputBody,
} from '@validators/chatValidators';

const convId = (req: Request): string => req.params.id as string;

// GET /v1/conversations → { items: Conversation[] }
export const list = asyncHandler(async (req: Request, res: Response) => {
  send(res, await chat.getConversations(requireUserId(req)));
});

// POST /v1/conversations/with/:id → Conversation (201 created / 200 existing)
export const openWith = asyncHandler(async (req: Request, res: Response) => {
  const { conversation, created } = await chat.openWith(
    requireUserId(req),
    req.params.id as string
  );
  send(res, conversation, created ? 201 : 200);
});

// POST /v1/conversations/group { title, participantIds } → Conversation (201)
export const createGroup = asyncHandler(async (req: Request, res: Response) => {
  const { title, participantIds } = req.body as GroupInputBody;
  send(res, await chat.createGroup(requireUserId(req), title, participantIds), 201);
});

// POST /v1/conversations/:id/members { userIds } → Conversation
export const addMembers = asyncHandler(async (req: Request, res: Response) => {
  const { userIds } = req.body as AddMembersBody;
  send(res, await chat.addMembers(requireUserId(req), convId(req), userIds));
});

// PATCH /v1/conversations/:id/members/:userId { role } → Conversation
export const setMemberRole = asyncHandler(async (req: Request, res: Response) => {
  const { role } = req.body as MemberRoleBody;
  send(
    res,
    await chat.setMemberRole(
      requireUserId(req),
      convId(req),
      req.params.userId as string,
      role
    )
  );
});

// DELETE /v1/conversations/:id/members/:userId → Conversation, OR
// DELETE /v1/conversations/:id/members/me → leave the group → { ok: true }
export const removeMemberOrLeave = asyncHandler(
  async (req: Request, res: Response) => {
    const viewerId = requireUserId(req);
    const target = req.params.userId as string;
    if (target === 'me') {
      await chat.leaveGroup(viewerId, convId(req));
      return sendOk(res);
    }
    send(res, await chat.removeMember(viewerId, convId(req), target));
  }
);

// GET /v1/conversations/:id/messages → { items: Message[], typing }
export const getMessages = asyncHandler(async (req: Request, res: Response) => {
  send(res, await chat.getMessages(requireUserId(req), convId(req)));
});

// POST /v1/conversations/:id/messages { body, imageUrl? } → Message (201)
export const postMessage = asyncHandler(async (req: Request, res: Response) => {
  const { body, imageUrl } = req.body as MessageInputBody;
  send(
    res,
    await chat.postMessage(requireUserId(req), convId(req), body, imageUrl),
    201
  );
});
