import ConversationMember from '@models/chat/ConversationMember';
import logger from '@utils/logger';
import type { AppServer, AppSocket } from './types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isMember = async (
  conversationId: string,
  userId: string
): Promise<boolean> => {
  const m = await ConversationMember.findOne({
    where: { conversation_id: conversationId, user_id: userId },
    attributes: ['member_id'],
  });
  return m !== null;
};

// Chat realtime: conversation rooms + typing relay. `message:new` is emitted to
// each member's user room from chatService when a message is posted — no room
// join required to receive it. Typing is scoped to a conversation room a member
// has joined, so it can never be spoofed into a thread the socket isn't in.
export const registerChatHandlers = (_io: AppServer, socket: AppSocket): void => {
  const user = socket.data;

  socket.on('conversation:join', async (conversationId: unknown) => {
    if (typeof conversationId !== 'string' || !UUID_RE.test(conversationId)) return;
    if (!(await isMember(conversationId, user.user_id))) return;
    void socket.join(`conversation:${conversationId}`);
    user.joinedConversations.add(conversationId);
  });

  socket.on('conversation:leave', (conversationId: unknown) => {
    if (typeof conversationId !== 'string') return;
    void socket.leave(`conversation:${conversationId}`);
    user.joinedConversations.delete(conversationId);
  });

  // { conversationId, isTyping } — relayed to the rest of the room.
  socket.on('typing', (payload: unknown) => {
    const data = payload as { conversationId?: string; isTyping?: boolean };
    const conversationId = data?.conversationId;
    if (typeof conversationId !== 'string') return;
    if (!user.joinedConversations.has(conversationId)) return;
    socket.to(`conversation:${conversationId}`).emit('typing', {
      conversationId,
      userId: user.user_id,
      isTyping: Boolean(data.isTyping),
    });
  });

  socket.on('disconnect', () => {
    logger.debug({ userId: user.user_id }, 'chat: socket disconnected');
  });
};
