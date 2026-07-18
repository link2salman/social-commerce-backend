import type { MessageModel } from '@models/chat/Message';
import type { MessageStatus } from '@constants/enums';

// The client's message.schema.ts shape. `attachment` is always present
// (nullable), matching the client's non-optional key.
export interface MessageJSON {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  imageUrl: string | null;
  attachment: {
    type: 'product' | 'video' | 'image';
    productId?: string;
    videoId?: string;
    url?: string;
  } | null;
  createdAt: string;
  status: MessageStatus;
}

export const serializeMessage = (m: MessageModel): MessageJSON => ({
  id: m.message_id,
  conversationId: m.conversation_id,
  senderId: m.sender_id,
  body: m.body,
  imageUrl: m.image_url,
  attachment: m.attachment ?? null,
  createdAt: m.created_at.toISOString(),
  status: m.status,
});
