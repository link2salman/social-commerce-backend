import { Op } from 'sequelize';
import { sequelize } from '@config/db';
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
} from '@middlewares/error';
import User from '@models/user/User';
import Conversation, {
  type ConversationModel,
} from '@models/chat/Conversation';
import ConversationMember, {
  type ConversationMemberModel,
} from '@models/chat/ConversationMember';
import Message from '@models/chat/Message';
import { hydrateUserSummaries } from '@services/socialService';
import { serializeMessage, type MessageJSON } from '@serializers/messageSerializer';
import type {
  ConversationJSON,
  GroupMemberJSON,
} from '@serializers/conversationSerializer';
import type { UserSummaryJSON } from '@serializers/userSerializer';
import type { GroupRole } from '@constants/enums';
import { getSocketManager } from 'socket';
import logger from '@utils/logger';

// ── Loaders / guards ─────────────────────────────────────────────────────────
const requireConversation = async (
  conversationId: string
): Promise<ConversationModel> => {
  const conv = await Conversation.findByPk(conversationId);
  if (!conv) throw new NotFoundError('Conversation');
  return conv;
};

const requireMembership = async (
  conversationId: string,
  userId: string
): Promise<ConversationMemberModel> => {
  const member = await ConversationMember.findOne({
    where: { conversation_id: conversationId, user_id: userId },
  });
  if (!member) throw new ForbiddenError('You are not a member of this conversation');
  return member;
};

const ROLE_RANK: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };

// ── Serialization (batched) ──────────────────────────────────────────────────
const serializeConversations = async (
  viewerId: string,
  convs: ConversationModel[]
): Promise<ConversationJSON[]> => {
  if (convs.length === 0) return [];
  const convIds = convs.map(c => c.conversation_id);

  const allMembers = await ConversationMember.findAll({
    where: { conversation_id: { [Op.in]: convIds } },
  });
  const membersByConv = new Map<string, ConversationMemberModel[]>();
  for (const m of allMembers) {
    const arr = membersByConv.get(m.conversation_id) ?? [];
    arr.push(m);
    membersByConv.set(m.conversation_id, arr);
  }

  const userIds = [...new Set(allMembers.map(m => m.user_id))];
  const users = await User.findAll({ where: { user_id: { [Op.in]: userIds } } });
  const userById = new Map(users.map(u => [u.user_id, u]));
  const summaries = await hydrateUserSummaries(viewerId, users);
  const summaryByUser = new Map<string, UserSummaryJSON>(
    summaries.map(s => [s.id, s])
  );

  // Unread per conversation: messages from others after my last_read_at.
  const unreadByConv = new Map<string, number>();
  await Promise.all(
    convs.map(async c => {
      const mine = membersByConv
        .get(c.conversation_id)
        ?.find(m => m.user_id === viewerId);
      const since = mine?.last_read_at ?? new Date(0);
      const count = await Message.count({
        where: {
          conversation_id: c.conversation_id,
          sender_id: { [Op.ne]: viewerId },
          created_at: { [Op.gt]: since },
        },
      });
      unreadByConv.set(c.conversation_id, count);
    })
  );

  return convs.map(c => {
    const members = [...(membersByConv.get(c.conversation_id) ?? [])].sort(
      (a, z) => ROLE_RANK[a.role] - ROLE_RANK[z.role]
    );
    const others = members.filter(m => m.user_id !== viewerId);
    const peer = others[0] ? userById.get(others[0].user_id) : undefined;

    const groupMembers: GroupMemberJSON[] = c.is_group
      ? members
          .map(m => {
            const user = summaryByUser.get(m.user_id);
            return user ? { user, role: m.role } : null;
          })
          .filter((m): m is GroupMemberJSON => Boolean(m))
      : [];

    return {
      id: c.conversation_id,
      isGroup: c.is_group,
      title: c.title,
      participant:
        !c.is_group && peer
          ? {
              id: peer.user_id,
              username: peer.username,
              displayName: peer.display_name,
              avatarUrl: peer.avatar_url,
            }
          : null,
      participants: others
        .map(m => summaryByUser.get(m.user_id))
        .filter((s): s is UserSummaryJSON => Boolean(s)),
      members: groupMembers,
      lastMessage: c.last_message_body ?? '',
      lastSenderId: c.last_sender_id ?? '',
      unreadCount: unreadByConv.get(c.conversation_id) ?? 0,
      updatedAt: (c.last_message_at ?? c.updated_at).toISOString(),
    };
  });
};

const serializeOne = async (
  viewerId: string,
  conv: ConversationModel
): Promise<ConversationJSON> => {
  const [one] = await serializeConversations(viewerId, [conv]);
  return one!;
};

// ── Realtime emit (best-effort; no-op if the socket layer isn't running) ─────
const emitToMembers = async (
  conversationId: string,
  exceptUserId: string,
  event: string,
  payload: unknown
): Promise<void> => {
  try {
    const manager = getSocketManager();
    const members = await ConversationMember.findAll({
      where: { conversation_id: conversationId },
      attributes: ['user_id'],
    });
    for (const m of members) {
      if (m.user_id !== exceptUserId) {
        manager.sendToUser(m.user_id, event, payload);
      }
    }
  } catch (err) {
    logger.debug({ err }, 'chat: realtime emit skipped (socket not ready)');
  }
};

// ── Public API ───────────────────────────────────────────────────────────────
export const getConversations = async (
  viewerId: string
): Promise<{ items: ConversationJSON[] }> => {
  const memberships = await ConversationMember.findAll({
    where: { user_id: viewerId },
    attributes: ['conversation_id'],
  });
  const convIds = memberships.map(m => m.conversation_id);
  if (convIds.length === 0) return { items: [] };

  const convs = await Conversation.findAll({
    where: { conversation_id: { [Op.in]: convIds } },
  });
  convs.sort((a, z) => {
    const at = (a.last_message_at ?? a.updated_at).getTime();
    const zt = (z.last_message_at ?? z.updated_at).getTime();
    return zt - at;
  });
  return { items: await serializeConversations(viewerId, convs) };
};

export const openWith = async (
  viewerId: string,
  peerId: string
): Promise<{ conversation: ConversationJSON; created: boolean }> => {
  if (viewerId === peerId) throw new BadRequestError('Cannot message yourself');
  const peer = await User.findByPk(peerId);
  if (!peer) throw new NotFoundError('User');

  // Existing 1:1 = a non-group conversation both of us belong to.
  const mine = await ConversationMember.findAll({
    where: { user_id: viewerId },
    attributes: ['conversation_id'],
  });
  const shared = await ConversationMember.findAll({
    where: {
      user_id: peerId,
      conversation_id: { [Op.in]: mine.map(m => m.conversation_id) },
    },
    attributes: ['conversation_id'],
  });
  if (shared.length > 0) {
    const existing = await Conversation.findOne({
      where: {
        conversation_id: { [Op.in]: shared.map(s => s.conversation_id) },
        is_group: false,
      },
    });
    if (existing) {
      return { conversation: await serializeOne(viewerId, existing), created: false };
    }
  }

  const now = new Date();
  const conv = await sequelize.transaction(async transaction => {
    const created = await Conversation.create(
      {
        is_group: false,
        created_by: viewerId,
        last_message_body: 'Say hi 👋',
        last_sender_id: peerId,
        last_message_at: now,
      },
      { transaction }
    );
    await ConversationMember.bulkCreate(
      [
        { conversation_id: created.conversation_id, user_id: viewerId, role: 'member' },
        { conversation_id: created.conversation_id, user_id: peerId, role: 'member' },
      ],
      { transaction }
    );
    return created;
  });
  return { conversation: await serializeOne(viewerId, conv), created: true };
};

export const createGroup = async (
  viewerId: string,
  title: string,
  participantIds: string[]
): Promise<ConversationJSON> => {
  const unique = [...new Set(participantIds)].filter(id => id !== viewerId);
  if (unique.length < 2) {
    throw new BadRequestError('A group needs at least two other members');
  }
  const users = await User.findAll({
    where: { user_id: { [Op.in]: unique } },
    attributes: ['user_id'],
  });
  if (users.length !== unique.length) throw new NotFoundError('User');

  const conv = await sequelize.transaction(async transaction => {
    const created = await Conversation.create(
      { is_group: true, title, created_by: viewerId },
      { transaction }
    );
    await ConversationMember.bulkCreate(
      [
        { conversation_id: created.conversation_id, user_id: viewerId, role: 'owner' },
        ...unique.map(id => ({
          conversation_id: created.conversation_id,
          user_id: id,
          role: 'member' as GroupRole,
        })),
      ],
      { transaction }
    );
    return created;
  });
  return serializeOne(viewerId, conv);
};

const requireGroupRole = async (
  conversationId: string,
  viewerId: string,
  allowed: GroupRole[]
): Promise<{ conv: ConversationModel; member: ConversationMemberModel }> => {
  const conv = await requireConversation(conversationId);
  if (!conv.is_group) throw new BadRequestError('Not a group conversation');
  const member = await requireMembership(conversationId, viewerId);
  if (!allowed.includes(member.role)) {
    throw new ForbiddenError('You do not have permission for this action');
  }
  return { conv, member };
};

export const addMembers = async (
  viewerId: string,
  conversationId: string,
  userIds: string[]
): Promise<ConversationJSON> => {
  const { conv } = await requireGroupRole(conversationId, viewerId, [
    'owner',
    'admin',
  ]);
  const existing = await ConversationMember.findAll({
    where: { conversation_id: conversationId },
    attributes: ['user_id'],
  });
  const existingIds = new Set(existing.map(m => m.user_id));
  const toAdd = [...new Set(userIds)].filter(id => !existingIds.has(id));
  if (toAdd.length > 0) {
    const users = await User.findAll({
      where: { user_id: { [Op.in]: toAdd } },
      attributes: ['user_id'],
    });
    if (users.length !== toAdd.length) throw new NotFoundError('User');
    await ConversationMember.bulkCreate(
      toAdd.map(id => ({
        conversation_id: conversationId,
        user_id: id,
        role: 'member' as GroupRole,
      }))
    );
  }
  return serializeOne(viewerId, conv);
};

export const setMemberRole = async (
  viewerId: string,
  conversationId: string,
  targetUserId: string,
  role: GroupRole
): Promise<ConversationJSON> => {
  const { conv } = await requireGroupRole(conversationId, viewerId, ['owner']);
  if (role === 'owner') {
    throw new ForbiddenError('Ownership transfer is not supported');
  }
  const target = await ConversationMember.findOne({
    where: { conversation_id: conversationId, user_id: targetUserId },
  });
  if (!target) throw new NotFoundError('Member');
  if (target.role === 'owner') {
    throw new ForbiddenError("The owner's role cannot be changed");
  }
  await target.update({ role });
  return serializeOne(viewerId, conv);
};

export const removeMember = async (
  viewerId: string,
  conversationId: string,
  targetUserId: string
): Promise<ConversationJSON> => {
  const { conv, member } = await requireGroupRole(conversationId, viewerId, [
    'owner',
    'admin',
  ]);
  const target = await ConversationMember.findOne({
    where: { conversation_id: conversationId, user_id: targetUserId },
  });
  if (!target) throw new NotFoundError('Member');
  if (target.role === 'owner') {
    throw new ForbiddenError('The owner cannot be removed');
  }
  // An admin cannot remove another admin — only the owner can.
  if (member.role === 'admin' && target.role === 'admin') {
    throw new ForbiddenError('Admins cannot remove other admins');
  }
  await target.destroy();
  return serializeOne(viewerId, conv);
};

export const leaveGroup = async (
  viewerId: string,
  conversationId: string
): Promise<void> => {
  const conv = await requireConversation(conversationId);
  const member = await requireMembership(conversationId, viewerId);
  // Owner leaving deletes the thread (no ownership transfer yet — mirrors mock).
  if (conv.is_group && member.role === 'owner') {
    await conv.destroy();
    return;
  }
  await member.destroy();
  // If the group is now empty, remove it.
  const remaining = await ConversationMember.count({
    where: { conversation_id: conversationId },
  });
  if (remaining === 0) await conv.destroy();
};

export const getMessages = async (
  viewerId: string,
  conversationId: string
): Promise<{ items: MessageJSON[]; typing: boolean }> => {
  await requireMembership(conversationId, viewerId);

  const now = new Date();
  await ConversationMember.update(
    { last_read_at: now },
    { where: { conversation_id: conversationId, user_id: viewerId } }
  );
  // Opening the thread marks everyone else's messages read (read receipts).
  await Message.update(
    { status: 'read', read_at: now },
    {
      where: {
        conversation_id: conversationId,
        sender_id: { [Op.ne]: viewerId },
        status: { [Op.ne]: 'read' },
      },
    }
  );

  const messages = await Message.findAll({
    where: { conversation_id: conversationId },
    order: [
      ['created_at', 'ASC'],
      ['message_id', 'ASC'],
    ],
    limit: 200,
  });
  // Typing is pushed over the socket in real time; the HTTP snapshot is never typing.
  return { items: messages.map(serializeMessage), typing: false };
};

export const postMessage = async (
  viewerId: string,
  conversationId: string,
  body: string,
  imageUrl: string | null
): Promise<MessageJSON> => {
  await requireMembership(conversationId, viewerId);
  const message = await Message.create({
    conversation_id: conversationId,
    sender_id: viewerId,
    body,
    image_url: imageUrl,
    attachment: null,
    status: 'sent',
  });
  const lastBody = body || (imageUrl ? '📷 Photo' : '');
  await Conversation.update(
    {
      last_message_body: lastBody,
      last_sender_id: viewerId,
      last_message_at: message.created_at,
      updated_at: message.created_at,
    },
    { where: { conversation_id: conversationId } }
  );

  const serialized = serializeMessage(message);
  await emitToMembers(conversationId, viewerId, 'message:new', serialized);
  return serialized;
};
